// Sector Regime — detects sector rotation that the macro (bond) regime can't
// see, so a strong stock in a collapsing sector ("좋은 종목인데 섹터가 무너지는
// 중") gets flagged before entry.
//
// 11 SPDR sector ETFs + 4 thematic sub-sectors, each scored 0–100 vs SPY:
//   sectorScore = rs*0.45 + trend*0.30 + momentum*0.25
//     rs       — 3M excess return vs SPY → 0–100
//     trend    — close vs SMA50/SMA200 (정배열 100 / >SMA200 60 / <SMA200 20)
//     momentum — blended 1M·3M returns
//
// The pure compute lives here (shared/testable); the endpoint
// (api/sector-regime.ts) only fetches bars and calls computeSectorRegime —
// mirroring marketRegime.ts / market-regime.ts.

import type { FundamentalData, PriceBar } from './types.js';
import { adx as adxOf, relativeStrength, return30d, return90d, sma } from './indicators.js';

export type SectorStatus = 'leading' | 'neutral' | 'lagging';
export type SectorKind = 'sector' | 'theme';
export type SectorTrend = 'aligned' | 'above200' | 'below200' | 'unknown';

export interface SectorMeta {
  ticker: string;
  label: string;
  kind: SectorKind;
}

export interface SectorEntry extends SectorMeta {
  score: number;            // 0–100
  status: SectorStatus;
  rs: number;               // 0–100 (relative strength vs SPY)
  trendScore: number;
  trend: SectorTrend;
  momentumScore: number;
  return1M: number | null;  // fractional (0.08 = +8%)
  return3M: number | null;
  adx: number | null;
}

export interface SectorRegime {
  benchmark: string;        // 'SPY'
  asOf: string;
  sectors: SectorEntry[];   // sorted by score descending
  stale: boolean;
}

export const BENCHMARK = 'SPY';

// 11 SPDR sectors + 4 thematic sub-sectors (themes shown separately in UI).
export const TRACKED_SECTORS: readonly SectorMeta[] = [
  { ticker: 'XLK', label: '기술', kind: 'sector' },
  { ticker: 'XLF', label: '금융', kind: 'sector' },
  { ticker: 'XLE', label: '에너지', kind: 'sector' },
  { ticker: 'XLV', label: '헬스케어', kind: 'sector' },
  { ticker: 'XLI', label: '산업재', kind: 'sector' },
  { ticker: 'XLY', label: '임의소비재', kind: 'sector' },
  { ticker: 'XLP', label: '필수소비재', kind: 'sector' },
  { ticker: 'XLU', label: '유틸리티', kind: 'sector' },
  { ticker: 'XLB', label: '소재', kind: 'sector' },
  { ticker: 'XLRE', label: '부동산', kind: 'sector' },
  { ticker: 'XLC', label: '커뮤니케이션', kind: 'sector' },
  { ticker: 'SMH', label: '반도체', kind: 'theme' },
  { ticker: 'IGV', label: '소프트웨어', kind: 'theme' },
  { ticker: 'IBB', label: '바이오', kind: 'theme' },
  { ticker: 'XOP', label: '석유탐사', kind: 'theme' },
];

export const SECTOR_TICKERS: readonly string[] = TRACKED_SECTORS.map((s) => s.ticker);
const META_BY_TICKER = new Map(TRACKED_SECTORS.map((m) => [m.ticker, m]));

// ---- stock → tracked-ETF mapping (for the per-stock badge) ----

/** Collapse Yahoo's inconsistent dash forms so industry lookups hit. */
function normalizeIndustry(s: string): string {
  return s.replace(/\s*[—–-]\s*/g, '—').trim();
}

// Industry strings that map to a thematic sub-sector (more specific than the
// broad SPDR sector). Everything else falls back to the sector by name.
const THEME_BY_INDUSTRY: Record<string, string> = {
  Semiconductors: 'SMH',
  'Semiconductor Equipment & Materials': 'SMH',
  'Software—Application': 'IGV',
  'Software—Infrastructure': 'IGV',
  'Information Technology Services': 'IGV',
  Biotechnology: 'IBB',
  'Oil & Gas E&P': 'XOP',
};

