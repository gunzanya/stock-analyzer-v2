import { analyzeOne } from '../api/analyze.ts';

const TICKERS = ['LLY', 'TSM', 'AVGO', 'NVDA'];

for (const t of TICKERS) {
  try {
    const r = await analyzeOne(t);
    console.log(`\n=== ${t} ===`);
    console.log(`  Fundamental: ${r.fundamentalScore.score} (${r.fundamentalScore.level})`);
    console.log(`  Timing: ${r.timingScore.score} (${r.timingScore.level})`);
    console.log(`  RS: ${r.indicators.rs?.toFixed(0)} | 1y return: ${r.indicators.return1y != null ? (r.indicators.return1y * 100).toFixed(0) + '%' : '—'}`);
    console.log(`  Gains:`);
    for (const g of r.timingScore.gains) console.log(`    +${g.delta} ${g.reason}`);
    console.log(`  Deductions:`);
    for (const d of r.timingScore.deductions) console.log(`    ${d.delta} ${d.reason}`);
  } catch (e) {
    console.log(`${t}: ERROR ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 400));
}
