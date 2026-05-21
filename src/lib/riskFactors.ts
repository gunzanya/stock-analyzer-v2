// Risk factor extraction — surfaces concrete red flags from fundamentals
// + indicators + safety guard state for display in the UI.

import type {
  AnalysisResult,
  FundamentalData,
  PriceBar,
  RiskFactor,
  SafetyGuardResult,
} from './types.js';
import {
  bollingerBands,
  bollingerBreakout,
  bollingerSqueeze,
  ema,
  fibProximity,
  fibonacciLevels,
  rsi,
  sma,
  volumeRatio,
} from './indicators.js';

interface RiskInputs {
  fund: FundamentalData;
  safety: SafetyGuardResult;
  indicators: AnalysisResult['indicators'];
  /** Optional — when present, enables Fibonacci / Bollinger risk hints. */
  stockBars?: PriceBar[];
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function extractRiskFactors(inp: RiskInputs): RiskFactor[] {
  const out: RiskFactor[] = [];
  const f = inp.fund;
  const ind = inp.indicators;

  // Loss quarters
  const lossQuarters = f.quarterly
    .slice(0, 4)
    .filter((q) => q.eps != null && q.eps < 0).length;
  if (lossQuarters >= 4) {
    out.push({ severity: 'high', message: '최근 4분기 연속 적자' });
  } else if (lossQuarters >= 2) {
    out.push({ severity: 'medium', message: `최근 4분기 중 ${lossQuarters}분기 적자` });
  }

  // Debt
  if (isNum(f.debtToEquity)) {
    const ratio = f.debtToEquity > 5 ? f.debtToEquity / 100 : f.debtToEquity;
    if (ratio > 2.0) {
      out.push({ severity: 'high', message: `부채/자본 ${ratio.toFixed(1)} (>2.0)` });
    } else if (ratio > 1.0) {
      out.push({ severity: 'medium', message: `부채/자본 ${ratio.toFixed(1)} (>1.0)` });
    }
  }

  // Extreme valuation
  if (isNum(f.psr) && f.psr > 30) {
    out.push({ severity: 'high', message: `PSR ${f.psr.toFixed(0)} (거품 위험)` });
  } else if (isNum(f.psr) && f.psr > 15) {
    out.push({ severity: 'medium', message: `PSR ${f.psr.toFixed(0)} (고평가)` });
  }
  if (isNum(f.per) && f.per > 100) {
    out.push({ severity: 'medium', message: `PER ${f.per.toFixed(0)} (극단)` });
  }

  // Peak-earnings tell: low PER + huge EPS growth = market pricing in a
  // reversion. Classic late-cycle pattern for cyclicals/commodities.
  if (
    isNum(f.per) &&
    f.per > 0 &&
    f.per < 12 &&
    isNum(f.epsGrowthYoY) &&
    f.epsGrowthYoY > 0.5
  ) {
    out.push({
      severity: 'medium',
      message: `PER ${f.per.toFixed(0)} + EPS YoY +${(f.epsGrowthYoY * 100).toFixed(0)}% (이익 피크 가능성)`,
    });
  }

  // Volume / technical
  if (ind.volumeRatio != null && ind.volumeRatio < 0.7) {
    out.push({ severity: 'medium', message: `거래량 ${ind.volumeRatio.toFixed(2)}x (위축)` });
  }
  if (ind.adx != null && ind.adx < 20) {
    out.push({ severity: 'low', message: `ADX ${ind.adx.toFixed(0)} (추세 없음)` });
  }
  if (ind.obvDivergence === true) {
    out.push({ severity: 'high', message: 'OBV 다이버전스 (가격↑ OBV↓)' });
  }

  // Drawdown
  if (ind.return90d != null && ind.return90d < -0.2) {
    out.push({
      severity: 'high',
      message: `3개월 ${(ind.return90d * 100).toFixed(0)}% drawdown`,
    });
  } else if (ind.return90d != null && ind.return90d < -0.1) {
    out.push({
      severity: 'medium',
      message: `3개월 ${(ind.return90d * 100).toFixed(0)}% 하락`,
    });
  }

  // Safety guard
  if (inp.safety.triggered && inp.safety.sectorContext) {
    out.push({ severity: 'medium', message: inp.safety.sectorContext });
  }

  // EPS growth deceleration (quarter-over-quarter)
  if (f.quarterly.length >= 2) {
    const e0 = f.quarterly[0].eps;
    const e1 = f.quarterly[1].eps;
    if (isNum(e0) && isNum(e1) && e1 !== 0) {
      const qoq = e0 / e1 - 1;
      if (qoq < -0.3) {
        out.push({ severity: 'medium', message: `분기 EPS ${(qoq * 100).toFixed(0)}% 감소 (QoQ)` });
      }
    }
  }

  // Fibonacci / Bollinger — only when raw bars are supplied
  if (inp.stockBars && inp.stockBars.length >= 20) {
    const bars = inp.stockBars;
    const fib = fibonacciLevels(bars);
    if (fib) {
      const prox = fibProximity(bars, fib);
      if (prox.kind === 'near') {
        out.push({
          severity: 'low',
          message: `피보나치 ${prox.level}% 지지 테스트 중 (±${prox.distancePct.toFixed(1)}%)`,
        });
      } else if (prox.kind === 'broke_618') {
        out.push({
          severity: 'medium',
          message: `피보나치 61.8% 핵심 지지 이탈`,
        });
      }
    }
    const bb = bollingerBands(bars);
    if (bb) {
      if (bollingerSqueeze(bb)) {
        out.push({
          severity: 'low',
          message: `볼린저 밴드 수축 — 변동성 압축, 큰 움직임 임박`,
        });
      }
      const breakout = bollingerBreakout(bars, bb);
      const rsiVal = rsi(bars, 14);
      if (breakout === 'lower' && rsiVal != null && rsiVal < 35) {
        out.push({
          severity: 'high',
          message: `볼린저 하단 터치 + RSI ${rsiVal.toFixed(0)} (과매도 극단)`,
        });
      } else if (breakout === 'lower') {
        out.push({ severity: 'medium', message: `볼린저 하단 터치 주의` });
      }
    }
  }

  // MA convergence + volume breakout
  if (inp.stockBars && inp.stockBars.length >= 200) {
    const bars = inp.stockBars;
    const ema20 = ema(bars, 20);
    const sma50 = sma(bars, 50);
    const sma200 = sma(bars, 200);
    if (ema20 != null && sma50 != null && sma200 != null) {
      const maMax = Math.max(ema20, sma50, sma200);
      const maMin = Math.min(ema20, sma50, sma200);
      const spread = maMax > 0 ? (maMax - maMin) / maMax : 1;
      if (spread <= 0.10) {
        const close = bars[0].close;
        const vr = volumeRatio(bars);
        const allAbove = close > ema20 && close > sma50 && close > sma200;
        if (allAbove && vr != null && vr >= 1.5) {
          out.push({
            severity: 'low',
            message: `🔥 이평선 수렴 후 거래량 돌파 (EMA20/SMA50/SMA200 ${(spread * 100).toFixed(1)}% 밴드, 거래량 ${vr.toFixed(2)}x)`,
          });
        } else {
          out.push({
            severity: 'low',
            message: `이평선 수렴 중 (${(spread * 100).toFixed(1)}% 밴드) — 큰 움직임 대기`,
          });
        }
      }
    }
  }

  // Data warnings
  for (const w of f.warnings) {
    if (/PBR|매출|EPS growth/.test(w)) {
      out.push({ severity: 'low', message: `데이터: ${w}` });
    }
  }

  return out;
}
