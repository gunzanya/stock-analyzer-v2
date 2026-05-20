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
  display?: string;
  uncertain?: boolean;
  // Scores are all 0–100 (timing is pre-rescaled from its 0–90 native range).
  overall?: number;
  overallLevel?: AnalysisResult['overallScore']['level'];
  fundamental?: number;
  fundamentalLevel?: AnalysisResult['fundamentalScore']['level'];
  timing?: number;
  timingLevel?: AnalysisResult['timingScore']['level'];
  safetyTriggered?: boolean;
  /** True when the ticker matches the "돌파 대기" pattern: solid fundamentals
   *  (펀더 ≥70), middling timing (25–55), ADX 15–25 (trend forming), no OBV
   *  divergence, no safety trigger. Set on every row regardless of the
   *  selected filter; client uses it when the breakout filter is active. */
  breakoutReady?: boolean;
  name?: string;
  price?: number | null;
}
