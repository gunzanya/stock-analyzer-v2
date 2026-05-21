// Fundamental score — weighted average of the 12 CANSLIM items.
// Universal weights — stock type no longer affects scoring.
// Type classification is used only for insight cards and sell signals.
// (Renamed from TotalScore; UI label is "펀더멘탈".)

import type {
  CanslimKey,
  CanslimResult,
  ClassificationResult,
  FundamentalScoreResult,
} from './types.js';
import { CANSLIM_KEYS, CANSLIM_LABELS } from './canslim.js';

// Universal weights — sums to 100.
//   C: 분기EPS 12  A: 연간EPS 10  G: 매출성장 10
//   L: RS/리더  10  V: 밸류에이션 10  Q: 수익성   10
//   T: 추세     10  B: 재무건전  8   N: 신고가    6
//   S: 수급      5  M: 시장방향  5   I: 기관      4
const WEIGHTS: Record<CanslimKey, number> = {
  C: 12, A: 10, G: 10,
  L: 10, V: 10, Q: 10,
  T: 10, B: 8,  N: 6,
  S: 5,  M: 5,  I: 4,
};

function levelOf(score: number): FundamentalScoreResult['level'] {
  if (score >= 70) return 'STRONG';
  if (score >= 50) return 'WATCH';
  if (score >= 30) return 'NEUTRAL';
  return 'AVOID';
}

export function computeFundamental(
  canslim: CanslimResult,
  classification: ClassificationResult,
): FundamentalScoreResult {
  const scoreByKey: Record<CanslimKey, number> = {} as Record<CanslimKey, number>;
  for (const item of canslim.items) scoreByKey[item.key] = item.score;

  // Weighted average — universal weights, no type dependency
  let total = 0;
  for (const k of CANSLIM_KEYS) total += scoreByKey[k] * (WEIGHTS[k] / 100);

  const contributions = CANSLIM_KEYS.map((k) => ({
    key: k,
    label: CANSLIM_LABELS[k].label,
    score: scoreByKey[k],
    weight: WEIGHTS[k],
    contribution: scoreByKey[k] * (WEIGHTS[k] / 100),
  }));
  const top = [...contributions].sort((a, b) => b.contribution - a.contribution).slice(0, 3);
  const bottom = [...contributions].sort((a, b) => a.contribution - b.contribution).slice(0, 3);

  let finalScore = Math.round(total);
  if (classification.uncertain) {
    finalScore = Math.min(finalScore, Math.max(0, Math.round(classification.confidence)));
  }

  return {
    score: finalScore,
    level: classification.uncertain ? 'AVOID' : levelOf(total),
    topContributors: top.map(({ contribution: _c, ...rest }) => rest),
    bottomContributors: bottom.map(({ contribution: _c, ...rest }) => rest),
  };
}
