import { fetchFundamental } from '../api/fetchStock.ts';
for (const t of process.argv.slice(2)) {
  const f = await fetchFundamental(t);
  console.log(`${t} (${f.name}):`);
  console.log(`  annual rows: ${f.annual.length}`);
  for (const a of f.annual) {
    console.log(`    ${a.date}: rev=${a.revenue} netIncome=${a.netIncome} eps=${a.eps}`);
  }
  console.log(`  warnings: ${f.warnings.join('; ')}`);
}
