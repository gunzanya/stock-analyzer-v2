// Quick live test of fetchFundamental
// Run: node scripts/test-fetch.mjs NVDA AAPL 005930.KS

import { fetchFundamental } from '../api/fetchStock.ts';

const tickers = process.argv.slice(2);
if (tickers.length === 0) {
  console.error('Usage: node scripts/test-fetch.mjs TICKER [TICKER ...]');
  process.exit(1);
}

for (const t of tickers) {
  try {
    const d = await fetchFundamental(t);
    const q = d.quarterly.map((x) => `${x.date}:eps=${x.eps},rev=${x.revenue}`).join(' | ');
    console.log(
      `${d.ticker} ${d.name} | sector=${d.sector} | mcap=${d.marketCap} | ` +
        `PBR=${d.pbr} PER=${d.per} PSR=${d.psr} | divY=${d.dividendYield} | ` +
        `EPSyoy=${d.epsGrowthYoY} REVyoy=${d.revenueGrowthYoY} | ` +
        `assets=${d.totalAssets} | quarters=${d.quarterly.length} [${q}] | ` +
        `warnings=${d.warnings.join(';')}`,
    );
  } catch (e) {
    console.error(`${t}: FAILED — ${e.message}`);
  }
}
