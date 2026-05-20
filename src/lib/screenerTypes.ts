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
  totalScore?: number;
  totalLevel?: AnalysisResult['totalScore']['level'];
  entryScore?: number;
  entryLevel?: AnalysisResult['entryScore']['level'];
  safetyTriggered?: boolean;
  name?: string;
  price?: number | null;
}
