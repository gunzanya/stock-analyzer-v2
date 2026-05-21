// Technical indicators and sub-industry ETF resolution.
// PriceBar arrays are expected NEWEST-FIRST (bars[0] = today).

import type { FundamentalData, PriceBar } from './types.js';

// ---------- sub-industry ETF map (stage 4 + stage 3 sub-industry RS) ----------

// Yahoo "industry" strings map to a tighter ETF when possible; otherwise we
// fall back to the SPDR sector ETF.
const INDUSTRY_ETF: Record<string, string> = {
  'Software—Application': 'IGV',
  'Software—Infrastructure': 'IGV',
  'Information Technology Services': 'IGV',
  Semiconductors: 'SOXX',
  'Semiconductor Equipment & Materials': 'SOXX',
  'Internet Retail': 'IBUY',
  'Internet Content & Information': 'SOCL',
  'Aerospace & Defense': 'ITA',
  'Auto Manufacturers': 'CARZ',
  'Drug Manufacturers—General': 'XPH',
  'Drug Manufacturers—Specialty & Generic': 'XPH',
  Biotechnology: 'XBI',
  'Oil & Gas Integrated': 'XLE',
  'Oil & Gas E&P': 'XOP',
  'Oil & Gas Refining & Marketing': 'XLE',
  'Banks—Diversified': 'KBE',
  'Insurance—Diversified': 'KIE',
  'Asset Management': 'KCE',
  REIT: 'VNQ',
  'REIT—Retail': 'VNQ',
  'REIT—Residential': 'VNQ',
  'REIT—Industrial': 'VNQ',
  Steel: 'SLX',
  Airlines: 'JETS',
  'Specialty Retail': 'XRT',
};

const SECTOR_ETF: Record<string, string> = {
  Technology: 'XLK',
  Healthcare: 'XLV',
  'Financial Services': 'XLF',
  'Consumer Cyclical': 'XLY',
  'Consumer Defensive': 'XLP',
  'Communication Services': 'XLC',
  Industrials: 'XLI',
  Energy: 'XLE',
  'Basic Materials': 'XLB',
  'Real Estate': 'XLRE',
  Utilities: 'XLU',
};

/** Cybersecurity name-based detection (CRWD, PANW, ZS, FTNT, S, etc.) */
function isCybersecurity(fund: FundamentalData): boolean {
  const name = fund.name.toLowerCase();
  return /crowdstrike|palo alto|fortinet|zscaler|sentinelone|cyberark|okta|cloudflare/.test(name);
}

/** Normalize industry string: em-dash, en-dash, and surrounding spaces all
 *  collapse to a single em-dash for lookup. (Yahoo returns inconsistent forms.) */
function normalizeIndustry(s: string): string {
  return s.replace(/\s*[—–-]\s*/g, '—').trim();
}

/** Returns the best benchmark ETF ticker for a stock. */
export function resolveBenchmarkEtf(fund: FundamentalData): string {
  // 1. Special name-based overrides
  if (isCybersecurity(fund)) return 'CIBR';
  // 2. Korean tickers → KOSPI/KOSDAQ broad index
  if (/\.KS$/i.test(fund.ticker)) return '^KS11';
  if (/\.KQ$/i.test(fund.ticker)) return '^KQ11';
  // 3. Industry-specific
  if (fund.industry) {
    const norm = normalizeIndustry(fund.industry);
    if (INDUSTRY_ETF[norm]) return INDUSTRY_ETF[norm];
    if (INDUSTRY_ETF[fund.industry]) return INDUSTRY_ETF[fund.industry];
  }
  // Partial industry match (REIT—*)
  if (fund.industry && /REIT/i.test(fund.industry)) return 'VNQ';
  // 4. Sector fallback
  if (fund.sector && SECTOR_ETF[fund.sector]) return SECTOR_ETF[fund.sector];
  // 5. Last resort: S&P 500
  return 'SPY';
}

// ---------- return / momentum helpers ----------

/** Period return: today's close vs `daysBack` trading days ago. */
function periodReturn(bars: PriceBar[], daysBack: number): number | null {
  if (bars.length <= daysBack) return null;
  const now = bars[0].close;
  const then = bars[daysBack].close;
  if (!then || then <= 0) return null;
  return now / then - 1;
}

