import { analyzeOne } from '../api/analyze.ts';

const TICKERS = ['LLY', 'TSM', 'AVGO', 'NVDA'];

for (const t of TICKERS) {
  try {
    const r = await analyzeOne(t);
    console.log(`\n=== ${t} ===`);
    console.log(`  TotalScore: ${r.totalScore.score} (${r.totalScore.level})`);
    console.log(`  EntryScore: ${r.entryScore.score} (${r.entryScore.level})`);
    console.log(`  RS: ${r.indicators.rs?.toFixed(0)} | 1y return: ${r.indicators.return1y != null ? (r.indicators.return1y * 100).toFixed(0) + '%' : '—'}`);
    console.log(`  Gains:`);
    for (const g of r.entryScore.gains) console.log(`    +${g.delta} ${g.reason}`);
    console.log(`  Deductions:`);
    for (const d of r.entryScore.deductions) console.log(`    ${d.delta} ${d.reason}`);
  } catch (e) {
    console.log(`${t}: ERROR ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 400));
}
