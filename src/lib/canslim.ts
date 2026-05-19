// CANSLIM (extended to 12 items). Each item scores 0–100 from fundamentals
// + indicators. Type-specific stars are declared inline so the UI can show
// which items matter most for the current classification.

import type {
  CanslimItem,
  CanslimKey,
  CanslimResult,
  FundamentalData,
  PriceBar,
  StockType,
} from './types.js';

interface CanslimInputs {
  fund: FundamentalData;
  stockBars: PriceBar[];
  benchBars: PriceBar[];
  rs: number | null;
  adx: number | null;
  volumeRatio: number | null;
  return90d: number | null;
}

// Clamp a value to [0,100]
const clamp = (v: number) => Math.max(0, Math.min(100, v));

// Linear map from [lo,hi] (clamped) to [0,100]
function lin(value: number | null | undefined, lo: number, hi: number): number {
  if (value == null || !Number.isFinite(value)) return 50; // neutral default
  if (hi === lo) return 50;
  return clamp(((value - lo) / (hi - lo)) * 100);
}

// ---- Per-item scorers ----

function scoreC(inp: CanslimInputs): number {
  // Latest-quarter EPS growth via YoY proxy from financialData
  const eps = inp.fund.epsGrowthYoY;
  if (eps == null) return 40;
  return lin(eps, -0.1, 0.5); // 0% → 17, 25% → 58, 50%+ → 100
}

function scoreA(inp: CanslimInputs): number {
  // Annual EPS growth — derive from annual[]
  const annual = inp.fund.annual.filter((a) => a.eps != null);
  if (annual.length < 2) return 40;
  const [thisYr, prevYr] = annual;
  const this_ = thisYr.eps!;
  const prev = prevYr.eps!;
  if (prev <= 0) {
    // Flipping from loss → profit is great; map by magnitude of recovery
    return this_ > 0 ? 80 : 20;
  }
  const growth = this_ / prev - 1;
  return lin(growth, -0.1, 0.4);
}

function scoreN(inp: CanslimInputs): number {
  // New high proximity — distance to 252-day high
  if (inp.stockBars.length < 252) return 40;
  const high1y = Math.max(...inp.stockBars.slice(0, 252).map((b) => b.high ?? b.close));
  if (high1y <= 0) return 40;
  const ratio = inp.stockBars[0].close / high1y;
  return lin(ratio, 0.6, 1.0);
}

function scoreS(inp: CanslimInputs): number {
  // Supply/demand: recent volume vs average + price-volume direction
  const vr = inp.volumeRatio;
  if (vr == null) return 40;
  // Healthy: 1.0–2.5x. Below 0.7 or above 3.0 (parabolic) → lower.
  if (vr >= 1.0 && vr <= 2.5) return clamp(70 + (vr - 1.0) * 20);
  if (vr < 1.0) return lin(vr, 0.3, 1.0);
  // > 2.5 — possibly climactic
  return clamp(90 - (vr - 2.5) * 15);
}

function scoreL(inp: CanslimInputs): number {
  // RS already 0–100
  return inp.rs ?? 50;
}

function scoreI(inp: CanslimInputs): number {
  // Institutional sponsorship — Yahoo doesn't reliably expose this in our
  // current fetch. Use float ownership as a weak proxy: tighter float +
  // recent rev growth → more likely institutional accumulation.
  // For now: neutral 50, slight boost if mcap > $5B (institutional eligible).
  const mc = inp.fund.marketCap;
  if (mc == null) return 50;
  if (mc > 50e9) return 70;
  if (mc > 5e9) return 60;
  if (mc > 1e9) return 50;
  return 35;
}

function scoreM(inp: CanslimInputs): number {
  // Market direction — benchmark's 90-day return + position vs 50/200 SMA
  if (inp.benchBars.length < 200) return 50;
  const close = inp.benchBars[0].close;
  const sma50 =
    inp.benchBars.slice(0, 50).reduce((a, b) => a + b.close, 0) / 50;
  const sma200 =
    inp.benchBars.slice(0, 200).reduce((a, b) => a + b.close, 0) / 200;
  let score = 50;
  if (close > sma50) score += 15;
  if (close > sma200) score += 20;
  if (sma50 > sma200) score += 10;
  // Recent 3M return on benchmark
  if (inp.benchBars.length >= 63) {
    const r = inp.benchBars[0].close / inp.benchBars[63].close - 1;
    score += Math.max(-15, Math.min(15, r * 50));
  }
  return clamp(score);
}

function scoreQ(inp: CanslimInputs): number {
  // Quality: ROE + operating margin
  const roe = inp.fund.roe;
  const om = inp.fund.operatingMargin;
  if (roe == null && om == null) return 40;
  const rScore = roe == null ? 50 : lin(roe, 0.05, 0.3);
  const oScore = om == null ? 50 : lin(om, 0.05, 0.35);
  return Math.round((rScore + oScore) / 2);
}