export function return30d(bars: PriceBar[]): number | null {
  return periodReturn(bars, 21);
}
export function return90d(bars: PriceBar[]): number | null {
  return periodReturn(bars, 63);
}
export function return1y(bars: PriceBar[]): number | null {
  return periodReturn(bars, 252);
}

// ---------- volume ratio ----------

/** Latest day's volume divided by 20-bar average (newest after today).
 *  If the latest bar looks like an in-progress intraday snapshot
 *  (volume < 50% of trailing 50-day avg), it's dropped and the previous
 *  closed session is used instead — otherwise every ticker checked during
 *  US market hours would falsely register a "거래량 위축 심각" deduction. */
export function volumeRatio(bars: PriceBar[]): number | null {
  if (bars.length < 21) return null;
  const ratioVs = (idx: number, windowSize: number): number | null => {
    const latest = bars[idx]?.volume;
    if (latest == null) return null;
    const window = bars
      .slice(idx + 1, idx + 1 + windowSize)
      .map((b) => b.volume)
      .filter((v): v is number => v != null);
    if (window.length < Math.max(10, Math.floor(windowSize / 2))) return null;
    const avg = window.reduce((a, b) => a + b, 0) / window.length;
    if (avg <= 0) return null;
    return latest / avg;
  };
  // Intraday filter: today's volume < 50% of trailing 50-day avg → drop.
  // Falls back to a 20-day check when there aren't enough bars for 50-day.
  const filter =
    bars.length >= 52 ? ratioVs(0, 50) : ratioVs(0, 20);
  if (filter != null && filter < 0.5) {
    const alt = ratioVs(1, 20);
    if (alt != null) return alt;
  }
  return ratioVs(0, 20);
}

// ---------- ADX (Welles Wilder, period 14) ----------

/** ADX with default period 14. Returns null if insufficient data. Operates on newest-first bars. */
export function adx(bars: PriceBar[], period = 14): number | null {
  if (bars.length < period * 2 + 1) return null;
  // Reverse to oldest-first for the classic recursive math
  const xs = [...bars].reverse();
  const n = xs.length;
  const tr: number[] = [0];
  const plusDM: number[] = [0];
  const minusDM: number[] = [0];
  for (let i = 1; i < n; i++) {
    const cur = xs[i];
    const prev = xs[i - 1];
    if (cur.high == null || cur.low == null || prev.close == null) {
      tr.push(0);
      plusDM.push(0);
      minusDM.push(0);
      continue;
    }
    tr.push(
      Math.max(
        cur.high - cur.low,
        Math.abs(cur.high - prev.close),
        Math.abs(cur.low - prev.close),
      ),
    );
    const upMove = prev.high != null ? cur.high - prev.high : 0;
    const downMove = prev.low != null ? prev.low - cur.low : 0;
    plusDM.push(upMove > 0 && upMove > downMove ? upMove : 0);
    minusDM.push(downMove > 0 && downMove > upMove ? downMove : 0);
  }

  // Wilder smoothing: first period uses sum, subsequent: prev - prev/period + curr
  const smooth = (vals: number[]): number[] => {
    const out: number[] = new Array<number>(vals.length).fill(0);
    let initSum = 0;
    for (let i = 1; i <= period; i++) initSum += vals[i] ?? 0;
    out[period] = initSum;
    for (let i = period + 1; i < vals.length; i++) {
      out[i] = out[i - 1] - out[i - 1] / period + vals[i];
    }
    return out;
  };

  const tr14 = smooth(tr);
  const pdm14 = smooth(plusDM);
  const mdm14 = smooth(minusDM);

  const dx: number[] = new Array<number>(n).fill(0);
  for (let i = period; i < n; i++) {
    if (!tr14[i]) continue;
    const pdi = (100 * pdm14[i]) / tr14[i];
    const mdi = (100 * mdm14[i]) / tr14[i];
    const sum = pdi + mdi;
    dx[i] = sum === 0 ? 0 : (100 * Math.abs(pdi - mdi)) / sum;
  }

  // ADX = Wilder smoothing of DX, starting at index 2*period
  const adxArr: number[] = new Array<number>(n).fill(0);
  let dxSum = 0;
  for (let i = period; i < period * 2; i++) dxSum += dx[i] ?? 0;
  adxArr[period * 2 - 1] = dxSum / period;
  for (let i = period * 2; i < n; i++) {
    adxArr[i] = (adxArr[i - 1] * (period - 1) + (dx[i] ?? 0)) / period;
  }
  const last = adxArr[n - 1];
  return Number.isFinite(last) ? last : null;
}

