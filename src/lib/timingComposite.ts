// Stage-1: parallel "Trend Composite" timing scorer.
//
// Goal: compute a new 5-component timing score *alongside* the existing
// `computeTiming` so we can compare them in logs before deciding whether
// to switch. This module never feeds into the UI score, the screener, or
// entry-grade gating.
//
// Composite = entryLocation*0.35 + trendQuality*0.25
//           + volumeConfirmation*0.15 + overheatControl*0.15
//           + marketSupport*0.10
// Each component is normalized to 0–100.

import type { PriceBar, StockType, TimingScoreResult } from './types.js';
import {
  adx as adxOf,
  atrTrend as atrTrendOf,
  ema,
  ema20Slope as ema20SlopeOf,
  relativeStrength,
  return30d,
  rsi as rsiOf,
  sma,
  supportResistanceClusters,
  volumePattern as volumePatternOf,
  volumeRatio,
} from './indicators.js';

export interface TimingCompositeInputs {
  stockBars: PriceBar[];
  benchmarkBars: PriceBar[];
  absoluteMode?: boolean;
  primaryType?: StockType | null;
  /** True when the fundamental score's 이익피크 penalty fires — drives the
   *  overheatControl deduction. Defaults to false when unknown. */
  peakEarningsPenalty?: boolean;
}

export interface TimingCompositeBreakdown {
  composite: number;
  entryLocation: number;
  trendQuality: number;
  volumeConfirmation: number;
  overheatControl: number;
  marketSupport: number;
}

function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, v));
}

/** Linear interpolation from y0 at x0 to y1 at x1, evaluated at x.
 *  Caller is responsible for ensuring x lies within [x0, x1] (no clamping). */
function lerp(x: number, x0: number, y0: number, x1: number, y1: number): number {
  if (x1 === x0) return y0;
  return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
}

// ---------- entryLocation (0–100) ----------
// Smooth interpolation — no cliff edges. Optimal pullback (-2~+3%) holds 100,
// then degrades linearly outward in both directions.
function ema20PullbackScore(emaDist: number | null): number {
  if (emaDist == null) return 50;
  const pct = emaDist * 100;
  if (pct >= -2 && pct <= 3) return 100;
  if (pct > 3 && pct <= 10) return lerp(pct, 3, 100, 10, 30);
  if (pct > 10 && pct <= 15) return lerp(pct, 10, 30, 15, 0);
  if (pct > 15) return 0;
  if (pct < -2 && pct >= -5) return lerp(pct, -2, 100, -5, 50);
  if (pct < -5 && pct >= -10) return lerp(pct, -5, 50, -10, 0);
  return 0;
}

// Within 3% = full credit. 3~8% = linear 100→40. Beyond 8% or no nearby
// cluster at all = 50 (neutral — "no signal" is not a penalty).
function supportClusterScore(nearestSupportDistPct: number | null): number {
  if (nearestSupportDistPct == null) return 50;
  if (nearestSupportDistPct <= 3) return 100;
  if (nearestSupportDistPct <= 8) return lerp(nearestSupportDistPct, 3, 100, 8, 40);
  return 50;
}

// Center at 55–60 (100), degrade smoothly outward. Beyond the spec'd
// brackets we continue linearly so RSI 30/80 don't crater off a cliff.
function rsiGoldilocksScore(rsi: number | null): number {
  if (rsi == null) return 50;
  if (rsi >= 55 && rsi <= 60) return 100;
  if (rsi > 60 && rsi <= 65) return lerp(rsi, 60, 100, 65, 80);
  if (rsi > 65 && rsi <= 70) return lerp(rsi, 65, 80, 70, 50);
  if (rsi > 70 && rsi <= 75) return lerp(rsi, 70, 50, 75, 20);
  if (rsi > 75 && rsi <= 80) return lerp(rsi, 75, 20, 80, 10);
  if (rsi > 80) return 10;
  if (rsi >= 50 && rsi < 55) return lerp(rsi, 50, 90, 55, 100);
  if (rsi >= 45 && rsi < 50) return lerp(rsi, 45, 60, 50, 90);
  if (rsi >= 40 && rsi < 45) return lerp(rsi, 40, 30, 45, 60);
  if (rsi >= 30 && rsi < 40) return lerp(rsi, 30, 10, 40, 30);
  return 10;
}

function candleRecoveryScore(stockBars: PriceBar[]): number {
  if (stockBars.length < 5) return 50;
  const colors = stockBars.slice(0, 5).map((b): 'g' | 'r' | '·' => {
    if (b.open == null) return '·';
    if (b.close > b.open) return 'g';
    if (b.close < b.open) return 'r';
    return '·';
  });
  const greens = colors.filter((c) => c === 'g').length;
  const reds = colors.filter((c) => c === 'r').length;
  const todayGreen = colors[0] === 'g';
  if (todayGreen && colors[1] === 'r' && colors[2] === 'r') return 100; // pullback recovery
  if (greens >= 4) return 30; // 5일 과열
  if (reds >= 4) return 15;   // 5일 약세
  if (todayGreen) return 65;
  if (colors[0] === 'r') return 35;
  return 50;
}

