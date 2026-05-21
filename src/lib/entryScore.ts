// Entry score: combines technical signals with the v2 deduction list.
// Capped at 90 (never 100 — per stage 5 spec).
//
// Gains and deductions are recorded with reasons for the UI.

import type { TimingScoreResult, PriceBar, StockType } from './types.js';
import {
  adx as adxOf,
  atrTrend as atrTrendOf,
  bollingerBands,
  bollingerBreakout,
  ema,
  ema20Slope as ema20SlopeOf,
  fibProximity,
  fibonacciLevels,
  macd,
  macdCross,
  macdHistTrend,
  obvBearishDivergence,
  relativeStrength,
  return30d,
  rsi as rsiOf,
  rsiDivergence as rsiDivergenceOf,
  sma,
  supportResistanceClusters,
  volumePattern as volumePatternOf,
  volumeRatio,
} from './indicators.js';

const MAX_SCORE = 90;
const MAX_TOTAL_DEDUCTION = -30; // cap on the sum of deductions

export interface TimingScoreInputs {
  stockBars: PriceBar[];
  benchmarkBars: PriceBar[];
  absoluteMode?: boolean;
  /** Classifier primary; gates the RSI<30 branch (oversold means different
   *  things for cyclicals vs. fast growers). Optional — falls back to
   *  generic treatment when absent. */
  primaryType?: StockType | null;
}