// ---------- OBV + divergence ----------

/** OBV array, oldest-first to match indicator convention. */
function obvSeries(bars: PriceBar[]): number[] {
  const xs = [...bars].reverse(); // oldest-first
  const out: number[] = new Array(xs.length).fill(0);
  for (let i = 1; i < xs.length; i++) {
    const dv = xs[i].volume ?? 0;
    const dc = xs[i].close - xs[i - 1].close;
    out[i] = out[i - 1] + (dc > 0 ? dv : dc < 0 ? -dv : 0);
  }
  return out;
}

/** Bearish OBV divergence over the last `lookback` trading days:
 *  price made a higher high but OBV did not, OR price up >5% with OBV down. */
export function obvBearishDivergence(bars: PriceBar[], lookback = 30): boolean | null {
  if (bars.length < lookback + 1) return null;
  const recent = bars.slice(0, lookback); // newest-first
  // Price segment newest-first
  const priceNow = recent[0].close;
  const priceThen = recent[lookback - 1].close;
  if (!priceThen || priceThen <= 0) return null;
  const priceChange = priceNow / priceThen - 1;

  const obv = obvSeries(bars);                       // oldest-first
  const obvSlice = obv.slice(obv.length - lookback); // oldest-first slice
  const obvNow = obvSlice[obvSlice.length - 1];
  const obvThen = obvSlice[0];
  // We need both 'now' values to be a recent extreme to call it divergence.
  // Simplified: bearish if price up >5% but OBV finished lower than period start.
  if (priceChange > 0.05 && obvNow < obvThen) return true;
  // Or: price made new high in window but OBV didn't.
  const maxPriceIdx = recent.reduce(
    (best, b, i) => (b.close > recent[best].close ? i : best),
    0,
  );
  const maxObvIdx = obvSlice.reduce(
    (best, v, i) => (v > obvSlice[best] ? i : best),
    0,
  );
  // recent is newest-first (index 0 = today). max at idx 0 means price's high IS today.
  if (maxPriceIdx === 0 && maxObvIdx < obvSlice.length - 1) return true;
  return false;
}

// ---------- RS (excess vs benchmark, 0–100 mapped) ----------

/** Excess 3-month return vs benchmark, mapped to 0–100, with an absolute-
 *  momentum floor: a stock up materially over a year shouldn't read RS≈0
 *  just because its sub-industry ETF ran even harder (TSM vs SOXX). */
// Piecewise-linear RS from 1-year absolute return, used for Korean tickers
// (the KOSPI/KOSDAQ sector ETF coverage is too thin for a meaningful
// relative-strength comparison, so absolute momentum is the better signal).
//   +100%↑ = 95   +50% = 80   +30% = 65
//    +10% = 45     0% = 25   -20%↓ = 10
const ABS_RS_ANCHORS: ReadonlyArray<readonly [number, number]> = [
  [-0.20, 10],
  [0.0, 25],
  [0.1, 45],
  [0.3, 65],
  [0.5, 80],
  [1.0, 95],
];
function rsFromAbsoluteReturn1Y(r: number): number {
  if (r <= ABS_RS_ANCHORS[0][0]) return ABS_RS_ANCHORS[0][1];
  const last = ABS_RS_ANCHORS[ABS_RS_ANCHORS.length - 1];
  if (r >= last[0]) return last[1];
  for (let i = 0; i < ABS_RS_ANCHORS.length - 1; i++) {
    const [x1, y1] = ABS_RS_ANCHORS[i];
    const [x2, y2] = ABS_RS_ANCHORS[i + 1];
    if (r >= x1 && r <= x2) {
      return y1 + ((r - x1) / (x2 - x1)) * (y2 - y1);
    }
  }
  return 50;
}