function scoreV(inp: CanslimInputs): number {
  // Valuation: PER (lower better) + PEG (lower better, 1 is ideal)
  // Inverted scoring: cheap → high score.
  const per = inp.fund.per;
  const peg = inp.fund.peg;
  let perScore = 50;
  if (per != null && per > 0) {
    // 10 → 90, 20 → 60, 40 → 20, >60 → 5
    if (per < 10) perScore = 90;
    else if (per < 20) perScore = 70;
    else if (per < 30) perScore = 55;
    else if (per < 50) perScore = 35;
    else perScore = 15;
  }
  let pegScore = 50;
  if (peg != null && peg > 0) {
    if (peg < 1.0) pegScore = 90;
    else if (peg < 2.0) pegScore = 65;
    else if (peg < 3.0) pegScore = 40;
    else pegScore = 20;
  }
  return Math.round((perScore + pegScore) / 2);
}

function scoreB(inp: CanslimInputs): number {
  // Balance sheet: debt-to-equity (lower better)
  const de = inp.fund.debtToEquity;
  if (de == null) return 50;
  // Yahoo's debtToEquity is reported as a percent in some cases (e.g. 150
  // means 150%). Normalize: if > 5, treat as percent.
  const ratio = de > 5 ? de / 100 : de;
  if (ratio < 0.3) return 90;
  if (ratio < 0.6) return 75;
  if (ratio < 1.0) return 60;
  if (ratio < 2.0) return 40;
  return 20;
}

function scoreG(inp: CanslimInputs): number {
  // Revenue growth YoY
  const rev = inp.fund.revenueGrowthYoY;
  if (rev == null) return 40;
  return lin(rev, -0.05, 0.35);
}

function scoreT(inp: CanslimInputs): number {
  // Trend: ADX strength + MA alignment + recent return
  if (inp.stockBars.length < 200) return 50;
  let score = 50;
  if (inp.adx != null) {
    if (inp.adx >= 35) score += 15;
    else if (inp.adx >= 25) score += 10;
    else if (inp.adx < 20) score -= 10;
  }
  const close = inp.stockBars[0].close;
  const sma50 = inp.stockBars.slice(0, 50).reduce((a, b) => a + b.close, 0) / 50;
  const sma200 =
    inp.stockBars.slice(0, 200).reduce((a, b) => a + b.close, 0) / 200;
  if (close > sma50) score += 10;
  if (close > sma200) score += 10;
  if (sma50 > sma200) score += 10;
  if (inp.return90d != null) {
    score += Math.max(-15, Math.min(15, inp.return90d * 30));
  }
  return clamp(score);
}

// ---- Type stars ----

const STARS: Record<CanslimKey, StockType[]> = {
  C: ['FAST_GROWER', 'TURNAROUND'],
  A: ['FAST_GROWER', 'STALWART'],
  N: ['FAST_GROWER', 'SPECULATIVE'],
  S: ['SPECULATIVE'],
  L: ['FAST_GROWER', 'SPECULATIVE'],
  I: ['STALWART', 'ASSET_PLAY'],
  M: ['CYCLICAL'],
  Q: ['STALWART', 'TURNAROUND'],
  V: ['SLOW_GROWER', 'CYCLICAL', 'ASSET_PLAY'],
  B: ['STALWART', 'TURNAROUND', 'ASSET_PLAY', 'SLOW_GROWER'],
  G: ['FAST_GROWER'],
  T: ['CYCLICAL', 'SPECULATIVE'],
};

const LABELS: Record<CanslimKey, { label: string; description: string }> = {
  C: { label: '분기 EPS 성장', description: '최근 분기 EPS YoY' },
  A: { label: '연간 EPS 성장', description: '전년 대비 EPS 성장률' },
  N: { label: '신고가 근접', description: '52주 고점 대비 위치' },
  S: { label: '거래량/수급', description: '20일 평균 대비 거래량' },
  L: { label: '리더십 (RS)', description: '서브 산업 ETF 대비 상대강도' },
  I: { label: '기관 보유', description: '시총·유동성 기반 기관 수용성' },
  M: { label: '시장 추세', description: '벤치마크 50/200일선 정렬' },
  Q: { label: '품질', description: 'ROE + 영업이익률' },
  V: { label: '가치', description: 'PER + PEG (낮을수록 좋음)' },
  B: { label: '재무건전성', description: '부채/자본 비율' },
  G: { label: '매출 성장', description: '매출 YoY 증가율' },
  T: { label: '추세', description: 'ADX + 이평선 정렬 + 90일 수익률' },
};

const KEYS: CanslimKey[] = ['C', 'A', 'N', 'S', 'L', 'I', 'M', 'Q', 'V', 'B', 'G', 'T'];
const SCORERS: Record<CanslimKey, (i: CanslimInputs) => number> = {
  C: scoreC, A: scoreA, N: scoreN, S: scoreS, L: scoreL, I: scoreI,
  M: scoreM, Q: scoreQ, V: scoreV, B: scoreB, G: scoreG, T: scoreT,
};

export function computeCanslim(inp: CanslimInputs): CanslimResult {
  const items: CanslimItem[] = KEYS.map((key) => ({
    key,
    label: LABELS[key].label,
    description: LABELS[key].description,
    score: Math.round(SCORERS[key](inp)),
    starredForTypes: STARS[key],
  }));
  return { items };
}

export { KEYS as CANSLIM_KEYS, LABELS as CANSLIM_LABELS };
