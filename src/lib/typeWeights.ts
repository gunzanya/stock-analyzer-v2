// Blending: combine top-2 candidates when scores are close.
// Top scorer leads with >20pt gap → solo. Otherwise blend top-2 proportionally.
// When even the top type scores below 30, flag as `uncertain` — this means
// the data was too thin to classify confidently (e.g. delisted / renamed ticker).

import { STOCK_TYPE_LABELS } from './types.js';
import type {
  ClassificationResult,
  FundamentalData,
  TypeCandidateScore,
} from './types.js';
import { scoreAllTypes } from './stockType.js';

const BLEND_FLOOR = 40;       // both candidates must reach this for blending
const BLEND_GAP = 20;         // score difference to consider a blend
const SOLO_GAP = 20;          // score difference for "decisively solo"
const UNCERTAIN_THRESHOLD = 30; // best score below this → "분류 불확실"

const UNCERTAIN_LABEL = '❓ 분류 불확실 — 데이터 부족 또는 특수 종목';

function formatLabel(t: TypeCandidateScore['type'], ratio?: number): string {
  const { emoji, ko } = STOCK_TYPE_LABELS[t];
  return ratio != null ? `${emoji} ${ko} ${ratio}%` : `${emoji} ${ko}`;
}

export function classify(fund: FundamentalData): ClassificationResult {
  const candidates = scoreAllTypes(fund);
  // Only blendable among non-disqualified
  const live = candidates.filter((c) => !c.disqualified);
  const first = live[0];
  const second = live[1];
  const topScore = first?.score ?? 0;

  // Uncertain: best non-disqualified score is below threshold
  if (topScore < UNCERTAIN_THRESHOLD) {
    const fallback = first ?? candidates[0];
    return {
      primary: fallback.type,
      primaryRatio: 100,
      secondary: null,
      secondaryRatio: 0,
      confidence: Math.round(topScore),
      candidates,
      display: UNCERTAIN_LABEL,
      uncertain: true,
    };
  }

  const gap = first.score - (second?.score ?? 0);
  const blendable =
    second != null &&
    first.score >= BLEND_FLOOR &&
    second.score >= BLEND_FLOOR &&
    gap <= BLEND_GAP;

  if (first.score >= 70 && gap > SOLO_GAP) {
    return {
      primary: first.type,
      primaryRatio: 100,
      secondary: null,
      secondaryRatio: 0,
      confidence: Math.round(first.score),
      candidates,
      display: formatLabel(first.type),
      uncertain: false,
    };
  }

  if (blendable) {
    const total = first.score + second.score;
    const r1 = Math.round((first.score / total) * 100);
    const r2 = 100 - r1;
    return {
      primary: first.type,
      primaryRatio: r1,
      secondary: second.type,
      secondaryRatio: r2,
      confidence: Math.round(first.score),
      candidates,
      display: `${formatLabel(first.type, r1)} + ${formatLabel(second.type, r2)}`,
      uncertain: false,
    };
  }

  return {
    primary: first.type,
    primaryRatio: 100,
    secondary: null,
    secondaryRatio: 0,
    confidence: Math.round(first.score),
    candidates,
    display: formatLabel(first.type),
    uncertain: false,
  };
}
