// Trading strategy: entry / stop / 2 targets / R:R, based on ATR(14) and
// the current trend setup. Tightly tied to the classification — speculative
// stocks get tighter stops, slow growers get wider tolerances.

import type {
  ClassificationResult,
  PriceBar,
  StockType,
  StrategyResult,
} from './types.js';
import { atr, ema, sma } from './indicators.js';

// ATR multipliers per type
const ATR_PARAMS: Record<StockType, { stop: number; t1: number; t2: number }> = {
  FAST_GROWER: { stop: 2.0, t1: 3.5, t2: 7.0 },
  STALWART:    { stop: 2.5, t1: 3.0, t2: 6.0 },
  SLOW_GROWER: { stop: 2.5, t1: 2.5, t2: 5.0 },
  CYCLICAL:    { stop: 2.0, t1: 3.0, t2: 6.0 },
  TURNAROUND:  { stop: 1.8, t1: 3.5, t2: 7.0 },
  ASSET_PLAY:  { stop: 3.0, t1: 3.0, t2: 6.0 },
  SPECULATIVE: { stop: 1.5, t1: 3.5, t2: 7.5 },
};

function round(v: number, digits = 2): number {
  const p = Math.pow(10, digits);
  return Math.round(v * p) / p;
}

/** 52-week (252 trading days) high from newest-first bars. */
function high52w(bars: PriceBar[]): number | null {
  const window = bars.slice(0, Math.min(252, bars.length));
  if (window.length < 20) return null;
  let max = -Infinity;
  for (const b of window) {
    const h = b.high ?? b.close;
    if (h > max) max = h;
  }
  return Number.isFinite(max) ? max : null;
}

export function computeStrategy(
  bars: PriceBar[],
  classification: ClassificationResult,
): StrategyResult {
  if (bars.length < 50) {
    return {
      entry: null,
      stop: null,
      target1: null,
      target2: null,
      riskReward1: null,
      riskReward2: null,
      atr14: null,
      stopRule: '데이터 부족',
      rationale: '가격 시계열이 50 거래일 미만이라 전략을 계산할 수 없습니다.',
    };
  }
  const close = bars[0].close;
  const atrVal = atr(bars);
  const ema20 = ema(bars, 20);
  const sma50 = sma(bars, 50);
  const params = ATR_PARAMS[classification.primary];

  if (atrVal == null || atrVal <= 0) {
    return {
      entry: round(close),
      stop: null,
      target1: null,
      target2: null,
      riskReward1: null,
      riskReward2: null,
      atr14: null,
      stopRule: 'ATR 계산 불가',
      rationale: '변동성 지표가 계산되지 않아 손절·목표가를 산출하지 못했습니다.',
    };
  }

  const entry = round(close);
  const stop = round(entry - params.stop * atrVal);
  const atrT1 = round(entry + params.t1 * atrVal);
  const atrT2 = round(entry + params.t2 * atrVal);

  // 52-week high–aware targets
  const h52 = high52w(bars);
  let target1: number;
  let target2: number;
  let targetNote: string;

  if (h52 == null) {
    // No 52w data — pure ATR targets
    target1 = atrT1;
    target2 = atrT2;
    targetNote = 'ATR 기반';
  } else {
    const distToHigh = h52 / entry; // e.g. 1.10 = 10% above entry
    if (distToHigh <= 1.05) {
      // Already near 52w high (within 5%): target the high, then Fib 127.2% extension
      target1 = round(h52);
      const range = h52 - (bars.length >= 252
        ? Math.min(...bars.slice(0, 252).map((b) => b.low ?? b.close))
        : entry);
      target2 = round(h52 + range * 0.272);
      targetNote = `고점 근접(${(distToHigh * 100 - 100).toFixed(1)}%) → 1차=52주고점, 2차=피보나치 127.2%`;
    } else if (distToHigh >= 1.43) {
      // Far from high (70% or below): pure ATR, plenty of room
      target1 = atrT1;
      target2 = atrT2;
      targetNote = `고점 대비 ${((1 / distToHigh) * 100).toFixed(0)}% — ATR 기반 (저항 여유)`;
    } else {
      // Mid-range: 1st target = min(ATR target, 52w high), 2nd = high + Fib 50% extension
      target1 = round(Math.min(atrT1, h52));
      target2 = round(h52 + (h52 - entry) * 0.5);
      targetNote = target1 < atrT1
        ? `1차=min(ATR ${atrT1}, 52주고점 ${round(h52)}) → ${target1}`
        : `1차=ATR ${atrT1} (고점 ${round(h52)} 미만)`;
    }
  }

  const risk = entry - stop;
  const riskReward1 = risk > 0 ? round((target1 - entry) / risk, 2) : null;
  const riskReward2 = risk > 0 ? round((target2 - entry) / risk, 2) : null;

  // Stop rule narrative
  let stopRule = `진입 - ATR×${params.stop} = ${stop} (변동성 기반)`;
  if (ema20 != null && ema20 > stop) {
    stopRule += ` · 20일 EMA(${round(ema20)}) 하향 이탈 시 즉시 청산`;
  } else if (sma50 != null && sma50 > stop) {
    stopRule += ` · 50일 SMA(${round(sma50)}) 하향 이탈 시 청산 검토`;
  }

  const rationale =
    `${classification.primary} 유형, ${targetNote}. ` +
    `R:R ${riskReward1 ?? '—'} / ${riskReward2 ?? '—'} (1차/2차).`;

  return {
    entry,
    stop,
    target1,
    target2,
    riskReward1,
    riskReward2,
    atr14: round(atrVal),
    stopRule,
    rationale,
  };
}
