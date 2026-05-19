// Probe key fundamentals for a ticker to debug classifier
import { fetchFundamental } from '../api/fetchStock.ts';

for (const t of process.argv.slice(2)) {
  const f = await fetchFundamental(t);
  console.log(`=== ${t} ===`);
  console.log(`sector: ${f.sector} | industry: ${f.industry}`);
  console.log(`mcap: $${(f.marketCap / 1e9).toFixed(1)}B | divY: ${(f.dividendYield * 100).toFixed(2)}%`);
  console.log(`EPSyoy=${f.epsGrowthYoY} REVyoy=${f.revenueGrowthYoY} | PBR=${f.pbr} PSR=${f.psr} PER=${f.per}`);
  const ttm = f.quarterly.slice(0, 4).map((q) => q.revenue ?? 0).reduce((a, b) => a + b, 0);
  console.log(`Rev TTM=$${(ttm / 1e9).toFixed(2)}B`);
  for (const q of f.quarterly) {
    console.log(`  ${q.date}: eps=${q.eps}, rev=${q.revenue}, op=${q.operatingIncome}`);
  }
  await new Promise((r) => setTimeout(r, 300));
}
