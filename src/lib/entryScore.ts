// Entry score: combines technical signals with the v2 deduction list.
// Capped at 90 (never 100 — per stage 5 spec).
//
// Gains and deductions are recorded with reasons for the UI.

import type { EntryScoreResult, PriceBar } from './types.js';
import {
  adx as adxOf,
  obvBearishDivergence,
  relativeStrength,
  return30d,
  volumeRatio,
} from './indicators.js';

const MAX_SCORE = 90;
const MAX_TOTAL_DEDUCTION = -30; // cap on the sum of deductions

export interface EntryScoreInputs {
  stockBars: PriceBar[];
  benchmarkBars: PriceBar[];
}

export function computeEntryScore(inputs: EntryScoreInputs): EntryScoreResult {
  const { stockBars, benchmarkBars } = inputs;
  const gains: { reason: string; delta: number }[] = [];
  const deductions: { reason: string; delta: number }[] = [];

  const vr = volumeRatio(stockBars);
  const adxVal = adxOf(stockBars);
  const obvDiv = obvBearishDivergence(stockBars);
  const r30 = return30d(stockBars);
  const { rs, excess } = relativeStrength(stockBars, benchmarkBars);

  // ---------- Gains (base technical strength) ----------
  if (adxVal != null && adxVal >= 25) {
    const delta = adxVal >= 35 ? 20 : 15;
    gains.push({ reason: `ADX ${adxVal.toFixed(0)} → +${delta} (강한 추세)`, delta });
  }
  if (vr != null && vr >= 1.5) {
    gains.push({ reason: `거래량 ${vr.toFixed(2)}x → +15 (관심↑)`, delta: 15 });
  } else if (vr != null && vr >= 1.0 && vr < 1.5) {
    gains.push({ reason: `거래량 ${vr.toFixed(2)}x → +10 (평균↑)`, delta: 10 });
  }
  if (rs >= 70) {
    gains.push({ reason: `RS ${rs.toFixed(0)} (>=70) → +20`, delta: 20 });
  } else if (rs >= 50) {
    gains.push({ reason: `RS ${rs.toFixed(0)} (>=50) → +15`, delta: 15 });
  }
  // 52-week high proximity
  if (stockBars.length >= 252) {
    const high1y = Math.max(...stockBars.slice(0, 252).map((b) => b.high ?? b.close));
    const distance = high1y > 0 ? stockBars[0].close / high1y : 0;
    if (distance >= 0.95) {
      gains.push({ reason: `1년 고점 근접 (${(distance * 100).toFixed(0)}%) → +15`, delta: 15 });
    } else if (distance >= 0.85) {
      gains.push({ reason: `1년 고점 85%+ → +10`, delta: 10 });
    }
  }
  // Above 50-day SMA
  if (stockBars.length >= 50) {
    const sma50 =
      stockBars.slice(0, 50).reduce((acc, b) => acc + b.close, 0) / 50;
    if (stockBars[0].close > sma50) {
      gains.push({ reason: `종가 > 50일선 → +10`, delta: 10 });
    }
  }
  // Above 200-day SMA — long-term uptrend
  if (stockBars.length >= 200) {
    const sma200 =
      stockBars.slice(0, 200).reduce((acc, b) => acc + b.close, 0) / 200;
    if (stockBars[0].close > sma200) {
      gains.push({ reason: `종가 > 200일선 → +5 (장기 상승추세)`, delta: 5 });
    }
  }
  // Absolute 3-month uptrend (independent of sector RS)
  const { stockReturn3M } = relativeStrength(stockBars, benchmarkBars);
  if (stockReturn3M != null && stockReturn3M > 0.05) {
    gains.push({
      reason: `3개월 +${(stockReturn3M * 100).toFixed(0)}% → +5 (절대 모멘텀)`,
      delta: 5,
    });
  }

  // ---------- Deductions (per stage 5 spec, slightly softened) ----------
  if (vr != null) {
    if (vr < 0.7) {
      deductions.push({ reason: `거래량 ${vr.toFixed(2)}x < 0.7 → -15 (위축 심각)`, delta: -15 });
    } else if (vr < 1.0) {
      deductions.push({ reason: `거래량 ${vr.toFixed(2)}x < 1.0 → -3 (평균 이하)`, delta: -3 });
    }
  }
  if (adxVal != null) {
    if (adxVal < 20) {
      deductions.push({ reason: `ADX ${adxVal.toFixed(0)} < 20 → -15 (추세 없음)`, delta: -15 });
    } else if (adxVal < 25) {
      deductions.push({ reason: `ADX ${adxVal.toFixed(0)} < 25 → -5 (추세 약함)`, delta: -5 });
    }
  }
  if (obvDiv === true) {
    deductions.push({ reason: `OBV 다이버전스 (가격↑ OBV↓) → -15`, delta: -15 });
  }
  if (r30 != null && r30 > 0.20) {
    deductions.push({ reason: `30일 +${(r30 * 100).toFixed(0)}% 급등 → -10 (눌림 위험)`, delta: -10 });
  }
  // Sector-lag deduction tightened — only fire on clear underperformance
  if (excess != null && excess < -0.15) {
    deductions.push({ reason: `섹터 대비 ${(excess * 100).toFixed(0)}%p 부진 → -5`, delta: -5 });
  }

  // Cap total deductions at -30 — multiple severe signals shouldn't compound
  // to drive a fundamentally-OK stock to 0.
  const rawDeductionSum = deductions.reduce((a, d) => a + d.delta, 0);
  if (rawDeductionSum < MAX_TOTAL_DEDUCTION) {
    const offset = MAX_TOTAL_DEDUCTION - rawDeductionSum; // positive value
    deductions.push({
      reason: `감점 총합 cap (-30 한계, 원래 ${rawDeductionSum})`,
      delta: offset,
    });
  }

  const gainSum = gains.reduce((a, g) => a + g.delta, 0);
  const deductionSum = deductions.reduce((a, d) => a + d.delta, 0);
  const score = Math.max(0, Math.min(MAX_SCORE, gainSum + deductionSum));

  let level: EntryScoreResult['level'];
  if (score >= 70) level = 'STRONG';
  else if (score >= 50) level = 'WATCH';
  else if (score >= 30) level = 'NEUTRAL';
  else level = 'AVOID';

  return { score, gains, deductions, level };
}

/** Post-processing coherence floor: a fundamentally strong stock
 *  (TotalScore ≥ 75) shouldn't show an Entry of 0–20. Floor at 25 so the
 *  user sees "setup poor but the company is solid". (Threshold 75 rather
 *  than the originally-specified 80 because borderline cases like LLY
 *  score 79 — close enough to count.) */
export function applyCoherenceFloor(
  entry: EntryScoreResult,
  totalScoreValue: number,
): EntryScoreResult {
  if (totalScoreValue >= 75 && entry.score < 20) {
    const before = entry.score;
    return {
      ...entry,
      score: 25,
      gains: [
        ...entry.gains,
        {
          reason: `TotalScore ${totalScoreValue} 보정 → Entry ${before} → 25 (펀더 양호, 자리만 나쁨)`,
          delta: 25 - before,
        },
      ],
      level: 'NEUTRAL',
    };
  }
  return entry;
}
