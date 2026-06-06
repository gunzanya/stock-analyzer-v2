// Frontend → /api/analyze client

import type { AnalysisResult } from './types.js';
import type { MarketRegime } from './marketRegime.js';

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

// The regime is global and server-cached for an hour; a short client-side cache
// keeps the Screener and Watchlist panels from each firing their own request on
// mount (and de-dupes concurrent calls via the shared in-flight promise).
const REGIME_TTL_MS = 10 * 60 * 1000;
let regimeCache: { at: number; data: MarketRegime } | null = null;
let regimeInflight: Promise<MarketRegime> | null = null;

export async function fetchMarketRegime(): Promise<MarketRegime> {
  if (regimeCache && Date.now() - regimeCache.at < REGIME_TTL_MS) {
    return regimeCache.data;
  }
  if (regimeInflight) return regimeInflight;

  regimeInflight = (async () => {
    try {
      const res = await fetch('/api/market-regime');
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
      const data = (await res.json()) as MarketRegime;
      regimeCache = { at: Date.now(), data };
      return data;
    } finally {
      regimeInflight = null;
    }
  })();
  return regimeInflight;
}
