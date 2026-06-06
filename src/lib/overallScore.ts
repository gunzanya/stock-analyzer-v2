// Overall score — weighted blend of Fundamental (CANSLIM-based) and Timing
// (Composite, 0–100). UI label: "종합". Both inputs share the 0–100 axis,
// so no rescale is needed. Weights skew slightly toward fundamentals
// (0.55) over timing (0.45) — what to own matters more than when, but the
// latter is meaningful enough to deserve near-equal weight.

import type {
  FundamentalScoreResult,
  OverallScoreResult,
  StockType,
  TimingScoreResult,
} from './types.js';

export const OVERALL_FUNDAMENTAL_WEIGHT = 0.55;
export const OVERALL_TIMING_WEIGHT = 0.45;

function levelOf(score: number): OverallScoreResult['level'] {
  if (score >= 70) return 'STRONG';
  if (score >= 60) return 'WATCH';
  if (score >= 50) return 'NEUTRAL';
  return 'AVOID';
}

export function computeOverall(
  fundamental: FundamentalScoreResult,
  timing: TimingScoreResult,
  primaryType?: StockType | null,
): OverallScoreResult {
  const blended =
    fundamental.score * OVERALL_FUNDAMENTAL_WEIGHT +
    timing.score * OVERALL_TIMING_WEIGHT;
  let score = Math.max(0, Math.min(100, Math.round(blended)));
  if (primaryType === 'SPECULATIVE') score = Math.min(score, 65);
  return { score, level: levelOf(score) };
}