const SECTOR_BY_NAME: Record<string, string> = {
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

/** Best tracked sector/theme ETF for a stock, or null (e.g. Korean tickers
 *  have no US-sector mapping). Prefers the thematic sub-sector when known. */
export function resolveSectorEtf(fund: Pick<FundamentalData, 'ticker' | 'sector' | 'industry'>): string | null {
  if (/\.(KS|KQ)$/i.test(fund.ticker)) return null;
  if (fund.industry) {
    const norm = normalizeIndustry(fund.industry);
    if (THEME_BY_INDUSTRY[norm]) return THEME_BY_INDUSTRY[norm];
    if (THEME_BY_INDUSTRY[fund.industry]) return THEME_BY_INDUSTRY[fund.industry];
    if (/REIT/i.test(fund.industry)) return 'XLRE';
  }
  if (fund.sector && SECTOR_BY_NAME[fund.sector]) return SECTOR_BY_NAME[fund.sector];
  return null;
}

/** Look up a stock's sector entry within a computed regime. */
export function findSectorForStock(
  regime: SectorRegime,
  fund: Pick<FundamentalData, 'ticker' | 'sector' | 'industry'>,
): SectorEntry | null {
  const etf = resolveSectorEtf(fund);
  if (!etf) return null;
  return regime.sectors.find((s) => s.ticker === etf) ?? null;
}

// ---- scoring ----

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function trendOf(bars: PriceBar[]): { score: number; trend: SectorTrend } {
  const px = bars[0]?.close;
  if (px == null) return { score: 50, trend: 'unknown' };
  const s50 = sma(bars, 50);
  const s200 = sma(bars, 200);
  if (s50 != null && s200 != null) {
    if (px > s50 && s50 > s200) return { score: 100, trend: 'aligned' };
    if (px > s200) return { score: 60, trend: 'above200' };
    return { score: 20, trend: 'below200' };
  }
  // <200 bars: degrade to an SMA50-only read rather than blocking.
  if (s50 != null) return px > s50 ? { score: 60, trend: 'above200' } : { score: 20, trend: 'below200' };
  return { score: 50, trend: 'unknown' };
}

function momentumOf(bars: PriceBar[]): { score: number; r1m: number | null; r3m: number | null } {
  const r1 = return30d(bars);
  const r3 = return90d(bars);
  // +10% over 1M → ~100, -10% → ~0; 3M scaled half as steep (+20% → ~100).
  const m1 = r1 == null ? 50 : clamp(50 + r1 * 500, 0, 100);
  const m3 = r3 == null ? 50 : clamp(50 + r3 * 250, 0, 100);
  return { score: m1 * 0.4 + m3 * 0.6, r1m: r1, r3m: r3 };
}

function statusOf(score: number): SectorStatus {
  if (score >= 70) return 'leading';
  if (score >= 45) return 'neutral';
  return 'lagging';
}

function scoreOne(meta: SectorMeta, bars: PriceBar[], spyBars: PriceBar[]): SectorEntry {
  const rs = relativeStrength(bars, spyBars).rs;
  const trend = trendOf(bars);
  const mom = momentumOf(bars);
  const score = Math.round(
    clamp(rs * 0.45 + trend.score * 0.3 + mom.score * 0.25, 0, 100),
  );
  return {
    ...meta,
    score,
    status: statusOf(score),
    rs: Math.round(rs),
    trendScore: trend.score,
    trend: trend.trend,
    momentumScore: Math.round(mom.score),
    return1M: mom.r1m,
    return3M: mom.r3m,
    adx: adxOf(bars),
  };
}

/** Build the sector regime from SPY + per-ETF newest-first bars. ETFs with no
 *  usable bars are skipped (and mark the regime stale). */
export function computeSectorRegime(
  spyBars: PriceBar[],
  etfBars: Record<string, PriceBar[]>,
  asOf: string,
): SectorRegime {
  const sectors: SectorEntry[] = [];
  let stale = spyBars.length < 64; // need ~3M of SPY for the RS comparison

  for (const meta of TRACKED_SECTORS) {
    const bars = etfBars[meta.ticker];
    if (!bars || bars.length < 64) {
      stale = true;
      if (!bars || bars.length === 0) continue;
    }
    sectors.push(scoreOne(meta, bars, spyBars));
  }

  sectors.sort((a, b) => b.score - a.score);
  return { benchmark: BENCHMARK, asOf, sectors, stale };
}

/** Look up display metadata for a tracked ticker. */
export function sectorMeta(ticker: string): SectorMeta | undefined {
  return META_BY_TICKER.get(ticker);
}