export function relativeStrength(
  stockBars: PriceBar[],
  benchmarkBars: PriceBar[],
  opts?: { absoluteMode?: boolean },
): { rs: number; stockReturn3M: number | null; benchmarkReturn3M: number | null; excess: number | null } {
  const stockReturn3M = return90d(stockBars);
  const benchmarkReturn3M = return90d(benchmarkBars);
  const stockReturn1Y = return1y(stockBars);

  // Absolute mode (Korean tickers): RS = piecewise function of 1Y abs return.
  // Excess vs benchmark is still computed when available (used for sector-lag
  // deduction in EntryScore), but does not drive the RS number.
  if (opts?.absoluteMode) {
    const excess =
      stockReturn3M != null && benchmarkReturn3M != null
        ? stockReturn3M - benchmarkReturn3M
        : null;
    if (stockReturn1Y == null) {
      return { rs: 25, stockReturn3M, benchmarkReturn3M, excess };
    }
    return {
      rs: rsFromAbsoluteReturn1Y(stockReturn1Y),
      stockReturn3M,
      benchmarkReturn3M,
      excess,
    };
  }

  if (stockReturn3M == null || benchmarkReturn3M == null) {
    return { rs: 50, stockReturn3M, benchmarkReturn3M, excess: null };
  }
  const excess = stockReturn3M - benchmarkReturn3M;
  // Map [-0.30, +0.30] excess → [0, 100], clamped.
  let rs = 50 + (excess / 0.30) * 50;
  if (rs < 0) rs = 0;
  if (rs > 100) rs = 100;

  // Absolute-momentum floor: strong 1-year absolute return overrides a
  // misleading low RS from a hot sub-sector comparison.
  if (stockReturn1Y != null) {
    if (stockReturn1Y > 1.0) rs = Math.max(rs, 50);
    else if (stockReturn1Y > 0.5) rs = Math.max(rs, 30);
  }

  return { rs, stockReturn3M, benchmarkReturn3M, excess };
}

// Sanity warning helper for stage 4 KOSPI bug check
/** Validate benchmark looks sane; if 1y return > 100%, return null (likely bad data). */
export function sanitizedReturn1y(bars: PriceBar[]): number | null {
  const r = return1y(bars);
  if (r != null && Math.abs(r) > 1.0) return null;
  return r;
}

// ---------- ATR (Welles Wilder, period 14) ----------

/** Average True Range, period 14. Newest-first bars. */
export function atr(bars: PriceBar[], period = 14): number | null {
  if (bars.length < period + 1) return null;
  const xs = [...bars].reverse(); // oldest-first
  const tr: number[] = [];
  for (let i = 1; i < xs.length; i++) {
    const cur = xs[i];
    const prev = xs[i - 1];
    if (cur.high == null || cur.low == null || prev.close == null) {
      tr.push(0);
      continue;
    }
    tr.push(
      Math.max(
        cur.high - cur.low,
        Math.abs(cur.high - prev.close),
        Math.abs(cur.low - prev.close),
      ),
    );
  }
  // Wilder smoothing
  let smoothed = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < tr.length; i++) {
    smoothed = (smoothed * (period - 1) + tr[i]) / period;
  }
  return Number.isFinite(smoothed) ? smoothed : null;
}

// ---------- EMA / SMA helpers ----------

