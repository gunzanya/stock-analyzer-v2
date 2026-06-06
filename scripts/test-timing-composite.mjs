// Stage-1 comparison: legacy timing (adjustedTiming.score) vs new
// TimingComposite for a fixed ticker set. Logs a table; does NOT switch
// any production scoring.
//
// Usage: npx tsx scripts/test-timing-composite.mjs

import { analyzeOne } from '../api/analyze.ts';
import { fetchPriceHistory } from '../api/fetchStock.ts';
import { resolveBenchmarkEtf } from '../src/lib/indicators.ts';
import { computeTimingComposite } from '../src/lib/timingComposite.ts';

const TICKERS = [
  'PWR', 'CAT', 'NTAP', 'NVDA', 'GLW', 'TWLO', 'LLY',
  '005930.KS', '000660.KS', 'WDC',
];

function pad(s, n, dir = 'r') {
  const str = String(s);
  if (str.length >= n) return str.slice(0, n);
  const fill = ' '.repeat(n - str.length);
  return dir === 'r' ? fill + str : str + fill;
}

const rows = [];
for (const t of TICKERS) {
  try {
    const r = await analyzeOne(t);
    const benchEtf = resolveBenchmarkEtf(r.fundamental);
    const stockBars = await fetchPriceHistory(t);
    const benchBars = await fetchPriceHistory(benchEtf);
    const isKR = /\.(KS|KQ)$/i.test(t);
    const comp = computeTimingComposite({
      stockBars,
      benchmarkBars: benchBars,
      absoluteMode: isKR,
      primaryType: r.classification.primary,
      peakEarningsPenalty: r.fundamentalScore.peakEarningsPenalty != null,
    });
    const legacy = r.timingScore.score;
    const diff = comp.composite - legacy;
    rows.push({ t, legacy, comp, diff });
  } catch (e) {
    console.log(`💥 ${t}: ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 500));
}

console.log('');
console.log(
  pad('종목', 11, 'l') + ' | ' +
  pad('기존', 5) + ' | ' +
  pad('Composite', 9) + ' | ' +
  pad('Δ', 6) + ' || ' +
  pad('entryLoc', 8) + ' | ' +
  pad('trendQ', 6) + ' | ' +
  pad('vol', 5) + ' | ' +
  pad('overheat', 8) + ' | ' +
  pad('market', 6),
);
console.log('-'.repeat(95));
for (const { t, legacy, comp, diff } of rows) {
  const sign = diff >= 0 ? '+' : '';
  console.log(
    pad(t, 11, 'l') + ' | ' +
    pad(legacy, 5) + ' | ' +
    pad(comp.composite.toFixed(1), 9) + ' | ' +
    pad(`${sign}${diff.toFixed(1)}`, 6) + ' || ' +
    pad(comp.entryLocation.toFixed(1), 8) + ' | ' +
    pad(comp.trendQuality.toFixed(1), 6) + ' | ' +
    pad(comp.volumeConfirmation.toFixed(1), 5) + ' | ' +
    pad(comp.overheatControl.toFixed(1), 8) + ' | ' +
    pad(comp.marketSupport.toFixed(1), 6),
  );
}
