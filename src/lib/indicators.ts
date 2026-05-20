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