/** Wilder's RSI over the most recent `period` bars. Newest-first input. */
export function rsi(bars: PriceBar[], period = 14): number | null {
  if (bars.length < period + 1) return null;
  const xs = [...bars].reverse(); // oldest-first
  // Seed with simple average of first `period` gains/losses
  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = xs[i].close - xs[i - 1].close;
    if (diff >= 0) gainSum += diff;
    else lossSum += -diff;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  // Wilder smoothing for the rest of the series
  for (let i = period + 1; i < xs.length; i++) {
    const diff = xs[i].close - xs[i - 1].close;
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  const value = 100 - 100 / (1 + rs);
  return Number.isFinite(value) ? value : null;
}

/** Exponential moving average over the most recent `period` bars. Newest-first. */
export function ema(bars: PriceBar[], period: number): number | null {
  if (bars.length < period) return null;
  // EMA computed oldest-first
  const xs = [...bars].reverse();
  const k = 2 / (period + 1);
  let value = xs.slice(0, period).reduce((a, b) => a + b.close, 0) / period;
  for (let i = period; i < xs.length; i++) {
    value = xs[i].close * k + value * (1 - k);
  }
  return Number.isFinite(value) ? value : null;
}

/** Simple moving average over the most recent `period` bars. Newest-first. */
export function sma(bars: PriceBar[], period: number): number | null {
  if (bars.length < period) return null;
  return bars.slice(0, period).reduce((a, b) => a + b.close, 0) / period;
}

// ---------- Fibonacci retracement ----------

export interface FibLevels {
  high: number;
  low: number;
  /** 38.2 / 50 / 61.8 retracements between high and low. */
  level382: number;
  level500: number;
  level618: number;
}

/** Compute Fibonacci retracement levels from the last `window` bars
 *  (default 252 ≈ 12 months). Newest-first input. */
export function fibonacciLevels(bars: PriceBar[], window = 252): FibLevels | null {
  if (bars.length < 20) return null;
  const slice = bars.slice(0, Math.min(window, bars.length));
  let high = -Infinity;
  let low = Infinity;
  for (const b of slice) {
    const h = b.high ?? b.close;
    const l = b.low ?? b.close;
    if (h > high) high = h;
    if (l < low) low = l;
  }
  if (!Number.isFinite(high) || !Number.isFinite(low) || high <= low) return null;
  const range = high - low;
  return {
    high,
    low,
    level382: high - range * 0.382,
    level500: high - range * 0.5,
    level618: high - range * 0.618,
  };
}

export type FibProximity =
  | { kind: 'near'; level: '38.2' | '50' | '61.8'; distancePct: number }
  | { kind: 'broke_618' }
  | { kind: 'none' };

/** Reports if the latest close is within ±tolerancePct of any Fib level
 *  or has fallen below the 61.8% level (key support break). */
export function fibProximity(
  bars: PriceBar[],
  levels: FibLevels,
  tolerancePct = 0.03,
): FibProximity {
  const px = bars[0]?.close;
  if (px == null || !Number.isFinite(px)) return { kind: 'none' };
  if (px < levels.level618) return { kind: 'broke_618' };
  const entries: { label: '38.2' | '50' | '61.8'; price: number }[] = [
    { label: '38.2', price: levels.level382 },
    { label: '50', price: levels.level500 },
    { label: '61.8', price: levels.level618 },
  ];
  for (const e of entries) {
    const dist = Math.abs(px - e.price) / e.price;
    if (dist <= tolerancePct) {
      return { kind: 'near', level: e.label, distancePct: dist * 100 };
    }
  }
  return { kind: 'none' };
}

// ---------- MACD ----------

export interface MacdSeries {
  /** Oldest-first; length === bars.length, leading nulls until enough data. */
  macd: (number | null)[];
  signal: (number | null)[];
  histogram: (number | null)[];
}

/** MACD(fast, slow, signal). Returns full oldest-first arrays so callers
 *  can inspect crosses and histogram trends. Null if too few bars. */
export function macd(
  bars: PriceBar[],
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): MacdSeries | null {
  if (bars.length < slow + signalPeriod) return null;
  const closes = [...bars].reverse().map((b) => b.close);
  const n = closes.length;
  const emaSeries = (period: number): (number | null)[] => {
    const out: (number | null)[] = new Array<number | null>(n).fill(null);
    if (n < period) return out;
    const k = 2 / (period + 1);
    let prev = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
    out[period - 1] = prev;
    for (let i = period; i < n; i++) {
      prev = closes[i] * k + prev * (1 - k);
      out[i] = prev;
    }
    return out;
  };
  const emaFast = emaSeries(fast);
  const emaSlow = emaSeries(slow);
  const macdLine: (number | null)[] = emaFast.map((v, i) =>
    v != null && emaSlow[i] != null ? v - (emaSlow[i] as number) : null,
  );

  const signalLine: (number | null)[] = new Array<number | null>(n).fill(null);
  let firstNonNull = -1;
  for (let i = 0; i < n; i++) {
    if (macdLine[i] != null) {
      firstNonNull = i;
      break;
    }
  }
  if (firstNonNull < 0 || firstNonNull + signalPeriod > n) return null;
  let seedSum = 0;
  for (let i = firstNonNull; i < firstNonNull + signalPeriod; i++) {
    seedSum += macdLine[i] as number;
  }
  const seedIdx = firstNonNull + signalPeriod - 1;
  let prevSignal = seedSum / signalPeriod;
  signalLine[seedIdx] = prevSignal;
  const k = 2 / (signalPeriod + 1);
  for (let i = seedIdx + 1; i < n; i++) {
    const m = macdLine[i];
    if (m == null) continue;
    prevSignal = m * k + prevSignal * (1 - k);
    signalLine[i] = prevSignal;
  }
  const histogram: (number | null)[] = macdLine.map((m, i) =>
    m != null && signalLine[i] != null ? m - (signalLine[i] as number) : null,
  );
  return { macd: macdLine, signal: signalLine, histogram };
}

export type MacdCross = 'golden' | 'dead' | 'none';

/** Detect a MACD/signal cross on the most recent bar (today vs. yesterday). */
export function macdCross(series: MacdSeries): MacdCross {
  const m = series.macd;
  const s = series.signal;
  const n = m.length;
  if (n < 2) return 'none';
  const m1 = m[n - 1];
  const m0 = m[n - 2];
  const s1 = s[n - 1];
  const s0 = s[n - 2];
  if (m0 == null || m1 == null || s0 == null || s1 == null) return 'none';
  if (m0 <= s0 && m1 > s1) return 'golden';
  if (m0 >= s0 && m1 < s1) return 'dead';
  return 'none';
}

/** '3up' if the last 3 histogram values are strictly increasing, '3down'
 *  if strictly decreasing, otherwise null. */
export function macdHistTrend(series: MacdSeries): '3up' | '3down' | null {
  const h = series.histogram;
  const n = h.length;
  if (n < 3) return null;
  const a = h[n - 3];
  const b = h[n - 2];
  const c = h[n - 1];
  if (a == null || b == null || c == null) return null;
  if (c > b && b > a) return '3up';
  if (c < b && b < a) return '3down';
  return null;
}

// ---------- Bollinger Bands ----------

export interface BollingerSeries {
  middle: (number | null)[];
  upper: (number | null)[];
  lower: (number | null)[];
  /** (upper - lower) / middle, used for squeeze detection. */
  bandwidth: (number | null)[];
}

/** Bollinger Bands (default 20-period SMA, 2σ). Oldest-first arrays.
 *  Returns null if too few bars. */
export function bollingerBands(
  bars: PriceBar[],
  period = 20,
  k = 2,
): BollingerSeries | null {
  const n = bars.length;
  if (n < period) return null;
  const closes = [...bars].reverse().map((b) => b.close);
  const middle: (number | null)[] = new Array(n).fill(null);
  const upper: (number | null)[] = new Array(n).fill(null);
  const lower: (number | null)[] = new Array(n).fill(null);
  const bandwidth: (number | null)[] = new Array(n).fill(null);
  for (let i = period - 1; i < n; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += closes[j];
    const mean = sum / period;
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) {
      variance += (closes[j] - mean) ** 2;
    }
    const sd = Math.sqrt(variance / period);
    middle[i] = mean;
    upper[i] = mean + k * sd;
    lower[i] = mean - k * sd;
    bandwidth[i] = mean !== 0 ? (2 * k * sd) / mean : null;
  }
  return { middle, upper, lower, bandwidth };
}

