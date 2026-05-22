// Fundamental score — weighted average of the 12 CANSLIM items.
// Universal weights — stock type no longer affects scoring.
// Type classification is used only for insight cards and sell signals.
// (Renamed from TotalScore; UI label is "펀더멘탈".)

import type {
  CanslimKey,
  CanslimResult,
  ClassificationResult,
  FundamentalData,
  FundamentalScoreResult,
} from './types.js';
import { CANSLIM_KEYS, CANSLIM_LABELS } from './canslim.js';

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function isCyclicalPeakSector(fund: FundamentalData): boolean {
  const ind = fund.industry ?? '';
  if (/capital markets/i.test(ind)) return true;
  if (fund.sector === 'Energy' && /oil|gas|petroleum/i.test(ind)) return true;
  if (fund.sector === 'Basic Materials' && /mining|steel|aluminum|gold|silver|copper|metals/i.test(ind)) return true;
  if (/auto manufacturers/i.test(ind)) return true;
  if (/consumer electronics/i.test(ind)) return true;
  if (/semiconductor|memory/i.test(ind)) return true;
  return false;
}

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
  fund?: FundamentalData | null,
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

  // Peak earnings penalty for cyclical sectors
  let peakPenalty: { delta: number; reason: string } | null = null;
  if (fund && isCyclicalPeakSector(fund)) {
    const eps = fund.epsGrowthYoY;
    if (isNum(eps) && eps > 0.5) {
      const mitigated =
        isNum(fund.per) && isNum(fund.forwardPER) &&
        fund.per > 0 && fund.forwardPER > 0 &&
        fund.per > fund.forwardPER;

      let delta: number;
      if (eps > 2.0) delta = mitigated ? -10 : -20;
      else if (eps > 1.0) delta = mitigated ? -8 : -15;
      else delta = mitigated ? -5 : -10;

      peakPenalty = { delta, reason: `순환 이익 피크 ${delta}` };
      finalScore = Math.max(0, finalScore + delta);
    }
  }

  return {
    score: finalScore,
    level: classification.uncertain ? 'AVOID' : levelOf(finalScore),
    topContributors: top.map(({ contribution: _c, ...rest }) => rest),
    bottomContributors: bottom.map(({ contribution: _c, ...rest }) => rest),
    peakEarningsPenalty: peakPenalty,
  };
}
