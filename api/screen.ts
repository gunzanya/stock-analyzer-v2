import type { VercelRequest, VercelResponse } from '@vercel/node';
import { analyzeOne } from './analyze.js';
import { fetchScreenerPool } from './fetchStock.js';
import { SCREENER_POOL } from '../src/lib/screenerPool.js';
import { SP500 } from '../src/lib/sp500.js';
import { KR_TICKERS } from '../src/lib/krStocks.js';
import type { AnalysisResult } from '../src/lib/types.js';
import type { ScreenerSummary } from '../src/lib/screenerTypes.js';

type ScreenFilter = 'all' | 'breakout_us' | 'entry_us' | 'uptrend_us' | 'breakout_kr' | 'entry_kr' | 'uptrend_kr';

const DEFAULT_N = 20;
const CONCURRENCY = 3;
const CONCURRENCY_KR = 2;
const INTER_TICKER_DELAY_MS = 500;
const INTER_TICKER_DELAY_KR_MS = 800;
const RETRY_429_DELAY_MS = 3000;

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

/** Yahoo's HTTP 429 surfaces in error messages as either the status code
 *  itself or the canonical "Too Many Requests" phrase. */
function is429(err: unknown): boolean {
  const msg = (err as { message?: string })?.message ?? String(err);
  return /\b429\b|Too Many Requests/i.test(msg);
}

const FILTERS: ReadonlySet<ScreenFilter> = new Set([
  'all', 'breakout_us', 'entry_us', 'uptrend_us', 'breakout_kr', 'entry_kr', 'uptrend_kr',
]);

function isFilter(v: string | undefined): v is ScreenFilter {
  return v != null && FILTERS.has(v as ScreenFilter);
}

function isKrFilter(f: ScreenFilter): boolean {
  return f === 'breakout_kr' || f === 'entry_kr' || f === 'uptrend_kr';
}

/** Fisher–Yates sample (without replacement) of size `n` from `pool`. */
function sampleFrom(pool: readonly string[], n: number): string[] {
  const copy = [...pool];
  const k = Math.min(n, copy.length);
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(Math.random() * (copy.length - i));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, k);
}

async function buildPool(filter: ScreenFilter): Promise<string[]> {
  if (isKrFilter(filter)) {
    return [...KR_TICKERS];
  }
  try {
    const dynamic = await fetchScreenerPool('all', {});
    const merged = Array.from(new Set([...dynamic, ...SP500]));
    if (merged.length >= 20) return merged;
    return Array.from(new Set([...merged, ...SCREENER_POOL]));
  } catch {
    return Array.from(new Set([...SP500, ...SCREENER_POOL]));
  }
}

function toSummary(ticker: string, r: AnalysisResult): ScreenerSummary {
  const latest = r.priceBars[0]?.close ?? null;
  const ema20 = r.indicators.ema20;
  const ema20Pct = (ema20 != null && latest != null && ema20 > 0)
    ? Math.round(((latest - ema20) / ema20) * 1000) / 10
    : null;
  const changePct = (r.priceBars.length >= 2 && r.priceBars[1]?.close > 0)
    ? Math.round(((r.priceBars[0].close - r.priceBars[1].close) / r.priceBars[1].close) * 1000) / 10
    : null;
  return {
    ticker,
    ok: true,
    primary: r.classification.primary,
    display: r.classification.display,
    uncertain: r.classification.uncertain,
    overall: r.overallScore.score,
    overallLevel: r.overallScore.level,
    fundamental: r.fundamentalScore.score,
    fundamentalLevel: r.fundamentalScore.level,
    // timing exposed in raw 0-90 — matches the card gauge and the filter
    // thresholds below, so users don't see a different number than the
    // criterion they filtered on.
    timing: r.timingScore.score,
    timingLevel: r.timingScore.level,
    safetyTriggered: r.safetyGuard.triggered,
    breakoutReady: isBreakoutReady(r),
    entryReady: isEntryReady(r),
    uptrendConfirmed: isUptrendConfirmed(r),
    name: r.fundamental.name,
    price: latest,
    ema20Pct,
    changePct,
  };
}