/** True when today's bandwidth is the lowest over the last `window` bars. */
export function bollingerSqueeze(series: BollingerSeries, window = 20): boolean {
  const bw = series.bandwidth;
  const n = bw.length;
  if (n < window) return false;
  const today = bw[n - 1];
  if (today == null) return false;
  let min = today;
  for (let i = n - window; i < n; i++) {
    const v = bw[i];
    if (v != null && v < min) min = v;
  }
  return today <= min + 1e-9;
}

export type BollingerBreakout = 'upper' | 'lower' | 'none';

/** Detect today's close touching/breaching a band. */
export function bollingerBreakout(
  bars: PriceBar[],
  series: BollingerSeries,
): BollingerBreakout {
  const n = bars.length;
  if (n === 0) return 'none';
  const px = bars[0].close;
  const upper = series.upper[series.upper.length - 1];
  const lower = series.lower[series.lower.length - 1];
  if (upper != null && px >= upper) return 'upper';
  if (lower != null && px <= lower) return 'lower';
  return 'none';
}

// ---------- RSI Divergence ----------

export type RsiDivergence = 'bearish' | 'bullish' | 'none';

/** Detect RSI divergence over `lookback` bars (default 30).
 *  Bearish: price makes higher high but RSI makes lower high.
 *  Bullish: price makes lower low but RSI makes higher low. */
