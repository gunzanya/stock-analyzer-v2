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

const UNCERTAIN_LABEL = '⚠️ 분류 불확실 — 데이터 부족';

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
    // STALWART rescue: applied ONLY when STALWART is itself the natural top
    // (i.e. no other type beats it). Mega-cap profitable companies whose
    // STALWART score landed in 0-29 (e.g. DIS) get lifted to 30/35 so the
    // user sees "🏛️ 대형우량" instead of "분류 불확실".
    // If another type (FAST_GROWER, ASSET_PLAY, ...) is the natural top
    // below 30, we respect it and leave the result uncertain — that
    // prevents the rescue from overriding cases like CRWD.
    if (first?.type === 'STALWART') {
      const mcap = fund.marketCap;
      const ttmEps = fund.quarterly
        .slice(0, 4)
        .reduce((acc, q) => acc + (q.eps ?? 0), 0);
      const profitable =
        ttmEps > 0 ||
        (fund.annual[0]?.netIncome != null && fund.annual[0].netIncome > 0);
      let rescueScore = 0;
      if (mcap != null && profitable) {
        if (mcap > 200e9) rescueScore = 35;
        else if (mcap > 50e9) rescueScore = 30;
      }
      if (rescueScore > first.score) {
        const before = first.score;
        first.score = rescueScore;
        first.reasons.push(
          `대형 우량 rescue: 시총 $${(mcap! / 1e9).toFixed(0)}B + 흑자, natural top < 30 → ${before}→${rescueScore}`,
        );
        candidates.sort((a, b) => {
          if (a.disqualified && !b.disqualified) return 1;
          if (!a.disqualified && b.disqualified) return -1;
          return b.score - a.score;
        });
        return {
          primary: 'STALWART',
          primaryRatio: 100,
          secondary: null,
          secondaryRatio: 0,
          confidence: rescueScore,
          candidates,
          display: formatLabel('STALWART'),
          uncertain: false,
        };
      }
    }

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
