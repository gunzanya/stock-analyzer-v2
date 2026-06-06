import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';
import { fetchYahooPriceHistory } from './fetchStock.js';
import { computeRegime } from '../src/lib/marketRegime.js';
import type { MarketRegime, RegimeSeries } from '../src/lib/marketRegime.js';

// Bond/rate data barely moves intraday and the same global snapshot is shared
// by every visitor, so we cache aggressively (1 hour). Two layers:
//   1) Upstash Redis — survives across serverless invocations / instances.
//   2) Module-level memory — covers a warm instance even without Redis env
//      (e.g. local dev), and saves a Redis round-trip on hot paths.
const CACHE_KEY = 'market_regime:v1';
const TTL_SECONDS = 60 * 60;

const redis =
  process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN
    ? new Redis({
        url: process.env.KV_REST_API_URL,
        token: process.env.KV_REST_API_TOKEN,
      })
    : null;

let memCache: { at: number; data: MarketRegime } | null = null;

// ^TNX / ^IRX are yield indices (close = yield %); the others are ETFs.
const TICKERS = ['^TNX', '^IRX', 'TLT', 'HYG', 'LQD'] as const;
const EMPTY_SERIES: RegimeSeries = { closes: [], volumes: [] };

async function fetchSeries(ticker: string): Promise<RegimeSeries> {
  try {
    // 90 calendar days comfortably yields the 21 trading bars the 20-day
    // lookbacks need, even across holidays.
    const bars = await fetchYahooPriceHistory(ticker, 90);
    return {
      closes: bars.map((b) => b.close),
      volumes: bars.map((b) => b.volume),
    };
  } catch (err) {
    console.warn(`[market-regime] ${ticker} fetch failed:`, (err as Error).message);
    return EMPTY_SERIES;
  }
}

async function computeFresh(): Promise<MarketRegime> {
  const [tnx, irx, tlt, hyg, lqd] = await Promise.all(TICKERS.map(fetchSeries));
  const asOf = new Date().toISOString().slice(0, 10);
  return computeRegime({ tnx, irx, tlt, hyg, lqd, asOf });
}

/** Cached market-regime read. Shared by the HTTP handler and the dev server. */
export async function getMarketRegime(): Promise<MarketRegime> {
  const now = Date.now();
  if (memCache && now - memCache.at < TTL_SECONDS * 1000) {
    return memCache.data;
  }
  if (redis) {
    try {
      const cached = await redis.get<MarketRegime>(CACHE_KEY);
      if (cached) {
        memCache = { at: now, data: cached };
        return cached;
      }
    } catch (err) {
      console.warn('[market-regime] redis get failed:', (err as Error).message);
    }
  }

  const fresh = await computeFresh();
  memCache = { at: now, data: fresh };
  if (redis) {
    try {
      await redis.set(CACHE_KEY, fresh, { ex: TTL_SECONDS });
    } catch (err) {
      console.warn('[market-regime] redis set failed:', (err as Error).message);
    }
  }
  return fresh;
}

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const regime = await getMarketRegime();
    // Mirror the server-side TTL on the CDN edge.
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');
    return res.status(200).json(regime);
  } catch (err) {
    return res.status(502).json({
      error: 'market_regime_failed',
      message: (err as Error).message,
    });
  }
}