export function rsiDivergence(bars: PriceBar[], lookback = 30): RsiDivergence {
  if (bars.length < lookback + 14) return 'none';
  const xs = [...bars].reverse();
  const n = xs.length;
  const rsiSeries: number[] = [];
  {
    let avgGain = 0;
    let avgLoss = 0;
    for (let i = 1; i <= 14; i++) {
      const diff = xs[i].close - xs[i - 1].close;
      if (diff >= 0) avgGain += diff;
      else avgLoss += -diff;
    }
    avgGain /= 14;
    avgLoss /= 14;
    rsiSeries.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
    for (let i = 15; i < n; i++) {
      const diff = xs[i].close - xs[i - 1].close;
      avgGain = (avgGain * 13 + (diff > 0 ? diff : 0)) / 14;
      avgLoss = (avgLoss * 13 + (diff < 0 ? -diff : 0)) / 14;
      rsiSeries.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
    }
  }

  const recentLen = Math.min(lookback, rsiSeries.length);
  const rsiRecent = rsiSeries.slice(-recentLen);
  const priceRecent = xs.slice(-recentLen);

  const half = Math.floor(recentLen / 2);
  const firstHalfPrice = priceRecent.slice(0, half);
  const secondHalfPrice = priceRecent.slice(half);
  const firstHalfRsi = rsiRecent.slice(0, half);
  const secondHalfRsi = rsiRecent.slice(half);

  const maxPrice1 = Math.max(...firstHalfPrice.map((b) => b.high ?? b.close));
  const maxPrice2 = Math.max(...secondHalfPrice.map((b) => b.high ?? b.close));
  const maxRsi1 = Math.max(...firstHalfRsi);
  const maxRsi2 = Math.max(...secondHalfRsi);

  if (maxPrice2 > maxPrice1 && maxRsi2 < maxRsi1 - 3) return 'bearish';

  const minPrice1 = Math.min(...firstHalfPrice.map((b) => b.low ?? b.close));
  const minPrice2 = Math.min(...secondHalfPrice.map((b) => b.low ?? b.close));
  const minRsi1 = Math.min(...firstHalfRsi);
  const minRsi2 = Math.min(...secondHalfRsi);

  if (minPrice2 < minPrice1 && minRsi2 > minRsi1 + 3) return 'bullish';

  return 'none';
}

// ---------- EMA20 Slope ----------

export interface Ema20Slope {
  slope: number;
  signal: 'strong_up' | 'up' | 'flat' | 'down' | 'strong_down';
}

/** EMA20 slope: rate of change over the last 5 bars as a percentage of price.
 *  strong_up: >0.3%/day, up: >0.1%, flat: ±0.1%, down: <-0.1%, strong_down: <-0.3% */
export function ema20Slope(bars: PriceBar[]): Ema20Slope | null {
  if (bars.length < 25) return null;
  const xs = [...bars].reverse();
  const k = 2 / 21;
  let value = xs.slice(0, 20).reduce((a, b) => a + b.close, 0) / 20;
  const emaVals: number[] = [value];
  for (let i = 20; i < xs.length; i++) {
    value = xs[i].close * k + value * (1 - k);
    emaVals.push(value);
  }
  const len = emaVals.length;
  if (len < 6) return null;
  const now = emaVals[len - 1];
  const then = emaVals[len - 6];
  const avgPrice = now;
  if (avgPrice <= 0) return null;
  const slope = ((now - then) / then) * 100 / 5;
  let signal: Ema20Slope['signal'];
  if (slope > 0.3) signal = 'strong_up';
  else if (slope > 0.1) signal = 'up';
  else if (slope > -0.1) signal = 'flat';
  else if (slope > -0.3) signal = 'down';
  else signal = 'strong_down';
  return { slope, signal };
}

// ---------- Volume Pattern (up-day vs down-day) ----------

export interface VolumePattern {
  upDayVolume: number;
  downDayVolume: number;
  ratio: number;
  signal: 'accumulation' | 'distribution' | 'neutral';
}

/** Compare average volume on up-days vs down-days over the last `window` bars.
 *  ratio > 1.2 = accumulation (healthy buying), < 0.8 = distribution (selling). */
