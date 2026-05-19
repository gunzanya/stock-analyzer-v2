import { fetchFundamental } from '../api/fetchStock.ts';
for (const t of process.argv.slice(2)) {
  const f = await fetchFundamental(t);
  console.log(`${t}: name="${f.name}" sector=${f.sector} industry=${f.industry}`);
}
