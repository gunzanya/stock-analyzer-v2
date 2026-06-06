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
    primaryRatio: r.classification.primaryRatio,
    secondary: r.classification.secondary,
    secondaryRatio: r.classification.secondaryRatio,
    display: r.classification.display,
    uncertain: r.classification.uncertain,
    overall: r.overallScore.score,
    overallLevel: r.overallScore.level,
    fundamental: r.fundamentalScore.score,
    fundamentalLevel: r.fundamentalScore.level,
    // timing = Composite (0–100). Matches the card gauge and the gate
    // thresholds below.
    timing: r.timingScore.score,
    timingLevel: r.timingScore.level,
    overheatControl: r.timingComposite?.overheatControl ?? null,
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

// Shared chase-warning check — composite already encodes entry/trend/vol
// signals; chase-warning fires from analyze.ts when overheat < 30 OR the
// classic pathA/pathB triggers hit.
function isChase(r: AnalysisResult): boolean {
  return r.riskFactors.some((rk) => rk.message.startsWith('🚨 사이클 상단'));
}

// 돌파대기 — Composite 45~74 (진입적기 직전 구간) + 펀더 통과 + 안전장치/추격
// 미발동. Composite는 진입 위치/추세/거래량/시장 지지를 이미 가중평균으로
// 합산하므로 별도 ADX/RSI/EMA 거리 게이트는 제거.
function isBreakoutReady(r: AnalysisResult): boolean {
  const isKR = /\.(KS|KQ)$/i.test(r.fundamental.ticker);
  const fundMin = isKR ? 60 : 65;
  if (r.fundamentalScore.score < fundMin) return false;
  const ts = r.timingScore.score;
  if (ts < 45 || ts > 74) return false;
  if (r.safetyGuard.triggered) return false;
  if (isChase(r)) return false;
  return true;
}

// 진입적기 — Composite ≥ 75 + 과열 제어 ≥ 50 + 펀더 + 안전장치/추격 미발동.
// 추격주의는 overheatControl < 30에서 자동 발동하므로 50 게이트가 그 위
// 한 단계 더 보수적 필터로 작동.
function isEntryReady(r: AnalysisResult): boolean {
  const isKR = /\.(KS|KQ)$/i.test(r.fundamental.ticker);
  const fundMin = isKR ? 60 : 65;
  if (r.fundamentalScore.score < fundMin) return false;
  if (r.timingScore.score < 75) return false;
  const overheat = r.timingComposite?.overheatControl ?? null;
  if (overheat == null || overheat < 50) return false;
  if (r.safetyGuard.triggered) return false;
  if (isChase(r)) return false;
  return true;
}

// 상승추세 확정 — Composite ≥ 65 + 종합 점수도 상위 구간 + 펀더 + 안전장치/추격
// 미발동. (Composite는 trendQuality에 EMA20>SMA50>SMA200 정배열을 이미 100점
// 보너스로 반영.)
function isUptrendConfirmed(r: AnalysisResult): boolean {
  const isKR = /\.(KS|KQ)$/i.test(r.fundamental.ticker);
  const fundMin = isKR ? 60 : 65;
  const overallMin = isKR ? 65 : 70;
  if (r.fundamentalScore.score < fundMin) return false;
  if (r.overallScore.score < overallMin) return false;
  if (r.timingScore.score < 65) return false;
  if (r.safetyGuard.triggered) return false;
  if (isChase(r)) return false;
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