function entryLocationScore(args: {
  emaDist: number | null;
  nearestSupportDistPct: number | null;
  rsi: number | null;
  stockBars: PriceBar[];
}): number {
  const a = ema20PullbackScore(args.emaDist) * 0.45;
  const b = supportClusterScore(args.nearestSupportDistPct) * 0.20;
  const c = rsiGoldilocksScore(args.rsi) * 0.20;
  const d = candleRecoveryScore(args.stockBars) * 0.15;
  return clamp(a + b + c + d, 0, 100);
}

// ---------- trendQuality (0–100) ----------
function adxScore(adx: number | null): number {
  if (adx == null) return 30;
  return clamp(((adx - 15) / 20) * 100, 0, 100);
}

function maAlignmentScore(args: {
  px: number;
  ema20: number | null;
  sma50: number | null;
  sma200: number | null;
}): number {
  const { px, ema20, sma50, sma200 } = args;
  if (ema20 != null && sma50 != null && sma200 != null) {
    if (ema20 > sma50 && sma50 > sma200 && px > ema20) return 100;
    if (ema20 > sma50 && sma50 > sma200) return 85;
    if (px > sma200 && px > sma50) return 70;
    if (px > sma200) return 60;
    if (px > sma50) return 45;
    return 20;
  }
  // SMA200 unavailable — best-effort with what we have.
  if (sma50 != null && px > sma50) return 55;
  return 35;
}

function rsScore(rs: number | null): number {
  if (rs == null) return 50;
  // 50 → 50, 70 → 75, 90+ → 100. Linear between anchors.
  if (rs >= 90) return 100;
  if (rs >= 70) return 75 + ((rs - 70) / 20) * 25;
  if (rs >= 50) return 50 + ((rs - 50) / 20) * 25;
  if (rs >= 30) return 25 + ((rs - 30) / 20) * 25;
  return clamp((rs / 30) * 25, 0, 25);
}

function slopeScore(slope: number | null): number {
  if (slope == null) return 40;
  return clamp(((slope + 0.1) / 0.6) * 100, 0, 100);
}

function trendQualityScore(args: {
  adx: number | null;
  px: number;
  ema20: number | null;
  sma50: number | null;
  sma200: number | null;
  rs: number | null;
  slope: number | null;
}): number {
  const a = adxScore(args.adx) * 0.30;
  const b = maAlignmentScore(args) * 0.30;
  const c = rsScore(args.rs) * 0.25;
  const d = slopeScore(args.slope) * 0.15;
  return clamp(a + b + c + d, 0, 100);
}

// ---------- volumeConfirmation (0–100) ----------
function upDownVolRatioScore(ratio: number | null): number {
  if (ratio == null) return 50;
  if (ratio >= 1.2) return 100;
  if (ratio >= 1.0) return 75;
  if (ratio >= 0.8) return 45;
  if (ratio >= 0.6) return 20;
  return 5;
}

function breakoutVolumeScore(vr: number | null): number {
  if (vr == null) return 50;
  if (vr >= 1.5) return 100;
  if (vr >= 1.2) return 80;
  if (vr >= 1.0) return 60;
  if (vr >= 0.8) return 35;
  if (vr >= 0.6) return 15;
  return 0;
}

function volumeConfirmationScore(args: {
  upDownRatio: number | null;
  vr: number | null;
}): number {
  return clamp(
    upDownVolRatioScore(args.upDownRatio) * 0.6 +
      breakoutVolumeScore(args.vr) * 0.4,
    0,
    100,
  );
}

// ---------- overheatControl (start 100, deduct; higher = safer) ----------
function overheatControlScore(args: {
  emaDist: number | null;
  return30d: number | null;
  rsi: number | null;
  atrRatio: number | null;
  peakEarnings: boolean;
}): number {
  let s = 100;
  const { emaDist, return30d: r30, rsi, atrRatio, peakEarnings } = args;
  if (emaDist != null) {
    if (emaDist > 0.20) s -= 75;
    else if (emaDist > 0.15) s -= 55;
    else if (emaDist > 0.10) s -= 35;
  }
  if (r30 != null) {
    if (r30 > 0.50) s -= 60;
    else if (r30 > 0.30) s -= 40;
    else if (r30 > 0.20) s -= 25;
  }
  if (rsi != null) {
    if (rsi >= 80) s -= 50;
    else if (rsi >= 70) s -= 30;
  }
  if (atrRatio != null && atrRatio >= 1.3) s -= 15;
  if (peakEarnings) s -= 20;
  return clamp(s, 0, 100);
}

