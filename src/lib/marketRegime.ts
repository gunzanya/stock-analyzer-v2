// Market Regime — bond/rate canary signals that classify the market into
// 공격(Risk-ON) / 중립 / 방어(Risk-OFF) before entering equities.
//
// Four canaries (each scored -2..+2):
//   1) Yield curve   : ^TNX - ^IRX (10Y - 3M)
//   2) Rate spike    : ^TNX 20-trading-day change
//   3) Credit spread : HYG/LQD 20-day trend (risk-on vs risk-off bonds)
//   4) Flight to safety : TLT 20-day trend (+ volume confirmation)
//
// The pure compute (computeRegime) lives here so it is shared between the
// serverless endpoint (api/market-regime.ts) and any client-side use, and is
// unit-testable in isolation — mirroring how api/analyze imports computeX from
// src/lib.

export type RegimeKind = 'attack' | 'neutral' | 'defense';
export type CanaryKey = 'yieldCurve' | 'rateSpike' | 'creditSpread' | 'flightToSafety';

export interface CanarySignal {
  key: CanaryKey;
  label: string;   // "10Y-3M 금리차"
  score: number;   // -2 | -1 | 0 | +1 | +2
  emoji: string;   // 🟢 🟡 🟠 🔴
  value: string;   // formatted reading, e.g. "+0.91%"
  note: string;    // short verdict, e.g. "정상" / "금리 상승 주의"
}

export interface RegimeGuide {
  positions: string; // "5종목"
  size: string;      // "2/3 사이즈"
  grade: string;     // "A급만"
  cash: string;      // "현금 40%"
}

export interface MarketRegime {
  regime: RegimeKind;
  label: string;       // "중립"
  emoji: string;       // 🟢 🟡 🔴
  totalScore: number;
  signals: CanarySignal[];
  guide: RegimeGuide;
  recommendation: string; // one-line action, e.g. "A급만 진입, 현금 40%, 금리 주시"
  asOf: string;           // YYYY-MM-DD of the latest bar used
  stale: boolean;         // true if any series was missing/short
}

/** Closes + volumes for one instrument, newest-first (index 0 = latest). */
export interface RegimeSeries {
  closes: number[];
  volumes: (number | null)[];
}

export interface RegimeInputs {
  tnx: RegimeSeries; // 10Y yield (%)
  irx: RegimeSeries; // 3M yield (%)
  tlt: RegimeSeries; // long treasury ETF
  hyg: RegimeSeries; // high-yield ETF
  lqd: RegimeSeries; // investment-grade ETF
  asOf: string;
}

/** Emoji for a per-signal sub-score. */
function emojiFor(score: number): string {
  if (score >= 1) return '🟢';
  if (score === 0) return '🟡';
  if (score === -1) return '🟠';
  return '🔴';
}

/** Value `n` trading days ago (newest-first array), clamped to what exists. */
function ago(arr: number[], n: number): number | null {
  if (arr.length === 0) return null;
  return arr[Math.min(n, arr.length - 1)];
}

const LOOKBACK = 20;

// ---- Canary 1: Yield curve (10Y - 3M) ----
function yieldCurveSignal(tnx: number[], irx: number[]): CanarySignal {
  const spread = (tnx[0] ?? 0) - (irx[0] ?? 0);
  let score: number;
  let note: string;
  if (spread >= 0.5) {
    score = 2;
    note = '정상 (우상향)';
  } else if (spread >= 0) {
    score = 0;
    note = '평탄화 주의';
  } else {
    score = -2;
    note = '역전 — 침체 신호';
  }
  const sign = spread >= 0 ? '+' : '';
  return {
    key: 'yieldCurve',
    label: '10Y-3M 금리차',
    score,
    emoji: emojiFor(score),
    value: `${sign}${spread.toFixed(2)}%`,
    note,
  };
}

// ---- Canary 2: Rate spike (^TNX 20일 변화) ----
function rateSpikeSignal(tnx: number[]): CanarySignal {
  const past = ago(tnx, LOOKBACK) ?? tnx[0] ?? 0;
  const change = (tnx[0] ?? 0) - past;
  let score: number;
  let note: string;
  if (change >= 0.5) {
    score = -2;
    note = '금리 급등 — 위험';
  } else if (change >= 0.2) {
    score = -1;
    note = '금리 상승 주의';
  } else {
    score = 1;
    note = change <= -0.2 ? '금리 하락 — 우호적' : '안정';
  }
  const sign = change >= 0 ? '+' : '';
  return {
    key: 'rateSpike',
    label: '10Y 20일 변화',
    score,
    emoji: emojiFor(score),
    value: `${sign}${change.toFixed(2)}%p`,
    note,
  };
}

