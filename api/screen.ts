import type { VercelRequest, VercelResponse } from '@vercel/node';
import { analyzeOne } from './analyze.js';
import { fetchScreenerPool, type ScreenerFilter } from './fetchStock.js';
import { SCREENER_POOL } from '../src/lib/screenerPool.js';
import { SP500 } from '../src/lib/sp500.js';
import { KR_STOCKS } from '../src/lib/krStocks.js';
import type { AnalysisResult } from '../src/lib/types.js';
import type { ScreenerSummary } from '../src/lib/screenerTypes.js';

const DEFAULT_N = 20;
// Conservative pacing: 3 workers + 500ms post-analysis delay + 429 retry.
// Stability over speed — n=20/50 fits comfortably in the 60s Vercel budget;
// n=100 may exceed it under heavy load and end as a partial stream.
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

const FILTERS: ReadonlySet<ScreenerFilter> = new Set([
  'all',
  'large_cap',
  'small_mid',
  'tech',
  'breakout',
  'kr',
]);

// Whether to augment the Yahoo dynamic pool with the static S&P 500 list.
// S&P 500 are all large caps, so adding them to small_mid / tech would
// dilute those filters' intent.
const MERGE_SP500: Record<ScreenerFilter, boolean> = {
  all: true,
  breakout: true,
  large_cap: true,
  small_mid: false,
  tech: false,
  kr: false,
};

function isFilter(v: string | undefined): v is ScreenerFilter {
  return v != null && FILTERS.has(v as ScreenerFilter);
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

/** Build the candidate pool: Yahoo dynamic screener union'd with the
 *  static S&P 500 list (for size-agnostic filters). Falls back to the
 *  curated SCREENER_POOL if Yahoo is unreachable so the screener still
 *  works offline. */
async function buildPool(filter: ScreenerFilter): Promise<string[]> {
  if (filter === 'kr') {
    return [...KR_STOCKS];
  }
  const opts =
    filter === 'large_cap'
      ? { minMarketCap: 10e9 }
      : filter === 'small_mid'
        ? { maxMarketCap: 10e9 }
        : {};
  const staticAugment = MERGE_SP500[filter] ? SP500 : [];
  try {
    const dynamic = await fetchScreenerPool(filter, opts);
    const merged = Array.from(new Set([...dynamic, ...staticAugment]));
    if (merged.length >= 20) return merged;
    // Extremely sparse — top up with the curated fallback list too.
    return Array.from(new Set([...merged, ...SCREENER_POOL]));
  } catch {
    return Array.from(new Set([...staticAugment, ...SCREENER_POOL]));
  }
}

function toSummary(ticker: string, r: AnalysisResult): ScreenerSummary {
  const latest = r.priceBars[0]?.close ?? null;
  const timingPct = Math.round((r.timingScore.score / 90) * 100);
  const breakoutReady = isBreakoutReady(r);
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
    // Rescale timing from its native 0–90 to 0–100 so all three scores
    // share an axis when the client sorts/filters.
    timing: timingPct,
    timingLevel: r.timingScore.level,
    safetyTriggered: r.safetyGuard.triggered,
    breakoutReady,
    name: r.fundamental.name,
    price: latest,
  };
}

/** 돌파 대기 — fundamentals strong, timing not yet hot, ADX building, no
 *  obvious distribution or sector blowup. The trade is to enter when ADX
 *  crosses 25 (trend confirms).
 *  Korean tickers use relaxed thresholds (higher volatility market). */
function isBreakoutReady(r: AnalysisResult): boolean {
  const timingPct = (r.timingScore.score / 90) * 100;
  const adx = r.indicators.adx;
  const isKR = /\.(KS|KQ)$/i.test(r.fundamental.ticker);
  const fundThreshold = isKR ? 65 : 70;
  const timingMin = isKR ? 20 : 25;
  const timingMax = isKR ? 60 : 55;
  if (r.fundamentalScore.score < fundThreshold) return false;
  if (timingPct < timingMin || timingPct > timingMax) return false;
  if (adx == null || adx < 15 || adx > 25) return false;
  if (r.indicators.obvDivergence === true) return false;
  if (r.safetyGuard.triggered) return false;
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
  const filter: ScreenerFilter = isFilter(filterRaw) ? filterRaw : 'all';

  const tickersParam = req.query.tickers as string | undefined;
  let tickers: string[];
  if (tickersParam) {
    // Explicit tickers (e.g. for testing); validate against the static pool
    // to keep the surface narrow.
    tickers = Array.from(
      new Set(
        tickersParam.split(',').map((t) => t.trim().toUpperCase()).filter(Boolean),
      ),
    )
      .filter((t) => SCREENER_POOL.includes(t))
      .slice(0, 40);
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

  const screenerOpts = filter === 'kr'
    ? { concurrency: CONCURRENCY_KR, interTickerDelay: INTER_TICKER_DELAY_KR_MS }
    : undefined;

  try {
    await runScreener(tickers, writer, screenerOpts);
  } catch (err) {
    res.write(sseFrame('error', { message: (err as Error).message }));
    res.end();
  }
}
