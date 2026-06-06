// Frontend → /api/analyze client

import type { AnalysisResult } from './types.js';
import type { MarketRegime } from './marketRegime.js';
import type { SectorRegime } from './sectorRegime.js';

export async function fetchAnalysis(ticker: string): Promise<AnalysisResult> {
  const res = await fetch(`/api/analyze?ticker=${encodeURIComponent(ticker)}`);
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { message?: string; error?: string };
      msg = body.message ?? body.error ?? msg;
    } catch {
      // ignore JSON parse
    }
    throw new Error(`${ticker}: ${msg}`);
  }
  return (await res.json()) as AnalysisResult;
}

// Regime endpoints are global and server-cached for an hour; a short client-side
// cache keeps the Screener/Watchlist panels (and StockCards) from each firing
// their own request on mount, and de-dupes concurrent calls via the shared
// in-flight promise.
const REGIME_TTL_MS = 10 * 60 * 1000;

interface CachedEndpoint<T> {
  cache: { at: number; data: T } | null;
  inflight: Promise<T> | null;
}

function makeCachedFetch<T>(url: string): () => Promise<T> {
  const state: CachedEndpoint<T> = { cache: null, inflight: null };
  return async () => {
    if (state.cache && Date.now() - state.cache.at < REGIME_TTL_MS) {
      return state.cache.data;
    }
    if (state.inflight) return state.inflight;
    state.inflight = (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) {
          let msg = `HTTP ${res.status}`;
          try {
            const body = (await res.json()) as { message?: string; error?: string };
            msg = body.message ?? body.error ?? msg;
          } catch {
            // ignore JSON parse
          }
          throw new Error(msg);
        }
        const data = (await res.json()) as T;
        state.cache = { at: Date.now(), data };
        return data;
      } finally {
        state.inflight = null;
      }
    })();
    return state.inflight;
  };
}

export const fetchMarketRegime = makeCachedFetch<MarketRegime>('/api/market-regime');
export const fetchSectorRegime = makeCachedFetch<SectorRegime>('/api/sector-regime');
