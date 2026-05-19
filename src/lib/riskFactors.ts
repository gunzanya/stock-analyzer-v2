// Risk factor extraction — surfaces concrete red flags from fundamentals
// + indicators + safety guard state for display in the UI.

import type {
  AnalysisResult,
  FundamentalData,
  RiskFactor,
  SafetyGuardResult,
} from './types.js';

interface RiskInputs {
  fund: FundamentalData;
  safety: SafetyGuardResult;
  indicators: AnalysisResult['indicators'];
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

  // Data warnings
  for (const w of f.warnings) {
    if (/PBR|매출|EPS growth/.test(w)) {
      out.push({ severity: 'low', message: `데이터: ${w}` });
    }
  }

  return out;
}
