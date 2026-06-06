// Probe PWR's entryLocation sub-components to find why it's 46.3 instead
// of the expected ~65 given EMA20 +0.9% (pullback 100) and RSI 56
// (goldilocks 100).
// Usage: npx tsx scripts/probe-entry-loc.mjs [TICKER...]

import { fetchPriceHistory, fetchFundamental } from '../api/fetchStock.ts';
import {
  ema,
  rsi as rsiOf,
  supportResistanceClusters,
  resolveBenchmarkEtf,
} from '../src/lib/indicators.ts';

const TICKERS = process.argv.slice(2);
if (TICKERS.length === 0) TICKERS.push('PWR');

// Mirror timingComposite.ts sub-scorers verbatim so a discrepancy here
// matches what production logs.
function lerp(x, x0, y0, x1, y1) {
  if (x1 === x0) return y0;
  return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
}
function ema20PullbackScore(emaDist) {
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
function supportClusterScore(d) {
  if (d == null) return 50;
  if (d <= 3) return 100;
  if (d <= 8) return lerp(d, 3, 100, 8, 40);
  return 50;
}
function rsiGoldilocksScore(rsi) {
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
function candleRecoveryScore(stockBars) {
  if (stockBars.length < 5) return 50;
  const colors = stockBars.slice(0, 5).map((b) => {
    if (b.open == null) return '·';
    if (b.close > b.open) return 'g';
    if (b.close < b.open) return 'r';
    return '·';
  });
  const greens = colors.filter((c) => c === 'g').length;
  const reds = colors.filter((c) => c === 'r').length;
  const todayGreen = colors[0] === 'g';
  if (todayGreen && colors[1] === 'r' && colors[2] === 'r') return { score: 100, why: 'pullback recovery (g,r,r)' };
  if (greens >= 4) return { score: 30, why: `5일 ${greens}양봉 과열` };
  if (reds >= 4) return { score: 15, why: `5일 ${reds}음봉 약세` };
  if (todayGreen) return { score: 65, why: 'today green' };
  if (colors[0] === 'r') return { score: 35, why: 'today red' };
  return { score: 50, why: 'neutral' };
}

for (const t of TICKERS) {
  const fund = await fetchFundamental(t);
  const stockBars = await fetchPriceHistory(t);
  const benchEtf = resolveBenchmarkEtf(fund);
  void benchEtf;

  const px = stockBars[0]?.close ?? 0;
  const ema20 = ema(stockBars, 20);
  const emaDist = ema20 != null && ema20 > 0 && px > 0 ? (px - ema20) / ema20 : null;
  const rsiVal = rsiOf(stockBars, 14);

  const clusters = supportResistanceClusters(stockBars);
  const supports = clusters.filter((c) => c.type === 'support').sort((a, b) => a.distancePct - b.distancePct);
  const nearestSupport = supports[0];
  const nearestSupportDistPct = nearestSupport?.distancePct ?? null;

  const pullback = ema20PullbackScore(emaDist);
  const cluster = supportClusterScore(nearestSupportDistPct);
  const rsi = rsiGoldilocksScore(rsiVal);
  const candle = candleRecoveryScore(stockBars);
  const total = pullback * 0.45 + cluster * 0.20 + rsi * 0.20 + candle.score * 0.15;

  // Show last 5 candles for candleRecoveryScore inspection
  const colors = stockBars.slice(0, 5).map((b) => {
    if (b.open == null) return '·';
    if (b.close > b.open) return 'g';
    if (b.close < b.open) return 'r';
    return '·';
  });

  console.log(`\n=== ${t} (entryLocation 분해) ===`);
  console.log(`  px=${px.toFixed(2)}  EMA20=${ema20?.toFixed(2)}  emaDist=${emaDist != null ? (emaDist*100).toFixed(2)+'%' : '—'}`);
  console.log(`  RSI(14)=${rsiVal?.toFixed(2) ?? '—'}`);
  console.log(`  5일 캔들 (newest→oldest): ${colors.join(',')}`);
  console.log(`  지지 클러스터 (가까운순):`);
  for (const c of supports.slice(0, 3)) {
    console.log(`    ${c.sources.join('+')} @ ${c.price.toFixed(2)} (${c.distancePct.toFixed(2)}% 거리)`);
  }
  if (supports.length === 0) console.log(`    (없음)`);
  console.log(`  --- 점수 분해 ---`);
  console.log(`    ema20PullbackScore   = ${pullback}    × 0.45 = ${(pullback*0.45).toFixed(2)}`);
  console.log(`    supportClusterScore  = ${cluster}    × 0.20 = ${(cluster*0.20).toFixed(2)}    (nearestSupportDistPct=${nearestSupportDistPct?.toFixed(2) ?? 'null'}%)`);
  console.log(`    rsiGoldilocksScore   = ${rsi}    × 0.20 = ${(rsi*0.20).toFixed(2)}`);
  console.log(`    candleRecoveryScore  = ${candle.score}    × 0.15 = ${(candle.score*0.15).toFixed(2)}    (${candle.why})`);
  console.log(`    합계 entryLocation   = ${total.toFixed(2)}`);
}