// 돌파대기 — 펀더 단단 + 추세 시작 + 진입 위치 합리 + 거래량 살아있음.
// 타이밍은 raw 0-90; 진입적기(≥70) 직전 구간만 잡는다.
function isBreakoutReady(r: AnalysisResult): boolean {
  const isKR = /\.(KS|KQ)$/i.test(r.fundamental.ticker);
  const fundMin = isKR ? 60 : 65;
  const timingMin = isKR ? 40 : 45;
  const timingMax = 69;
  const adxMin = isKR ? 15 : 18;
  const adxMax = 35;
  const rsMin = isKR ? 55 : 60;
  const emaDistMin = -0.03;
  const emaDistMax = isKR ? 0.10 : 0.08;
  const rsiMin = isKR ? 40 : 45;
  const rsiMax = 68;
  const volMin = isKR ? 0.5 : 0.7;

  if (r.fundamentalScore.score < fundMin) return false;
  const ts = r.timingScore.score;
  if (ts < timingMin || ts > timingMax) return false;
  const { adx, rs, rsi, ema20, sma200, volumeRatio, obvDivergence } = r.indicators;
  if (adx == null || adx < adxMin || adx > adxMax) return false;
  if (rs == null || rs < rsMin) return false;
  const close = r.priceBars[0]?.close;
  if (close == null) return false;
  if (sma200 == null || close <= sma200) return false;
  if (ema20 == null || ema20 <= 0) return false;
  const dist = (close - ema20) / ema20;
  if (dist < emaDistMin || dist > emaDistMax) return false;
  if (rsi == null || rsi < rsiMin || rsi > rsiMax) return false;
  if (volumeRatio == null || volumeRatio < volMin) return false;
  if (obvDivergence === true) return false;
  if (r.safetyGuard.triggered) return false;
  return true;
}

function isEntryReady(r: AnalysisResult): boolean {
  const { adx, ema20, rsi, obvDivergence } = r.indicators;
  const close = r.priceBars[0]?.close;
  const isKR = /\.(KS|KQ)$/i.test(r.fundamental.ticker);
  const fundMin = isKR ? 60 : 65;
  // raw 0-90: KR 65 / US 70 — aligns with entryGrade '진입 적기' threshold.
  const timingMin = isKR ? 65 : 70;
  const adxMin = isKR ? 20 : 25;
  const emaPctLimit = isKR ? 0.05 : 0.03;
  const rsiMin = isKR ? 40 : 45;
  const rsiMax = 65;
  if (r.fundamentalScore.score < fundMin) return false;
  if (r.timingScore.score < timingMin) return false;
  if (adx == null || adx < adxMin) return false;
  if (close == null || ema20 == null || ema20 <= 0) return false;
  if (Math.abs((close - ema20) / ema20) > emaPctLimit) return false;
  if (rsi == null || rsi < rsiMin || rsi > rsiMax) return false;
  const slopeMin = isKR ? 0 : 0.1;
  const slope = r.timingDetail?.ema20Slope?.slope;
  if (slope == null || slope <= slopeMin) return false;
  if (obvDivergence === true) return false;
  if (r.safetyGuard.triggered) return false;
  return true;
}

function isUptrendConfirmed(r: AnalysisResult): boolean {
  const adx = r.indicators.adx;
  const isKR = /\.(KS|KQ)$/i.test(r.fundamental.ticker);
  const overallMin = isKR ? 65 : 70;
  // raw 0-90 — same alignment as isEntryReady.
  const timingMin = isKR ? 65 : 70;
  const adxMin = isKR ? 20 : 25;
  if (r.overallScore.score < overallMin) return false;
  if (r.timingScore.score < timingMin) return false;
  if (adx == null || adx < adxMin) return false;
  const { ema20, sma50, sma200 } = r.indicators;
  const close = r.priceBars[0]?.close;
  if (close == null || ema20 == null || sma50 == null || sma200 == null) return false;
  if (!(close > ema20 && ema20 > sma50 && sma50 > sma200)) return false;
  if (r.indicators.obvDivergence === true) return false;
  return true;
}

/** Stream SSE-formatted strings via a callback so this works in both Vercel
 *  Functions (res.write) and the local dev server (also res.write). */
function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export interface ScreenerWriter {
  write(chunk: string): void;
  end(): void;
}