// ---------- marketSupport (0–100) ----------
function marketSupportScore(benchmarkBars: PriceBar[]): number {
  if (!benchmarkBars || benchmarkBars.length < 50) return 50;
  const px = benchmarkBars[0]?.close;
  if (px == null) return 50;
  const sma50 = sma(benchmarkBars, 50);
  const sma200 =
    benchmarkBars.length >= 200 ? sma(benchmarkBars, 200) : null;
  if (sma200 != null && sma50 != null) {
    if (px > sma50 && sma50 > sma200) return 100;
    if (px > sma200) return 60;
    return 20;
  }
  if (sma50 != null && px > sma50) return 70;
  return 40;
}

// ---------- Composite ----------
export function computeTimingComposite(
  inputs: TimingCompositeInputs,
): TimingCompositeBreakdown {
  const { stockBars, benchmarkBars, absoluteMode, peakEarningsPenalty } = inputs;
  const px = stockBars[0]?.close ?? 0;

  const ema20 = ema(stockBars, 20);
  const sma50 = stockBars.length >= 50 ? sma(stockBars, 50) : null;
  const sma200 = stockBars.length >= 200 ? sma(stockBars, 200) : null;
  const emaDist =
    ema20 != null && ema20 > 0 && px > 0 ? (px - ema20) / ema20 : null;

  const adxVal = adxOf(stockBars);
  const rsiVal = rsiOf(stockBars, 14);
  const vr = volumeRatio(stockBars);
  const r30 = return30d(stockBars);
  const slopeRes = ema20SlopeOf(stockBars);
  const slope = slopeRes?.slope ?? null;
  const volPat = volumePatternOf(stockBars);
  const upDownRatio = volPat?.ratio ?? null;
  const atrT = atrTrendOf(stockBars);
  const atrRatio = atrT?.changeRatio ?? null;
  const { rs } = relativeStrength(stockBars, benchmarkBars, { absoluteMode });

  const clusters = supportResistanceClusters(stockBars);
  const nearestSupport = clusters
    .filter((c) => c.type === 'support')
    .sort((a, b) => a.distancePct - b.distancePct)[0];
  const nearestSupportDistPct = nearestSupport?.distancePct ?? null;

  const entryLocation = entryLocationScore({
    emaDist,
    nearestSupportDistPct,
    rsi: rsiVal,
    stockBars,
  });
  const trendQuality = trendQualityScore({
    adx: adxVal,
    px,
    ema20,
    sma50,
    sma200,
    rs,
    slope,
  });
  const volumeConfirmation = volumeConfirmationScore({ upDownRatio, vr });
  const overheatControl = overheatControlScore({
    emaDist,
    return30d: r30,
    rsi: rsiVal,
    atrRatio,
    peakEarnings: !!peakEarningsPenalty,
  });
  const marketSupport = marketSupportScore(benchmarkBars);

  const composite =
    entryLocation * 0.35 +
    trendQuality * 0.25 +
    volumeConfirmation * 0.15 +
    overheatControl * 0.15 +
    marketSupport * 0.10;

  return {
    composite: Math.round(composite * 10) / 10,
    entryLocation: Math.round(entryLocation * 10) / 10,
    trendQuality: Math.round(trendQuality * 10) / 10,
    volumeConfirmation: Math.round(volumeConfirmation * 10) / 10,
    overheatControl: Math.round(overheatControl * 10) / 10,
    marketSupport: Math.round(marketSupport * 10) / 10,
  };
}

/** Map Composite score → level. Aligned with `entryGrade` thresholds so the
 *  level under the gauge never contradicts the entry-grade label below it. */
export function compositeLevel(score: number): TimingScoreResult['level'] {
  if (score >= 75) return 'STRONG';
  if (score >= 60) return 'WATCH';
  if (score >= 45) return 'NEUTRAL';
  return 'AVOID';
}

/** Project the 5-component breakdown into TimingScoreResult shape so the
 *  rest of the pipeline (UI gauge, overall blend, coherence floor) reuses
 *  the legacy interface unchanged. Each component becomes a pseudo-gain
 *  whose delta is its weighted contribution — the sum equals `score`. */
export function buildCompositeTimingResult(
  b: TimingCompositeBreakdown,
): TimingScoreResult {
  const round = (v: number) => Math.round(v * 10) / 10;
  const gains: TimingScoreResult['gains'] = [
    { reason: `진입 위치 ${b.entryLocation} × 0.35`, delta: round(b.entryLocation * 0.35) },
    { reason: `추세 품질 ${b.trendQuality} × 0.25`, delta: round(b.trendQuality * 0.25) },
    { reason: `거래량 확인 ${b.volumeConfirmation} × 0.15`, delta: round(b.volumeConfirmation * 0.15) },
    { reason: `과열 제어 ${b.overheatControl} × 0.15 (높을수록 안전)`, delta: round(b.overheatControl * 0.15) },
    { reason: `시장 지지 ${b.marketSupport} × 0.10`, delta: round(b.marketSupport * 0.10) },
  ];
  return {
    score: b.composite,
    gains,
    deductions: [],
    level: compositeLevel(b.composite),
  };
}
