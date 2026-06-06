import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';
import { fetchYahooPriceHistory } from './fetchStock.js';
import {
  BENCHMARK,
  SECTOR_TICKERS,
  computeSectorRegime,
} from '../src/lib/sectorRegime.js';
import type { SectorRegime } from '../src/lib/sectorRegime.js';
import type { PriceBar } from '../src/lib/types.js';

// Sector ETF data barely moves intraday and the snapshot is global, so cache 1
// hour. Two layers (Redis across invocations + module memory on warm instances)
// — same pattern as api/market-regime.ts.
const CACHE_KEY = 'sector_regime:v1';
const TTL_SECONDS = 60 * 60;

const redis =
  process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN
    ? new Redis({
        url: process.env.KV_REST_API_URL,
        token: process.env.KV_REST_API_TOKEN,
      })
    : null;

let memCache: { at: number; data: SectorRegime } | null = null;

async function fetchBars(ticker: string): Promise<PriceBar[]> {
  try {
    // 400 calendar days ≈ 270 trading bars — enough lookback for SMA200.
    return await fetchYahooPriceHistory(ticker, 400);
  } catch (err) {
    console.warn(`[sector-regime] ${ticker} fetch failed:`, (err as Error).message);
    return [];
  }
}

async function computeFresh(): Promise<SectorRegime> {
  const tickers = [BENCHMARK, ...SECTOR_TICKERS];
  const allBars = await Promise.all(tickers.map(fetchBars));
  const spyBars = allBars[0];
  const etfBars: Record<string, PriceBar[]> = {};
  SECTOR_TICKERS.forEach((t, i) => {
    etfBars[t] = allBars[i + 1];
  });

  const asOf = new Date().toISOString().slice(0, 10);
  const regime = computeSectorRegime(spyBars, etfBars, asOf);

  // Verification aid: dump every sector score to the function log.
  console.log(
    `[sector-regime] ${asOf} vs ${regime.benchmark} (${regime.sectors.length} ETFs, stale=${regime.stale})`,
  );
  for (const s of regime.sectors) {
    const r3 = s.return3M != null ? `${(s.return3M * 100).toFixed(1)}%` : 'n/a';
    console.log(
      `  ${s.status.padEnd(7)} ${s.ticker.padEnd(5)} ${s.label.padEnd(8)} ` +
        `score=${String(s.score).padStart(3)} rs=${String(s.rs).padStart(3)} 3M=${r3}`,
    );
  }
  return regime;
}

/** Cached sector-regime read. Shared by the HTTP handler and the dev server. */
export async function getSectorRegime(): Promise<SectorRegime> {
  const now = Date.now();
  if (memCache && now - memCache.at < TTL_SECONDS * 1000) {
    return memCache.data;
  }
  if (redis) {
    try {
      const cached = await redis.get<SectorRegime>(CACHE_KEY);
      if (cached) {
        memCache = { at: now, data: cached };
        return cached;
      }
    } catch (err) {
      console.warn('[sector-regime] redis get failed:', (err as Error).message);
    }
  }

  const fresh = await computeFresh();
  memCache = { at: now, data: fresh };
  if (redis) {
    try {
      await redis.set(CACHE_KEY, fresh, { ex: TTL_SECONDS });
    } catch (err) {
      console.warn('[sector-regime] redis set failed:', (err as Error).message);
    }
  }
  return fresh;
}

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const regime = await getSectorRegime();
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');
    return res.status(200).json(regime);
  } catch (err) {
    return res.status(502).json({
      error: 'sector_regime_failed',
      message: (err as Error).message,
    });
  }
}