export function computeTiming(inputs: TimingScoreInputs): TimingScoreResult {
  const { stockBars, benchmarkBars, absoluteMode, primaryType } = inputs;
  const gains: { reason: string; delta: number }[] = [];
  const deductions: { reason: string; delta: number }[] = [];

  const vr = volumeRatio(stockBars);
  const adxVal = adxOf(stockBars);
  const obvDiv = obvBearishDivergence(stockBars);
  const r30 = return30d(stockBars);
  const { rs, excess } = relativeStrength(stockBars, benchmarkBars, { absoluteMode });

  // 52-week high proximity — used for surge softening and convergence breakout
  let near52wHigh = false;
  if (stockBars.length >= 252) {
    const high1y = Math.max(...stockBars.slice(0, 252).map((b) => b.high ?? b.close));
    near52wHigh = high1y > 0 && stockBars[0].close / high1y >= 0.90;
  }

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
      if (near52wHigh) {
        gains.push({ reason: `EMA20 +${pct.toFixed(1)}% (과이격이나 52주 고점 90%+ → 면제)`, delta: 0 });
      } else {
        deductions.push({
          reason: `EMA20 +${pct.toFixed(1)}% (>10% 과이격) → -5`,
          delta: -5,
        });
      }
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

  // ---------- MA Convergence + Volume Breakout ----------
  const ema20v = ema(stockBars, 20);
  const sma50v = sma(stockBars, 50);
  const sma200v = stockBars.length >= 200 ? sma(stockBars, 200) : null;
  if (ema20v != null && sma50v != null && sma200v != null) {
    const maVals = [ema20v, sma50v, sma200v];
    const maMax = Math.max(...maVals);
    const maMin = Math.min(...maVals);
    const spread = maMax > 0 ? (maMax - maMin) / maMax : 1;
    const close = stockBars[0].close;
    const allAbove = close > ema20v && close > sma50v && close > sma200v;

    if (spread <= 0.10) {
      if (allAbove && vr != null && vr >= 1.5) {
        gains.push({
          reason: `이평선 수렴 돌파 (EMA20/SMA50/SMA200 ${(spread * 100).toFixed(1)}% 밴드 + 거래량 ${vr.toFixed(2)}x + 종가 위) → +10`,
          delta: 10,
        });
      } else {
        gains.push({
          reason: `이평선 수렴 중 (${(spread * 100).toFixed(1)}% 밴드) — 큰 움직임 대기`,
          delta: 0,
        });
      }
    }
  }

  // ---------- RSI Divergence ----------
  const rsiDiv = rsiDivergenceOf(stockBars);
  if (rsiDiv === 'bearish') {
    deductions.push({ reason: 'RSI 약세 다이버전스 (주가↑ RSI↓) → -7', delta: -7 });
  } else if (rsiDiv === 'bullish') {
    gains.push({ reason: 'RSI 강세 다이버전스 (주가↓ RSI↑) → +7 (숨은 반등)', delta: 7 });
  }

  // ---------- EMA20 Slope ----------
  const emaSlope = ema20SlopeOf(stockBars);
  if (emaSlope) {
    if (emaSlope.signal === 'strong_up') {
      gains.push({ reason: `EMA20 기울기 +${emaSlope.slope.toFixed(2)}%/일 → +5 (강한 모멘텀)`, delta: 5 });
    } else if (emaSlope.signal === 'flat') {
      deductions.push({ reason: `EMA20 기울기 평평 → -3 (모멘텀 둔화)`, delta: -3 });
    } else if (emaSlope.signal === 'down' || emaSlope.signal === 'strong_down') {
      deductions.push({ reason: `EMA20 기울기 ${emaSlope.slope.toFixed(2)}%/일 → -5 (하락 전환)`, delta: -5 });
    }
  }

  // ---------- Volume Pattern (up-day vs down-day) + trend confirmation ----------
  const volPat = volumePatternOf(stockBars);
  if (volPat) {
    if (volPat.signal === 'accumulation') {
      // Check volume trend confirmation: price up 10d + volume up 10d = confirmed
      let volConfirmed = true;
      if (stockBars.length >= 11) {
        const priceUp10 = stockBars[0].close > stockBars[10].close;
        if (priceUp10) {
          const recentVols = stockBars.slice(0, 10).map((b) => b.volume ?? 0);
          const olderVols = stockBars.slice(5, 15).map((b) => b.volume ?? 0);
          const avgRecent = recentVols.reduce((a, b) => a + b, 0) / recentVols.length;
          const avgOlder = olderVols.reduce((a, b) => a + b, 0) / olderVols.length;
          if (avgOlder > 0 && avgRecent < avgOlder * 0.9) {
            volConfirmed = false;
          }
        }
      }
      if (volConfirmed) {
        gains.push({ reason: `상승일/하락일 거래량비 ${volPat.ratio.toFixed(2)} → +5 (건강한 매집)`, delta: 5 });
      } else {
        gains.push({ reason: `상승일/하락일 거래량비 ${volPat.ratio.toFixed(2)} (매집이나 거래량 감소 추세 → 확인 보류)`, delta: 0 });
      }
    } else if (volPat.signal === 'distribution') {
      deductions.push({ reason: `상승일/하락일 거래량비 ${volPat.ratio.toFixed(2)} → -5 (분배 진행)`, delta: -5 });
    }
  }

  // ---------- Momentum Acceleration (10d/20d/60d annualized return) ----------
  if (stockBars.length >= 61) {
    const ret = (n: number) => stockBars.length > n ? stockBars[0].close / stockBars[n].close - 1 : null;
    const r10 = ret(10);
    const r20 = ret(20);
    const r60 = ret(60);
    if (r10 != null && r20 != null && r60 != null) {
      const ann10 = r10 * (252 / 10);
      const ann20 = r20 * (252 / 20);
      const ann60 = r60 * (252 / 60);
      if (ann10 > ann20 && ann20 > ann60 && ann10 > 0) {
        gains.push({
          reason: `모멘텀 가속 (10일 ${(r10 * 100).toFixed(1)}% > 20일 ${(r20 * 100).toFixed(1)}% > 60일 ${(r60 * 100).toFixed(1)}%) → +5`,
          delta: 5,
        });
      } else if (ann10 < ann20 && ann20 < ann60 && ann10 < ann60) {
        deductions.push({
          reason: `모멘텀 감속 (10일 ${(r10 * 100).toFixed(1)}% < 20일 ${(r20 * 100).toFixed(1)}% < 60일 ${(r60 * 100).toFixed(1)}%) → -5`,
          delta: -5,
        });
      }
    }
  }

  // ---------- MA Slope Alignment (EMA20 + SMA50 + SMA200 all rising/falling) ----------
  if (stockBars.length >= 205) {
    const slopeOf = (fn: (b: PriceBar[]) => number | null, bars: PriceBar[]): number | null => {
      const now = fn(bars);
      const prev = fn(bars.slice(5));
      if (now == null || prev == null || prev === 0) return null;
      return (now - prev) / prev;
    };
    const emaS = slopeOf((b) => ema(b, 20), stockBars);
    const sma50s = slopeOf((b) => sma(b, 50), stockBars);
    const sma200s = slopeOf((b) => sma(b, 200), stockBars);
    if (emaS != null && sma50s != null && sma200s != null) {
      if (emaS > 0 && sma50s > 0 && sma200s > 0) {
        gains.push({ reason: `이평선 기울기 정렬 (EMA20/SMA50/SMA200 전부 상승) → +5`, delta: 5 });
      } else if (emaS < 0 && sma50s < 0 && sma200s < 0) {
        deductions.push({ reason: `이평선 기울기 역정렬 (EMA20/SMA50/SMA200 전부 하락) → -5`, delta: -5 });
      }
    }
  }

  // ---------- 52w High Volume Breakout ----------
  if (stockBars.length >= 252) {
    const high1y = Math.max(...stockBars.slice(0, 252).map((b) => b.high ?? b.close));
    const ratio52 = high1y > 0 ? stockBars[0].close / high1y : 0;
    if (ratio52 >= 0.98) {
      if (vr != null && vr >= 1.5) {
        gains.push({
          reason: `신고가 거래량 돌파 (52주 고점 ${(ratio52 * 100).toFixed(0)}% + 거래량 ${vr.toFixed(2)}x) → +10`,
          delta: 10,
        });
      } else if (vr != null && vr < 1.0) {
        gains.push({
          reason: `신고가 접근이나 거래량 미달 (${vr.toFixed(2)}x) — 가짜 돌파 주의`,
          delta: 0,
        });
      }
    }
  }

  // ---------- ATR Trend ----------
  const atrT = atrTrendOf(stockBars);
  if (atrT) {
    if (atrT.signal === 'contracting') {
      gains.push({ reason: `ATR 압축 (${atrT.changeRatio.toFixed(2)}x) → +3 (에너지 응축)`, delta: 3 });
    } else if (atrT.signal === 'expanding' && r30 != null && r30 < -0.05) {
      deductions.push({ reason: `ATR 확대 + 하락 → -3 (하방 변동성)`, delta: -3 });
    }
  }

  // ---------- Support/Resistance Cluster ----------
  const srClusters = supportResistanceClusters(stockBars);
  const nearSupport = srClusters.find((c) => c.type === 'support' && c.distancePct < 3);
  if (nearSupport) {
    gains.push({
      reason: `${nearSupport.sources.join('+')} 지지 클러스터 근접 (${nearSupport.distancePct.toFixed(1)}%) → +5`,
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
    if (near52wHigh) {
      deductions.push({ reason: `30일 +${(r30 * 100).toFixed(0)}% 급등 → -5 (52주 고점 90%+ 감경)`, delta: -5 });
    } else {
      deductions.push({ reason: `30일 +${(r30 * 100).toFixed(0)}% 급등 → -10 (눌림 위험)`, delta: -10 });
    }
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
  let score = Math.max(0, Math.min(MAX_SCORE, gainSum + deductionSum));

  // ADX-based soft cap: without a confirmed trend, timing can't score very high.
  const adxCap =
    adxVal != null && adxVal < 15 ? 60
      : adxVal != null && adxVal < 20 ? 75
      : null;
  if (adxCap != null && score > adxCap) {
    deductions.push({
      reason: `ADX ${adxVal!.toFixed(0)} → 타이밍 캡 ${adxCap} 적용 (${score} → ${adxCap})`,
      delta: adxCap - score,
    });
    score = adxCap;
  }

  let level: TimingScoreResult['level'];
  if (score >= 70) level = 'STRONG';
  else if (score >= 50) level = 'WATCH';
  else if (score >= 30) level = 'NEUTRAL';
  else level = 'AVOID';

  return { score, gains, deductions, level };
}

/** Post-processing coherence floor: a fundamentally OK stock shouldn't
 *  show an extreme Entry of 0–10. Tiered floors prevent the case where
 *  MSFT (Fund 62, Timing 0) or PEP (Fund 47, Timing 17) collapse to near-zero
 *  just because the setup is poor.
 *    Fund ≥ 75 → Timing ≥ 25 (level NEUTRAL — company is solid)
 *    Fund ≥ 60 → Timing ≥ 20 (level stays AVOID — fundamentals OK, setup bad)
 *    Fund ≥ 50 → Timing ≥ 15 (level stays AVOID) */
export function applyCoherenceFloor(
  timing: TimingScoreResult,
  fundamentalScoreValue: number,
): TimingScoreResult {
  let floor = 0;
  let flooredLevel: TimingScoreResult['level'] | null = null;
  if (fundamentalScoreValue >= 75) {
    floor = 25;
    flooredLevel = 'NEUTRAL';
  } else if (fundamentalScoreValue >= 60) {
    floor = 20;
    flooredLevel = 'AVOID';
  } else if (fundamentalScoreValue >= 50) {
    floor = 15;
    flooredLevel = 'AVOID';
  }

  if (floor > 0 && timing.score < floor) {
    const before = timing.score;
    return {
      ...timing,
      score: floor,
      gains: [
        ...timing.gains,
        {
          reason: `펀더멘탈 ${fundamentalScoreValue} 보정 → 타이밍 ${before} → ${floor} (펀더 양호, 자리만 나쁨)`,
          delta: floor - before,
        },
      ],
      level: flooredLevel!,
    };
  }
  return timing;
}
