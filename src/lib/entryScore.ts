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
    const delta = adxVal >= 35 ? 15 : 10;
    gains.push({ reason: `ADX ${adxVal.toFixed(0)} → +${delta} (강한 추세)`, delta });
  }
  if (vr != null && vr >= 1.5) {
    gains.push({ reason: `거래량 ${vr.toFixed(2)}x → +10 (관심↑)`, delta: 10 });
  } else if (vr != null && vr >= 1.0 && vr < 1.5) {
    gains.push({ reason: `거래량 ${vr.toFixed(2)}x → +5 (평균↑)`, delta: 5 });
  }
  if (rs >= 70) {
    gains.push({ reason: `RS ${rs.toFixed(0)} (>=70) → +15`, delta: 15 });
  } else if (rs >= 50) {
    gains.push({ reason: `RS ${rs.toFixed(0)} (>=50) → +10`, delta: 10 });
  }
  // 52-week high proximity (use 252-day high)
  if (stockBars.length >= 252) {
    const high1y = Math.max(...stockBars.slice(0, 252).map((b) => b.high ?? b.close));
    const distance = high1y > 0 ? stockBars[0].close / high1y : 0;
    if (distance >= 0.95) {
      gains.push({ reason: `1년 고점 근접 (${(distance * 100).toFixed(0)}%) → +10`, delta: 10 });
    } else if (distance >= 0.85) {
      gains.push({ reason: `1년 고점 85%+ → +5`, delta: 5 });
    }
  }
  // Above 50-day SMA
  if (stockBars.length >= 50) {
    const sma50 =
      stockBars.slice(0, 50).reduce((acc, b) => acc + b.close, 0) / 50;
    if (stockBars[0].close > sma50) {
      gains.push({ reason: `종가 > 50일선 → +5`, delta: 5 });
    }
  }

  // ---------- Deductions (per stage 5 spec) ----------
  if (vr != null) {
    if (vr < 0.7) {
      deductions.push({ reason: `거래량 ${vr.toFixed(2)}x < 0.7 → -15 (위축 심각)`, delta: -15 });
    } else if (vr < 1.0) {
      deductions.push({ reason: `거래량 ${vr.toFixed(2)}x < 1.0 → -5 (평균 이하)`, delta: -5 });
    }
  }
  if (adxVal != null) {
    if (adxVal < 20) {
      deductions.push({ reason: `ADX ${adxVal.toFixed(0)} < 20 → -15 (추세 없음)`, delta: -15 });
    } else if (adxVal < 25) {
      deductions.push({ reason: `ADX ${adxVal.toFixed(0)} < 25 → -10 (추세 약함)`, delta: -10 });
    }
  }
  if (obvDiv === true) {
    deductions.push({ reason: `OBV 다이버전스 (가격↑ OBV↓) → -15`, delta: -15 });
  }
  if (r30 != null && r30 > 0.20) {
    deductions.push({ reason: `30일 +${(r30 * 100).toFixed(0)}% 급등 → -10 (눌림 위험)`, delta: -10 });
  }
  if (excess != null && excess < -0.10) {
    deductions.push({ reason: `섹터 대비 ${(excess * 100).toFixed(0)}%p 부진 → -5`, delta: -5 });
  }

  const raw =
    gains.reduce((a, g) => a + g.delta, 0) +
    deductions.reduce((a, d) => a + d.delta, 0);
  const score = Math.max(0, Math.min(MAX_SCORE, raw));

  let level: EntryScoreResult['level'];
  if (score >= 70) level = 'STRONG';
  else if (score >= 50) level = 'WATCH';
  else if (score >= 30) level = 'NEUTRAL';
  else level = 'AVOID';

  return { score, gains, deductions, level };
}
