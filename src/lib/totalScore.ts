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

// Per-type weight tables — each sums to 100. Slots match CANSLIM_KEYS only;
// peak-earnings risk for CYCLICAL is NOT a weight slot — it's applied later
// as a post-hoc penalty on `finalScore` (see peakPenalty below). So if you
// see "peak" in the comments, that signal lives outside the weight blend.
const TYPE_WEIGHTS: Record<StockType, CanslimWeights> = {
  // 고성장: 분기/연간 EPS, 매출, 리더십 → 펀더의 핵심. 밸류·재무는 보조.
  FAST_GROWER: { C: 16, A: 14, G: 14, L: 12, Q: 8, T: 8, N: 8, B: 6, V: 4, I: 4, M: 4, S: 2 },
  // 대형우량: 품질·재무·꾸준한 EPS·합리적 밸류 중심.
  STALWART:    { Q: 18, B: 14, A: 12, G: 10, V: 10, I: 8, M: 6, C: 6, T: 6, N: 4, L: 4, S: 2 },
  // 저성장/배당: 밸류·재무·품질에 무게. 성장 지표 비중 축소.
  SLOW_GROWER: { V: 16, B: 14, Q: 14, A: 10, I: 8, M: 8, S: 6, G: 6, T: 6, C: 4, N: 4, L: 4 },
  // 순환: 밸류·시장방향·추세·재무. 이익 피크는 별도 penalty (가중치 슬롯 X).
  CYCLICAL:    { V: 16, T: 16, B: 12, M: 12, A: 8, G: 8, Q: 8, C: 6, L: 6, N: 4, I: 2, S: 2 },
  // 턴어라운드: 분기 회복·재무생존·품질개선이 최우선.
  TURNAROUND:  { C: 14, B: 14, Q: 12, A: 10, V: 10, G: 10, T: 8, L: 6, N: 6, M: 4, I: 4, S: 2 },
  // 자산주: 밸류·재무·기관 중심. 성장 지표는 보조.
  ASSET_PLAY:  { V: 18, B: 16, Q: 10, I: 10, A: 8, G: 6, M: 6, T: 6, C: 6, S: 6, N: 4, L: 4 },
  // 투기/테마: 리더십·신고가·수급·추세에 집중. 펀더멘탈은 최소.
  SPECULATIVE: { L: 16, N: 14, S: 14, T: 12, M: 8, C: 8, I: 6, G: 6, A: 4, Q: 4, V: 4, B: 4 },
};

// Eligibility threshold — candidate types below this score are noise and
// excluded from the blend. (≥20 keeps the "분류 불확실" floor in sync with
// typeWeights.ts's UNCERTAIN_THRESHOLD=30 while still admitting moderate
// secondary/tertiary signals.)
const ELIGIBLE_MIN_SCORE = 20;

// baseBlend tier from top1-top2 gap. Low confidence (혼합형) → larger base
// anchor, so the score barely moves when the type ranking shifts.
function baseBlendForConfidence(gap: number): number {
  if (gap < 10) return 0.30;
  if (gap < 20) return 0.20;
  return 0.10;
}

// Defensive: scale to exactly 100. Both BASE and each TYPE table sum to 100,
// so the blend should naturally sum to ~100; this just absorbs FP drift and
// any future edits that violate the invariant.
function normalizeTo100(w: CanslimWeights): CanslimWeights {
  const sum = CANSLIM_KEYS.reduce((s, k) => s + w[k], 0);
  if (sum <= 0) return { ...BASE_WEIGHTS };
  if (Math.abs(sum - 100) < 1e-6) return w;
  const scale = 100 / sum;
  const out: CanslimWeights = { ...w };
  for (const k of CANSLIM_KEYS) out[k] = w[k] * scale;
  return out;
}

// Build per-call weights: eligible candidate types (score-weighted, summing
// to (1 - baseBlend)) + BASE_WEIGHTS × baseBlend. Returns weights summing to
// exactly 100.
function blendWeights(classification: ClassificationResult): CanslimWeights {
  const live = classification.candidates.filter((c) => !c.disqualified);
  const eligible = live.filter((c) => c.score >= ELIGIBLE_MIN_SCORE);

  const top1Score = eligible[0]?.score ?? 0;
  const top2Score = eligible[1]?.score ?? 0;
  const baseBlend = baseBlendForConfidence(Math.max(0, top1Score - top2Score));
  const typeBlend = 1 - baseBlend;

  const out: CanslimWeights = { C: 0, A: 0, N: 0, S: 0, L: 0, I: 0, M: 0, Q: 0, V: 0, B: 0, G: 0, T: 0 };

  // base anchor (always applied)
  for (const k of CANSLIM_KEYS) out[k] += BASE_WEIGHTS[k] * baseBlend;

  const sumEligible = eligible.reduce((s, c) => s + c.score, 0);
  if (sumEligible > 0) {
    for (const cand of eligible) {
      const share = (cand.score / sumEligible) * typeBlend;
      const table = TYPE_WEIGHTS[cand.type];
      for (const k of CANSLIM_KEYS) out[k] += table[k] * share;
    }
  } else {
    // No eligible types (every score < 20) — fall back to all-base.
    for (const k of CANSLIM_KEYS) out[k] += BASE_WEIGHTS[k] * typeBlend;
  }

  return normalizeTo100(out);
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
