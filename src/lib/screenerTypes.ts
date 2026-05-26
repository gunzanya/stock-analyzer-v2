// Shared types for the random screener — kept in src/lib/ so both the
// client (Vite, scope = src/) and the server (api/) can import them
// without crossing build boundaries.

import type { AnalysisResult } from './types.js';

export interface ScreenerSummary {
  ticker: string;
  ok: boolean;
  error?: string;
  // Slim payload — full AnalysisResult would balloon the SSE stream. The
  // screener table only needs scores + classification + safety flag; the
  // full result is re-fetched when the user clicks into a row.
  primary?: AnalysisResult['classification']['primary'];
  primaryRatio?: number;
  secondary?: AnalysisResult['classification']['secondary'];
  secondaryRatio?: number;
  display?: string;
  uncertain?: boolean;
  // overall/fundamental are 0–100; timing is raw 0–90 (matches the card
  // gauge and the breakout/entry/uptrend filter thresholds).
  overall?: number;
  overallLevel?: AnalysisResult['overallScore']['level'];
  fundamental?: number;
  fundamentalLevel?: AnalysisResult['fundamentalScore']['level'];
  timing?: number;
  timingLevel?: AnalysisResult['timingScore']['level'];
  safetyTriggered?: boolean;
  /** True when the ticker matches the "돌파 대기" pattern: solid fundamentals,
   *  timing in the pre-진입적기 band, ADX in trend-forming range, RS leading
   *  the benchmark, close > SMA200, EMA20 distance within a healthy band,
   *  RSI mid-range, real volume, no OBV divergence, no safety trigger. Set
   *  on every row; client uses it when the breakout filter is active. */
  breakoutReady?: boolean;
  entryReady?: boolean;
  uptrendConfirmed?: boolean;
  name?: string;
  price?: number | null;
  ema20Pct?: number | null;
  changePct?: number | null;
}