export function volumePattern(bars: PriceBar[], window = 20): VolumePattern | null {
  if (bars.length < window + 1) return null;
  const slice = bars.slice(0, window);
  let upVol = 0;
  let upCount = 0;
  let downVol = 0;
  let downCount = 0;
  for (let i = 0; i < slice.length; i++) {
    const prev = bars[i + 1];
    if (!prev || slice[i].volume == null) continue;
    if (slice[i].close > prev.close) {
      upVol += slice[i].volume!;
      upCount++;
    } else if (slice[i].close < prev.close) {
      downVol += slice[i].volume!;
      downCount++;
    }
  }
  if (upCount === 0 || downCount === 0) return null;
  const avgUp = upVol / upCount;
  const avgDown = downVol / downCount;
  if (avgDown <= 0) return null;
  const ratio = avgUp / avgDown;
  let signal: VolumePattern['signal'];
  if (ratio > 1.2) signal = 'accumulation';
  else if (ratio < 0.8) signal = 'distribution';
  else signal = 'neutral';
  return { upDayVolume: avgUp, downDayVolume: avgDown, ratio, signal };
}

// ---------- ATR Trend (expanding / contracting) ----------

export interface AtrTrend {
  current: number;
  previous: number;
  changeRatio: number;
  signal: 'expanding' | 'contracting' | 'stable';
}

/** Compare current ATR(14) to ATR(14) from 10 bars ago.
 *  Expanding = volatility increasing (big move coming or underway).
 *  Contracting = energy compression (Bollinger squeeze analog). */
export function atrTrend(bars: PriceBar[]): AtrTrend | null {
  if (bars.length < 40) return null;
  const currentAtr = atr(bars);
  const prevBars = bars.slice(10);
  const prevAtr = atr(prevBars);
  if (currentAtr == null || prevAtr == null || prevAtr <= 0) return null;
  const changeRatio = currentAtr / prevAtr;
  let signal: AtrTrend['signal'];
  if (changeRatio > 1.2) signal = 'expanding';
  else if (changeRatio < 0.8) signal = 'contracting';
  else signal = 'stable';
  return { current: currentAtr, previous: prevAtr, changeRatio, signal };
}

// ---------- Support/Resistance Cluster ----------

export interface SupportResistanceCluster {
  price: number;
  sources: string[];
  distancePct: number;
  type: 'support' | 'resistance';
}

/** Find price levels where multiple indicators converge (MA + Fib).
 *  Returns up to 3 clusters sorted by proximity to current price. */
export function supportResistanceClusters(bars: PriceBar[]): SupportResistanceCluster[] {
  if (bars.length < 50) return [];
  const px = bars[0].close;
  if (!px || px <= 0) return [];

  const levels: { price: number; source: string }[] = [];

  const sma50Val = sma(bars, 50);
  if (sma50Val != null) levels.push({ price: sma50Val, source: 'SMA50' });

  if (bars.length >= 200) {
    const sma200Val = sma(bars, 200);
    if (sma200Val != null) levels.push({ price: sma200Val, source: 'SMA200' });
  }

  const ema20Val = ema(bars, 20);
  if (ema20Val != null) levels.push({ price: ema20Val, source: 'EMA20' });

  const fib = fibonacciLevels(bars);
  if (fib) {
    levels.push({ price: fib.level382, source: 'Fib38.2%' });
    levels.push({ price: fib.level500, source: 'Fib50%' });
    levels.push({ price: fib.level618, source: 'Fib61.8%' });
  }

  const tolerance = px * 0.03;
  const clusters: SupportResistanceCluster[] = [];
  const used = new Set<number>();

  for (let i = 0; i < levels.length; i++) {
    if (used.has(i)) continue;
    const group = [levels[i]];
    used.add(i);
    for (let j = i + 1; j < levels.length; j++) {
      if (used.has(j)) continue;
      if (Math.abs(levels[j].price - levels[i].price) <= tolerance) {
        group.push(levels[j]);
        used.add(j);
      }
    }
    if (group.length >= 2) {
      const avgPrice = group.reduce((a, g) => a + g.price, 0) / group.length;
      const distancePct = ((px - avgPrice) / px) * 100;
      clusters.push({
        price: avgPrice,
        sources: group.map((g) => g.source),
        distancePct: Math.abs(distancePct),
        type: avgPrice < px ? 'support' : 'resistance',
      });
    }
  }

  clusters.sort((a, b) => a.distancePct - b.distancePct);
  return clusters.slice(0, 3);
}