// ---- Canary 3: Credit spread (HYG/LQD 20일 추세) ----
function creditSpreadSignal(hyg: number[], lqd: number[]): CanarySignal {
  const n = Math.min(hyg.length, lqd.length);
  const ratioNow = lqd[0] ? (hyg[0] ?? 0) / lqd[0] : 0;
  const pastIdx = Math.min(LOOKBACK, n - 1);
  const ratioPast = lqd[pastIdx] ? (hyg[pastIdx] ?? 0) / lqd[pastIdx] : ratioNow;
  const pct = ratioPast ? ((ratioNow - ratioPast) / ratioPast) * 100 : 0;
  let score: number;
  let note: string;
  if (pct >= 0.5) {
    score = 2;
    note = '강세 — 위험선호';
  } else if (pct <= -0.5) {
    score = -2;
    note = '약세 — 신용 경계';
  } else {
    score = 0;
    note = '횡보';
  }
  const sign = pct >= 0 ? '+' : '';
  return {
    key: 'creditSpread',
    label: 'HYG/LQD 추세',
    score,
    emoji: emojiFor(score),
    value: `${sign}${pct.toFixed(2)}%`,
    note,
  };
}

// ---- Canary 4: Flight to safety (TLT 20일 추세 + 거래량) ----
function flightToSafetySignal(tltCloses: number[], tltVolumes: (number | null)[]): CanarySignal {
  const past = ago(tltCloses, LOOKBACK) ?? tltCloses[0] ?? 0;
  const pct = past ? (((tltCloses[0] ?? 0) - past) / past) * 100 : 0;

  // Volume confirmation: last 5 sessions vs the prior 20.
  const recent = tltVolumes.slice(0, 5).filter((v): v is number => v != null);
  const prior = tltVolumes.slice(5, 25).filter((v): v is number => v != null);
  const avgRecent = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;
  const avgPrior = prior.length ? prior.reduce((a, b) => a + b, 0) / prior.length : 0;
  const volSurge = avgPrior > 0 && avgRecent > avgPrior * 1.3;

  let score: number;
  let note: string;
  if (pct >= 5) {
    score = -2;
    note = volSurge ? '안전자산 급등(거래량↑) — 도피' : '안전자산 급등 — 도피';
  } else if (pct >= 2.5) {
    score = -1;
    note = '안전자산 강세 주의';
  } else {
    score = 1;
    note = pct <= -2.5 ? '안전자산 약세 — 우호적' : '횡보';
  }
  const sign = pct >= 0 ? '+' : '';
  return {
    key: 'flightToSafety',
    label: 'TLT 추세',
    score,
    emoji: emojiFor(score),
    value: `${sign}${pct.toFixed(1)}%`,
    note,
  };
}

const GUIDES: Record<RegimeKind, RegimeGuide> = {
  attack: { positions: '8종목', size: '풀사이즈', grade: 'B급 허용', cash: '현금 20%' },
  neutral: { positions: '5종목', size: '2/3 사이즈', grade: 'A급만', cash: '현금 40%' },
  defense: { positions: '신규 최소화', size: '축소', grade: '방어주만', cash: '현금 60%+' },
};

const RECOMMENDATION: Record<RegimeKind, string> = {
  attack: 'B급까지 진입, 풀사이즈, 현금 20%',
  neutral: 'A급만 진입, 현금 40%, 금리 주시',
  defense: '신규 진입 최소화, 현금 60%+, 방어주 위주',
};

function classify(total: number): { regime: RegimeKind; label: string; emoji: string } {
  if (total >= 4) return { regime: 'attack', label: '공격 (Risk-ON)', emoji: '🟢' };
  if (total >= 0) return { regime: 'neutral', label: '중립', emoji: '🟡' };
  return { regime: 'defense', label: '방어 (Risk-OFF)', emoji: '🔴' };
}

/** Compute the market regime from newest-first bond/ETF series. */
export function computeRegime(inputs: RegimeInputs): MarketRegime {
  const { tnx, irx, tlt, hyg, lqd, asOf } = inputs;

  const signals: CanarySignal[] = [
    yieldCurveSignal(tnx.closes, irx.closes),
    rateSpikeSignal(tnx.closes),
    creditSpreadSignal(hyg.closes, lqd.closes),
    flightToSafetySignal(tlt.closes, tlt.volumes),
  ];

  const totalScore = signals.reduce((sum, s) => sum + s.score, 0);
  const { regime, label, emoji } = classify(totalScore);

  // Stale if any series lacks a full 20-day lookback (or is empty) — the banner
  // surfaces this so a partial fetch isn't read as a confident signal.
  const stale = [tnx, irx, tlt, hyg, lqd].some((s) => s.closes.length <= LOOKBACK);

  return {
    regime,
    label,
    emoji,
    totalScore,
    signals,
    guide: GUIDES[regime],
    recommendation: RECOMMENDATION[regime],
    asOf,
    stale,
  };
}
