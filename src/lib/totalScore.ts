// Fundamental score — weighted average of the 12 CANSLIM items.
// Weights are *soft-blended* per ticker: the top-2 candidate types from
// `classification.candidates` are normalized (their score ratio × 0.9) and
// anchored to the universal BASE weights at 10%. This keeps the score smooth
// when the primary type flips between two close candidates (e.g. 65 vs 60 →
// the weights barely move because both still contribute proportionally).

import type {
  CanslimKey,
  CanslimResult,
  ClassificationResult,
  FundamentalData,
  FundamentalScoreResult,
  StockType,
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

type CanslimWeights = Record<CanslimKey, number>;

// Universal base — anchors 10% of the final blend so type flips can't shake
// the score. Same numbers the previous "universal" implementation used.
const BASE_WEIGHTS: CanslimWeights = {
  C: 12, A: 10, G: 10,
  L: 10, V: 10, Q: 10,
  T: 10, B: 8,  N: 6,
  S: 5,  M: 5,  I: 4,
};

// Per-type weight tables — each sums to 100. Used as the top-2 ingredients
// in the blend (alongside BASE_WEIGHTS as the 10% anchor).
const TYPE_WEIGHTS: Record<StockType, CanslimWeights> = {
  // 고성장: 분기/연간 EPS, 매출, 리더십 → 펀더의 핵심. 밸류·재무는 보조.
  FAST_GROWER: { C: 16, A: 14, G: 14, L: 12, Q: 8, T: 8, N: 8, B: 6, V: 4, I: 4, M: 4, S: 2 },
  // 대형우량: 품질·재무·꾸준한 EPS·합리적 밸류 중심.
  STALWART:    { Q: 18, B: 14, A: 12, G: 10, V: 10, I: 8, M: 6, C: 6, T: 6, N: 4, L: 4, S: 2 },
  // 저성장/배당: 밸류·재무·품질에 무게. 성장 지표 비중 축소.
  SLOW_GROWER: { V: 16, B: 14, Q: 14, A: 10, I: 8, M: 8, S: 6, G: 6, T: 6, C: 4, N: 4, L: 4 },
  // 순환: 밸류·시장방향·추세·재무. 성장 지표는 피크 신호일 수도 있어 낮춤.
  CYCLICAL:    { V: 16, T: 16, B: 12, M: 12, A: 8, G: 8, Q: 8, C: 6, L: 6, N: 4, I: 2, S: 2 },
  // 턴어라운드: 분기 회복·재무생존·품질개선이 최우선.
  TURNAROUND:  { C: 14, B: 14, Q: 12, A: 10, V: 10, G: 10, T: 8, L: 6, N: 6, M: 4, I: 4, S: 2 },
  // 자산주: 밸류·재무·기관 중심. 성장 지표는 보조.
  ASSET_PLAY:  { V: 18, B: 16, Q: 10, I: 10, A: 8, G: 6, M: 6, T: 6, C: 6, S: 6, N: 4, L: 4 },
  // 투기/테마: 리더십·신고가·수급·추세에 집중. 펀더멘탈은 최소.
  SPECULATIVE: { L: 16, N: 14, S: 14, T: 12, M: 8, C: 8, I: 6, G: 6, A: 4, Q: 4, V: 4, B: 4 },
};

const BASE_RATIO = 0.10;    // 10% anchor — keeps score smooth across type flips
const BLEND_TOP_N = 2;      // blend top-2 live candidates

// Build per-call weights as: top-N candidate types (score-weighted, summing to
// (1 - BASE_RATIO)) + BASE_WEIGHTS × BASE_RATIO. Returns weights summing to 100.
function blendWeights(classification: ClassificationResult): CanslimWeights {
  const live = classification.candidates.filter((c) => !c.disqualified);
  const top = live.slice(0, BLEND_TOP_N);
  const sumScores = top.reduce((s, c) => s + Math.max(0, c.score), 0);

  const out: CanslimWeights = { C: 0, A: 0, N: 0, S: 0, L: 0, I: 0, M: 0, Q: 0, V: 0, B: 0, G: 0, T: 0 };

  // 10% base anchor (always applied).
  for (const k of CANSLIM_KEYS) out[k] += BASE_WEIGHTS[k] * BASE_RATIO;

  // 90% type blend — when scores are usable, distribute proportionally;
  // otherwise fall back to all-base.
  if (sumScores > 0 && top.length > 0) {
    for (const cand of top) {
      const share = (Math.max(0, cand.score) / sumScores) * (1 - BASE_RATIO);
      const table = TYPE_WEIGHTS[cand.type];
      for (const k of CANSLIM_KEYS) out[k] += table[k] * share;
    }
  } else {
    for (const k of CANSLIM_KEYS) out[k] += BASE_WEIGHTS[k] * (1 - BASE_RATIO);
  }

  return out;
}

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

  const weights = blendWeights(classification);

  let total = 0;
  for (const k of CANSLIM_KEYS) total += scoreByKey[k] * (weights[k] / 100);

  const contributions = CANSLIM_KEYS.map((k) => ({
    key: k,
    label: CANSLIM_LABELS[k].label,
    score: scoreByKey[k],
    weight: Math.round(weights[k] * 10) / 10, // one decimal for UI clarity
    contribution: scoreByKey[k] * (weights[k] / 100),
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
