// TotalScore — weighted average of the 12 CANSLIM items, with weights
// chosen per primary classification type. If the classification is blended,
// we blend the two weight vectors proportionally.

import type {
  CanslimKey,
  CanslimResult,
  ClassificationResult,
  StockType,
  TotalScoreResult,
} from './types.js';
import { CANSLIM_KEYS, CANSLIM_LABELS } from './canslim.js';

// Each row must sum to 100.
const WEIGHTS: Record<StockType, Record<CanslimKey, number>> = {
  FAST_GROWER: { C: 15, A: 15, N: 12, S: 8, L: 10, I: 2, M: 1, Q: 8, V: 4, B: 3, G: 15, T: 7 },
  STALWART:    { C: 10, A: 12, N: 4,  S: 2, L: 6,  I: 5, M: 1, Q: 15, V: 15, B: 15, G: 8,  T: 7 },
  SLOW_GROWER: { C: 4,  A: 10, N: 2,  S: 1, L: 6,  I: 12, M: 5, Q: 12, V: 18, B: 15, G: 7,  T: 8 },
  CYCLICAL:    { C: 8,  A: 7,  N: 2,  S: 8, L: 10, I: 1, M: 12, Q: 5,  V: 18, B: 10, G: 4,  T: 15 },
  TURNAROUND:  { C: 18, A: 10, N: 4,  S: 3, L: 7,  I: 2, M: 6, Q: 12, V: 10, B: 15, G: 5,  T: 8 },
  ASSET_PLAY:  { C: 4,  A: 8,  N: 2,  S: 5, L: 6,  I: 10, M: 5, Q: 12, V: 20, B: 18, G: 4,  T: 6 },
  SPECULATIVE: { C: 8,  A: 2,  N: 15, S: 20, L: 12, I: 2, M: 10, Q: 3,  V: 4,  B: 1,  G: 5,  T: 18 },
};

function levelOf(score: number): TotalScoreResult['level'] {
  if (score >= 70) return 'STRONG';
  if (score >= 50) return 'WATCH';
  if (score >= 30) return 'NEUTRAL';
  return 'AVOID';
}

export function computeTotalScore(
  canslim: CanslimResult,
  classification: ClassificationResult,
): TotalScoreResult {
  const scoreByKey: Record<CanslimKey, number> = {} as Record<CanslimKey, number>;
  for (const item of canslim.items) scoreByKey[item.key] = item.score;

  const w1 = WEIGHTS[classification.primary];
  const w2 = classification.secondary ? WEIGHTS[classification.secondary] : null;
  const r1 = classification.primaryRatio / 100;
  const r2 = (100 - classification.primaryRatio) / 100;

  // Combined weight vector
  const wCombined: Record<CanslimKey, number> = {} as Record<CanslimKey, number>;
  for (const k of CANSLIM_KEYS) {
    wCombined[k] = w1[k] * r1 + (w2 ? w2[k] * r2 : w1[k] * 0);
  }
  // Normalize (should already sum to 100, but be safe)
  const wSum = Object.values(wCombined).reduce((a, b) => a + b, 0);
  for (const k of CANSLIM_KEYS) wCombined[k] = (wCombined[k] / wSum) * 100;

  // Weighted average
  let total = 0;
  for (const k of CANSLIM_KEYS) total += scoreByKey[k] * (wCombined[k] / 100);

  // Contributors = score × weight (in points contributed to total)
  const contributions = CANSLIM_KEYS.map((k) => ({
    key: k,
    label: CANSLIM_LABELS[k].label,
    score: scoreByKey[k],
    weight: Math.round(wCombined[k] * 10) / 10,
    contribution: scoreByKey[k] * (wCombined[k] / 100),
  }));
  const sortedAsc = [...contributions].sort((a, b) => a.contribution - b.contribution);
  const top = [...contributions].sort((a, b) => b.contribution - a.contribution).slice(0, 3);
  const bottom = sortedAsc.slice(0, 3);

  return {
    score: Math.round(total),
    level: levelOf(total),
    topContributors: top.map(({ contribution: _c, ...rest }) => rest),
    bottomContributors: bottom.map(({ contribution: _c, ...rest }) => rest),
  };
}

export { WEIGHTS as TYPE_WEIGHTS };
