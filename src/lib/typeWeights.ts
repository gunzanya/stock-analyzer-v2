// Blending: combine top-2 candidates when scores are close.
// Top scorer leads with >20pt gap → solo. Otherwise blend top-2 proportionally.
// When even the top type scores below 30, flag as `uncertain` — this means
// the data was too thin to classify confidently (e.g. delisted / renamed ticker).

import { STOCK_TYPE_LABELS } from './types.js';
import type {
  ClassificationResult,
  FundamentalData,
  StockType,
  TypeCandidateScore,
} from './types.js';
import { scoreAllTypes } from './stockType.js';

const BLEND_FLOOR = 40;       // both candidates must reach this for blending
const BLEND_GAP = 20;         // score difference to consider a blend
const SOLO_GAP = 20;          // score difference for "decisively solo"
const UNCERTAIN_THRESHOLD = 30; // best score below this → "분류 불확실"

const UNCERTAIN_LABEL = '⚠️ 분류 불확실 — 데이터 부족';

// Sector → preferred type. Used for (a) tiebreak when top-2 are exactly tied,
// and (b) low-score boost when all candidates are below the uncertain threshold.
const SECTOR_PREFERRED_TYPE: Record<string, StockType> = {
  Energy: 'CYCLICAL',
  'Basic Materials': 'CYCLICAL',
  Technology: 'FAST_GROWER',
  'Financial Services': 'STALWART',
  'Consumer Defensive': 'SLOW_GROWER',
  Utilities: 'SLOW_GROWER',
  'Consumer Cyclical': 'CYCLICAL',
  Healthcare: 'FAST_GROWER',
};

function formatLabel(t: TypeCandidateScore['type'], ratio?: number): string {
  const { emoji, ko } = STOCK_TYPE_LABELS[t];
  return ratio != null ? `${emoji} ${ko} ${ratio}%` : `${emoji} ${ko}`;
}

function resort(cands: TypeCandidateScore[], preferredOnTie: StockType | null) {
  cands.sort((a, b) => {
    if (a.disqualified && !b.disqualified) return 1;
    if (!a.disqualified && b.disqualified) return -1;
    if (a.score !== b.score) return b.score - a.score;
    if (preferredOnTie) {
      if (a.type === preferredOnTie) return -1;
      if (b.type === preferredOnTie) return 1;
    }
    return 0;
  });
}

export function classify(fund: FundamentalData): ClassificationResult {
  const candidates = scoreAllTypes(fund);
  const sectorPreferred =
    fund.sector && SECTOR_PREFERRED_TYPE[fund.sector]
      ? SECTOR_PREFERRED_TYPE[fund.sector]
      : null;

  // (Step 1) Sector tiebreak: if top-2 are exactly tied, prefer the
  // sector-aligned type. Applies at any score level.
  if (sectorPreferred) {
    const live = candidates.filter((c) => !c.disqualified);
    if (
      live.length >= 2 &&
      live[0].score === live[1].score &&
      live[0].type !== sectorPreferred
    ) {
      const prefCand = live.find((c) => c.type === sectorPreferred);
      if (prefCand && prefCand.score === live[0].score) {
        prefCand.reasons.push(`섹터 ${fund.sector} 타이브레이크 → 1위`);
        resort(candidates, sectorPreferred);
      }
    }
  }

  // (Step 2) Low-score boost: when the top live score is below the uncertain
  // threshold, give the sector-preferred type +10 to help escape "uncertain".
  let live = candidates.filter((c) => !c.disqualified);
  let first = live[0];
  if (
    first &&
    first.score < UNCERTAIN_THRESHOLD &&
    sectorPreferred &&
    fund.sector
  ) {
    const prefCand = candidates.find(
      (c) => c.type === sectorPreferred && !c.disqualified,
    );
    if (prefCand) {
      const before = prefCand.score;
      prefCand.score = before + 10;
      prefCand.reasons.push(
        `섹터 ${fund.sector} 저점수 보정 → +10 (${before}→${prefCand.score})`,
      );
      resort(candidates, sectorPreferred);
      live = candidates.filter((c) => !c.disqualified);
      first = live[0];
    }
  }

  // (Step 3) Big-cap rescue: when top score is still below threshold, bump
  // mega-/large-cap profitable companies up to a sensible floor so the UI
  // can present a real type instead of "분류 불확실".
  //   mcap ≥ $30B + 흑자  → floor 30
  //   mcap ≥ $100B + 흑자 → floor 35
  if (first && first.score < UNCERTAIN_THRESHOLD) {
    const mcap = fund.marketCap;
    const ttmEps = fund.quarterly
      .slice(0, 4)
      .reduce((acc, q) => acc + (q.eps ?? 0), 0);
    const profitable =
      ttmEps > 0 ||
      (fund.annual[0]?.netIncome != null && fund.annual[0].netIncome > 0);
    if (mcap != null && mcap >= 30e9 && profitable) {
      const rescueScore = mcap >= 100e9 ? 35 : 30;
      if (rescueScore > first.score) {
        const before = first.score;
        first.score = rescueScore;
        first.reasons.push(
          `대형주 rescue: 시총 $${(mcap / 1e9).toFixed(0)}B + 흑자 → ${before}→${rescueScore}`,
        );
        resort(candidates, sectorPreferred);
        live = candidates.filter((c) => !c.disqualified);
        first = live[0];
      }
    }
  }

  const topScore = first?.score ?? 0;

  // Uncertain: even after all rescues, top live score is below threshold.
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

  const second = live[1];
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
