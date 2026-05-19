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

  // Entry: current close. (Could refine with limit-near-EMA20 for pullbacks,
  // but we expose pricing in the UI so traders can adjust.)
  const entry = round(close);
  const stop = round(entry - params.stop * atrVal);
  const target1 = round(entry + params.t1 * atrVal);
  const target2 = round(entry + params.t2 * atrVal);

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
    `${classification.primary} 유형 기준 ATR×${params.stop}/${params.t1}/${params.t2}로 설정. ` +
    `R:R ${riskReward1 ?? '—'} / ${riskReward2 ?? '—'} (1차/2차 목표).`;

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
