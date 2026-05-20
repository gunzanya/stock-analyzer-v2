import type { VercelRequest, VercelResponse } from '@vercel/node';
import { analyzeOne } from './analyze.js';
import { fetchScreenerPool, type ScreenerFilter } from './fetchStock.js';
import { SCREENER_POOL } from '../src/lib/screenerPool.js';
import type { AnalysisResult } from '../src/lib/types.js';
import type { ScreenerSummary } from '../src/lib/screenerTypes.js';

const DEFAULT_N = 20;
const CONCURRENCY = 4;

const FILTERS: ReadonlySet<ScreenerFilter> = new Set([
  'all',
  'large_cap',
  'small_mid',
  'tech',
]);

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

/** Build the candidate pool: dynamic via Yahoo screener, with the hardcoded
 *  SCREENER_POOL as a last-resort fallback if Yahoo is unreachable. */
async function buildPool(filter: ScreenerFilter): Promise<string[]> {
  const opts =
    filter === 'large_cap'
      ? { minMarketCap: 10e9 }
      : filter === 'small_mid'
        ? { maxMarketCap: 10e9 }
        : {};
  try {
    const dynamic = await fetchScreenerPool(filter, opts);
    if (dynamic.length >= 20) return dynamic;
    // Sparse result — merge with fallback so the user always gets ~20 picks.
    return Array.from(new Set([...dynamic, ...SCREENER_POOL]));
  } catch {
    return [...SCREENER_POOL];
  }
}

function toSummary(ticker: string, r: AnalysisResult): ScreenerSummary {
  const latest = r.priceBars[0]?.close ?? null;
  return {
    ticker,
    ok: true,
    primary: r.classification.primary,
    display: r.classification.display,
    uncertain: r.classification.uncertain,
    totalScore: r.totalScore.score,
    totalLevel: r.totalScore.level,
    entryScore: r.entryScore.score,
    entryLevel: r.entryScore.level,
    safetyTriggered: r.safetyGuard.triggered,
    name: r.fundamental.name,
    price: latest,
  };
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
): Promise<void> {
  writer.write(sseFrame('start', { total: tickers.length, tickers }));

  let nextIdx = 0;
  let completed = 0;
  const worker = async () => {
    while (true) {
      const i = nextIdx++;
      if (i >= tickers.length) return;
      const t = tickers[i];
      try {
        const result = await analyzeOne(t);
        writer.write(sseFrame('result', toSummary(t, result)));
      } catch (err) {
        writer.write(
          sseFrame('result', {
            ticker: t,
            ok: false,
            error: (err as Error).message,
          } satisfies ScreenerSummary),
        );
      }
      completed++;
      writer.write(sseFrame('progress', { completed, total: tickers.length }));
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  writer.write(sseFrame('done', { total: tickers.length }));
  writer.end();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const nRaw = req.query.n;
  const n = Math.max(1, Math.min(40, Number(nRaw ?? DEFAULT_N) || DEFAULT_N));
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
    tickers = sampleFrom(pool, n);
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

  try {
    await runScreener(tickers, writer);
  } catch (err) {
    res.write(sseFrame('error', { message: (err as Error).message }));
    res.end();
  }
}
