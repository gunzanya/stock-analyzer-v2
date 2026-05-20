// Verify volume + ADX tuning. Show volume/ADX lines from breakdown for
// each ticker plus the final Entry score.
// Usage: npx tsx scripts/test-entry-tune.mjs

import { analyzeOne } from '../api/analyze.ts';

const TICKERS = ['GOOG', 'V', 'LLY', 'BA', 'AGX'];

for (const t of TICKERS) {
  try {
    const r = await analyzeOne(t);
    const all = [...r.entryScore.gains, ...r.entryScore.deductions];
    const vol = all.filter((x) => /거래량/.test(x.reason) && !/볼린저/.test(x.reason));
    const adx = all.filter((x) => /ADX/.test(x.reason));
    console.log(
      `\n${t.padEnd(5)} Entry=${r.entryScore.score} (${r.entryScore.level})  ADX=${r.indicators.adx?.toFixed(0) ?? '—'}  vol=${r.indicators.volumeRatio?.toFixed(2) ?? '—'}x`,
    );
    for (const x of [...vol, ...adx]) {
      const sign = x.delta > 0 ? '+' : '';
      console.log(`   ${sign}${x.delta.toString().padStart(3)}  ${x.reason}`);
    }
  } catch (e) {
    console.log(`💥 ${t}: ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 300));
}
