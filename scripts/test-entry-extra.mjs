// Verify the new EntryScore factors (RSI, EMA20 distance, 5-day pattern).
// Usage: npx tsx scripts/test-entry-extra.mjs

import { analyzeOne } from '../api/analyze.ts';

const TICKERS = ['GOOG', 'LLY', 'NVDA', 'VIRT', 'KO'];

function pickReasons(list, keys) {
  return list.filter((r) => keys.some((k) => r.reason.includes(k)));
}

for (const t of TICKERS) {
  try {
    const r = await analyzeOne(t);
    const all = [...r.entryScore.gains, ...r.entryScore.deductions];
    const rsi = pickReasons(all, ['RSI']);
    const ema = pickReasons(all, ['EMA20']);
    const five = pickReasons(all, ['5일']);
    console.log(
      `\n${t.padEnd(6)} [${r.classification.primary}] Entry=${r.entryScore.score} (${r.entryScore.level})`,
    );
    for (const x of [...rsi, ...ema, ...five]) {
      const sign = x.delta > 0 ? '+' : x.delta < 0 ? '' : ' ';
      console.log(`   ${sign}${x.delta.toString().padStart(3)}  ${x.reason}`);
    }
  } catch (e) {
    console.log(`💥 ${t}: ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 300));
}