export async function runScreener(
  tickers: string[],
  writer: ScreenerWriter,
  opts?: { concurrency?: number; interTickerDelay?: number },
): Promise<void> {
  const concurrency = opts?.concurrency ?? CONCURRENCY;
  const interDelay = opts?.interTickerDelay ?? INTER_TICKER_DELAY_MS;

  writer.write(sseFrame('start', { total: tickers.length, tickers }));

  let nextIdx = 0;
  let completed = 0;
  let skipped = 0;
  const worker = async () => {
    while (true) {
      const i = nextIdx++;
      if (i >= tickers.length) return;
      const t = tickers[i];

      // First attempt → on 429, wait and retry once → on persistent 429,
      // skip silently (no result event). Other errors emit as before.
      let didSkip = false;
      try {
        const result = await analyzeOne(t);
        writer.write(sseFrame('result', toSummary(t, result)));
      } catch (err) {
        if (is429(err)) {
          await sleep(RETRY_429_DELAY_MS);
          try {
            const result = await analyzeOne(t);
            writer.write(sseFrame('result', toSummary(t, result)));
          } catch (retryErr) {
            if (is429(retryErr)) {
              didSkip = true;
            } else {
              writer.write(
                sseFrame('result', {
                  ticker: t,
                  ok: false,
                  error: (retryErr as Error).message,
                } satisfies ScreenerSummary),
              );
            }
          }
        } else {
          writer.write(
            sseFrame('result', {
              ticker: t,
              ok: false,
              error: (err as Error).message,
            } satisfies ScreenerSummary),
          );
        }
      }

      completed++;
      if (didSkip) skipped++;
      writer.write(
        sseFrame('progress', {
          completed,
          total: tickers.length,
          skipped,
        }),
      );

      // Throttle: pause between analyses inside the same worker to ease
      // Yahoo's rate-limit. Skip on the very last ticker.
      if (nextIdx < tickers.length) {
        await sleep(interDelay);
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, worker));
  writer.write(sseFrame('done', { total: tickers.length }));
  writer.end();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const nRaw = req.query.n;
  const n = Math.max(1, Math.min(100, Number(nRaw ?? DEFAULT_N) || DEFAULT_N));
  const filterRaw = req.query.filter as string | undefined;
  const filter: ScreenFilter = isFilter(filterRaw) ? filterRaw : 'all';

  const tickersParam = req.query.tickers as string | undefined;
  const isWatchlist = req.query.mode === 'watchlist';
  let tickers: string[];
  if (tickersParam) {
    const raw = Array.from(
      new Set(
        tickersParam.split(',').map((t) => t.trim().toUpperCase()).filter(Boolean),
      ),
    );
    tickers = isWatchlist
      ? raw.slice(0, 100)
      : raw.filter((t) => SCREENER_POOL.includes(t)).slice(0, 40);
  } else {
    const pool = await buildPool(filter);
    // Cumulative scans: client passes already-analyzed tickers as ?exclude=
    // so the new batch yields fresh, non-overlapping picks.
    const excludeRaw = req.query.exclude as string | undefined;
    const exclude = excludeRaw
      ? new Set(
          excludeRaw
            .split(',')
            .map((t) => t.trim().toUpperCase())
            .filter(Boolean),
        )
      : null;
    const eligible = exclude ? pool.filter((t) => !exclude.has(t)) : pool;
    tickers = sampleFrom(eligible, n);
  }

  if (tickers.length === 0) {
    return res.status(400).json({ error: 'no_tickers' });
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  // Disable response buffering on Vercel/proxies
  res.setHeader('X-Accel-Buffering', 'no');
  // Flush headers
  if (typeof (res as unknown as { flushHeaders?: () => void }).flushHeaders === 'function') {
    (res as unknown as { flushHeaders: () => void }).flushHeaders();
  }

  const writer: ScreenerWriter = {
    write: (chunk: string) => {
      res.write(chunk);
    },
    end: () => {
      res.end();
    },
  };

  const screenerOpts = isKrFilter(filter)
    ? { concurrency: CONCURRENCY_KR, interTickerDelay: INTER_TICKER_DELAY_KR_MS }
    : undefined;

  try {
    await runScreener(tickers, writer, screenerOpts);
  } catch (err) {
    res.write(sseFrame('error', { message: (err as Error).message }));
    res.end();
  }
}
