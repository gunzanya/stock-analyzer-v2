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
  // overall/fundamental/timing are all 0–100. Timing is the Composite score
  // (entryLocation*0.35 + trendQuality*0.25 + volumeConfirmation*0.15 +
  // overheatControl*0.15 + marketSupport*0.10).
  overall?: number;
  overallLevel?: AnalysisResult['overallScore']['level'];
  fundamental?: number;
  fundamentalLevel?: AnalysisResult['fundamentalScore']['level'];
  timing?: number;
  timingLevel?: AnalysisResult['timingScore']['level'];
  /** Composite's overheatControl component (0–100; higher = safer). Used by
   *  the entry-ready screener gate to exclude high-overheat names regardless
   *  of how high their Composite score is. */
  overheatControl?: number | null;
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
