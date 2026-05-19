// Safety guard: flags weak relative strength and labels the *context*
// (is the whole sector weak, or just the stock?).
//
// Inputs: stock RS (0–100) and 3-month returns of both stock and benchmark.

import type { PriceBar, SafetyGuardResult } from './types.js';
import { relativeStrength } from './indicators.js';

const RS_TRIGGER = 30;

export interface SafetyGuardInputs {
  stockBars: PriceBar[];
  benchmarkBars: PriceBar[];
  benchmarkLabel: string;        // e.g. "IGV" — displayed in context
}

export function evaluateSafetyGuard(inputs: SafetyGuardInputs): SafetyGuardResult {
  const { stockBars, benchmarkBars, benchmarkLabel } = inputs;
  const { rs, stockReturn3M, benchmarkReturn3M, excess } = relativeStrength(
    stockBars,
    benchmarkBars,
  );

  const reasons: string[] = [];

  // Trigger condition: an actual drawdown (alone), OR weak RS combined with
  // the stock being down. A stock that's up +20% but lagging a sub-sector
  // that's up +40% is *not* in trouble — don't fire the guard.
  let triggered = false;
  if (stockReturn3M != null && stockReturn3M < -0.15) {
    triggered = true;
    reasons.push(`3개월 수익률 ${(stockReturn3M * 100).toFixed(0)}% (drawdown)`);
  }
  if (rs < RS_TRIGGER && stockReturn3M != null && stockReturn3M < 0) {
    triggered = true;
    reasons.push(`RS ${rs.toFixed(0)} + 종목도 하락`);
  }

  if (!triggered) {
    return {
      triggered: false,
      reasons: [],
      sectorContext: null,
      sectorReturn3M: benchmarkReturn3M,
      stockReturn3M,
      excessVsSector: excess,
    };
  }

  // Build sector-context label
  let sectorContext: string;
  if (benchmarkReturn3M == null || stockReturn3M == null) {
    sectorContext = '⚠️ 시장 대비 부진 (벤치마크 데이터 부족)';
  } else if (benchmarkReturn3M > 0 && stockReturn3M < 0) {
    sectorContext = `🚨 ${benchmarkLabel} 강세 (${(benchmarkReturn3M * 100).toFixed(0)}%) 속 종목 약세 (${(stockReturn3M * 100).toFixed(0)}%) — 종목 자체 문제`;
  } else if (benchmarkReturn3M < -0.10 && (excess ?? 0) > -0.05) {
    sectorContext = `👀 ${benchmarkLabel} 섹터 전체 약세 (${(benchmarkReturn3M * 100).toFixed(0)}%) — 종목은 선방 (excess ${(((excess ?? 0)) * 100).toFixed(0)}%p). 섹터 회복 시 반등 후보`;
  } else if (benchmarkReturn3M < -0.10 && (excess ?? 0) < -0.10) {
    sectorContext = `⚠️ ${benchmarkLabel} 섹터 약세 + 종목도 부진 — 이중 역풍`;
  } else {
    sectorContext = `⚠️ ${benchmarkLabel} 대비 부진 (excess ${(((excess ?? 0)) * 100).toFixed(0)}%p)`;
  }

  return {
    triggered: true,
    reasons,
    sectorContext,
    sectorReturn3M: benchmarkReturn3M,
    stockReturn3M,
    excessVsSector: excess,
  };
}
