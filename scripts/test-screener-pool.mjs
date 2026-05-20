// Sanity-check the dynamic pool builder.
// Usage: npx tsx scripts/test-screener-pool.mjs

import { fetchScreenerPool } from '../api/fetchStock.ts';

for (const filter of ['large_cap', 'small_mid', 'tech', 'all']) {
  const opts =
    filter === 'large_cap'
      ? { minMarketCap: 10e9 }
      : filter === 'small_mid'
        ? { maxMarketCap: 10e9 }
        : {};
  const t0 = Date.now();
  const pool = await fetchScreenerPool(filter, opts);
  const ms = Date.now() - t0;
  console.log(
    `${filter.padEnd(10)} → ${pool.length.toString().padStart(3)} tickers in ${ms}ms — ${pool.slice(0, 10).join(', ')}${pool.length > 10 ? ', ...' : ''}`,
  );
}
