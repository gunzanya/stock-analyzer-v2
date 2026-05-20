// Entry score: combines technical signals with the v2 deduction list.
// Capped at 90 (never 100 — per stage 5 spec).
//
// Gains and deductions are recorded with reasons for the UI.

import type { EntryScoreResult, PriceBar, StockType } from './types.js';
import {
  adx as adxOf,
  bollingerBands,
  bollingerBreakout,
  ema,
  fibProximity,
  fibonacciLevels,
  macd,
  macdCross,
  macdHistTrend,
  obvBearishDivergence,
  relativeStrength,
  return30d,
  rsi as rsiOf,
  volumeRatio,
} from './indicators.js';

const MAX_SCORE = 90;
const MAX_TOTAL_DEDUCTION = -30; // cap on the sum of deductions

export interface EntryScoreInputs {
  stockBars: PriceBar[];
  benchmarkBars: PriceBar[];
  absoluteMode?: boolean;
  /** Classifier primary; gates the RSI<30 branch (oversold means different
   *  things for cyclicals vs. fast growers). Optional — falls back to
   *  generic treatment when absent. */
  primaryType?: StockType | null;
}

export function computeEntryScore(inputs: EntryScoreInputs): EntryScoreResult {
  const { stockBars, benchmarkBars, absoluteMode, primaryType } = inputs;
  const gains: { reason: string; delta: number }[] = [];
  const deductions: { reason: string; delta: number }[] = [];

  const vr = volumeRatio(stockBars);
  const adxVal = adxOf(stockBars);
  const obvDiv = obvBearishDivergence(stockBars);
  const r30 = return30d(stockBars);
  const { rs, excess } = relativeStrength(stockBars, benchmarkBars, { absoluteMode });

  // ---------- Gains (base technical strength) ----------
  if (adxVal != null && adxVal >= 25) {
    const delta = adxVal >= 35 ? 20 : 15;
    gains.push({ reason: `ADX ${adxVal.toFixed(0)} → +${delta} (강한 추세)`, delta });
  }
  if (vr != null && vr >= 1.5) {
    gains.push({ reason: `거래량 ${vr.toFixed(2)}x → +10 (관심↑)`, delta: 10 });
  } else if (vr != null && vr >= 1.0 && vr < 1.5) {
    gains.push({ reason: `거래량 ${vr.toFixed(2)}x → +5 (평균↑)`, delta: 5 });
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

  // ---------- RSI(14) — overheating + type-aware oversold reading ----------
  const rsiVal = rsiOf(stockBars, 14);
  if (rsiVal != null) {
    if (rsiVal > 70) {
      deductions.push({
        reason: `RSI ${rsiVal.toFixed(0)} > 70 → -10 (과매수)`,
        delta: -10,
      });
    } else if (rsiVal >= 65) {
      gains.push({ reason: `RSI ${rsiVal.toFixed(0)} (65-70 중립)`, delta: 0 });
    } else if (rsiVal >= 50) {
      gains.push({
        reason: `RSI ${rsiVal.toFixed(0)} (50-65 골디락스) → +5`,
        delta: 5,
      });
    } else if (rsiVal >= 30) {
      gains.push({ reason: `RSI ${rsiVal.toFixed(0)} (30-50 중립)`, delta: 0 });
    } else {
      // RSI < 30 — meaning depends on the kind of stock
      if (primaryType === 'FAST_GROWER' || primaryType === 'STALWART') {
        deductions.push({
          reason: `RSI ${rsiVal.toFixed(0)} < 30 → -5 (성장/우량주 하락추세)`,
          delta: -5,
        });
      } else if (primaryType === 'TURNAROUND') {
        gains.push({
          reason: `RSI ${rsiVal.toFixed(0)} < 30 (턴어라운드 — 낙폭과대 반등 가능)`,
          delta: 0,
        });
      } else if (primaryType === 'CYCLICAL') {
        gains.push({
          reason: `RSI ${rsiVal.toFixed(0)} < 30 → +5 (순환주 바닥 매수)`,
          delta: 5,
        });
      } else {
        deductions.push({
          reason: `RSI ${rsiVal.toFixed(0)} < 30 → -3 (과매도)`,
          delta: -3,
        });
      }
    }
  }

  // ---------- EMA20 proximity — pullback support vs. over-extension ----------
  const ema20 = ema(stockBars, 20);
  const px = stockBars[0]?.close ?? null;
  if (ema20 != null && px != null && ema20 > 0) {
    const dist = (px - ema20) / ema20;
    const pct = dist * 100;
    const sign = pct >= 0 ? '+' : '';
    if (Math.abs(dist) <= 0.02) {
      gains.push({
        reason: `EMA20 ${sign}${pct.toFixed(1)}% (±2% 풀백 지지) → +10`,
        delta: 10,
      });
    } else if (dist > 0.10) {
      deductions.push({
        reason: `EMA20 +${pct.toFixed(1)}% (>10% 과이격) → -5`,
        delta: -5,
      });
    } else if (dist > 0.05) {
      gains.push({
        reason: `EMA20 +${pct.toFixed(1)}% (5-10% 상승 중) → +5`,
        delta: 5,
      });
    } else if (dist > 0.02) {
      gains.push({ reason: `EMA20 +${pct.toFixed(1)}%`, delta: 0 });
    } else {
      gains.push({ reason: `EMA20 ${pct.toFixed(1)}% (아래)`, delta: 0 });
    }
  }

  // ---------- 5-day candle pattern — overheating / pullback recovery ----------
  if (stockBars.length >= 5) {
    const recent5 = stockBars.slice(0, 5);
    const colors = recent5.map((b): 'g' | 'r' | '·' => {
      if (b.open == null) return '·';
      if (b.close > b.open) return 'g';
      if (b.close < b.open) return 'r';
      return '·';
    });
    const greens = colors.filter((c) => c === 'g').length;
    const reds = colors.filter((c) => c === 'r').length;
    const todayGreen = colors[0] === 'g';
    // Prior 2 (or more) sessions red then today's green = healthy pullback
    const priorPullback =
      todayGreen && colors[1] === 'r' && colors[2] === 'r';
    if (greens >= 4) {
      deductions.push({
        reason: `5일 ${greens}양봉 → -5 (단기 과열)`,
        delta: -5,
      });
    } else if (reds >= 4) {
      deductions.push({
        reason: `5일 ${reds}음봉 → -5 (하락 추세)`,
        delta: -5,
      });
    } else if (priorPullback) {
      gains.push({
        reason: `5일: ${colors.join('')} (조정 후 양봉) → +5`,
        delta: 5,
      });
    } else {
      gains.push({
        reason: `5일: ${colors.join('')} (${greens}양/${reds}음)`,
        delta: 0,
      });
    }
  }

  // ---------- Fibonacci retracement support / break ----------
  const fib = fibonacciLevels(stockBars);
  if (fib) {
    const prox = fibProximity(stockBars, fib);
    if (prox.kind === 'near') {
      gains.push({
        reason: `피보나치 ${prox.level}% 지지 근접 (±${prox.distancePct.toFixed(1)}%) → +5`,
        delta: 5,
      });
    } else if (prox.kind === 'broke_618') {
      deductions.push({
        reason: `피보나치 61.8% 핵심 지지 이탈 → -5`,
        delta: -5,
      });
    }
  }

  // ---------- MACD(12,26,9) — cross + histogram momentum ----------
  const macdSeries = macd(stockBars);
  if (macdSeries) {
    const cross = macdCross(macdSeries);
    if (cross === 'golden') {
      gains.push({ reason: 'MACD 골든크로스 → +5', delta: 5 });
    } else if (cross === 'dead') {
      deductions.push({ reason: 'MACD 데드크로스 → -5', delta: -5 });
    }
    const trend = macdHistTrend(macdSeries);
    if (trend === '3up') {
      gains.push({ reason: 'MACD 히스토그램 3일 증가 → +3 (모멘텀 강화)', delta: 3 });
    } else if (trend === '3down') {
      deductions.push({ reason: 'MACD 히스토그램 3일 감소 → -3 (모멘텀 약화)', delta: -3 });
    }
  }

  // ---------- Bollinger upper-band breakout with volume confirmation ----------
  const bb = bollingerBands(stockBars);
  if (bb) {
    const breakout = bollingerBreakout(stockBars, bb);
    if (breakout === 'upper' && vr != null && vr >= 1.5) {
      gains.push({
        reason: `볼린저 상단 돌파 + 거래량 ${vr.toFixed(2)}x → +3 (강한 돌파)`,
        delta: 3,
      });
    }
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
    if (adxVal < 15) {
      deductions.push({ reason: `ADX ${adxVal.toFixed(0)} < 15 → -15 (추세 없음)`, delta: -15 });
    } else if (adxVal < 20) {
      deductions.push({ reason: `ADX ${adxVal.toFixed(0)} < 20 → -10 (추세 미약)`, delta: -10 });
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

/** Post-processing coherence floor: a fundamentally OK stock shouldn't
 *  show an extreme Entry of 0–10. Tiered floors prevent the case where
 *  MSFT (Total 62, Entry 0) or PEP (Total 47, Entry 17) collapse to near-zero
 *  just because the setup is poor.
 *    Total ≥ 75 → Entry ≥ 25 (level NEUTRAL — company is solid)
 *    Total ≥ 60 → Entry ≥ 20 (level stays AVOID — fundamentals OK, setup bad)
 *    Total ≥ 50 → Entry ≥ 15 (level stays AVOID) */
export function applyCoherenceFloor(
  entry: EntryScoreResult,
  totalScoreValue: number,
): EntryScoreResult {
  let floor = 0;
  let flooredLevel: EntryScoreResult['level'] | null = null;
  if (totalScoreValue >= 75) {
    floor = 25;
    flooredLevel = 'NEUTRAL';
  } else if (totalScoreValue >= 60) {
    floor = 20;
    flooredLevel = 'AVOID';
  } else if (totalScoreValue >= 50) {
    floor = 15;
    flooredLevel = 'AVOID';
  }

  if (floor > 0 && entry.score < floor) {
    const before = entry.score;
    return {
      ...entry,
      score: floor,
      gains: [
        ...entry.gains,
        {
          reason: `TotalScore ${totalScoreValue} 보정 → Entry ${before} → ${floor} (펀더 양호, 자리만 나쁨)`,
          delta: floor - before,
        },
      ],
      level: flooredLevel!,
    };
  }
  return entry;
}
