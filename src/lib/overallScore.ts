// Overall score — weighted blend of Fundamental (CANSLIM-based) and Timing
// (technical setup). UI label: "종합".
//
// Timing is natively 0–90; we rescale to 0–100 before blending so the two
// inputs sit on the same axis. Weights skew slightly toward fundamentals
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
  // Timing is 0–90; rescale to 0–100 to match Fundamental's range.
  const timingPct = (timing.score / 90) * 100;
  const blended =
    fundamental.score * OVERALL_FUNDAMENTAL_WEIGHT +
    timingPct * OVERALL_TIMING_WEIGHT;
  let score = Math.max(0, Math.min(100, Math.round(blended)));
  if (primaryType === 'SPECULATIVE') score = Math.min(score, 65);
  return { score, level: levelOf(score) };
}
