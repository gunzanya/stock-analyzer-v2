// Verify pool sizes after merging Yahoo dynamic + S&P 500 static.
// Usage: npx tsx scripts/test-pool-merge.mjs

import { fetchScreenerPool } from '../api/fetchStock.ts';
import { SP500 } from '../src/lib/sp500.ts';

const MERGE_SP500 = {
  all: true,
  breakout: true,
  large_cap: true,
  small_mid: false,
  tech: false,
};

console.log(`SP500 static list size: ${SP500.length}`);

for (const filter of ['all', 'breakout', 'large_cap', 'small_mid', 'tech']) {
  const opts =
    filter === 'large_cap'
      ? { minMarketCap: 10e9 }
      : filter === 'small_mid'
        ? { maxMarketCap: 10e9 }
        : {};
  const dynamic = await fetchScreenerPool(filter, opts);
  const merged = MERGE_SP500[filter]
    ? Array.from(new Set([...dynamic, ...SP500]))
    : dynamic;
  const overlap = MERGE_SP500[filter]
    ? dynamic.filter((t) => SP500.includes(t)).length
    : 0;
  console.log(
    `${filter.padEnd(10)} dynamic=${dynamic.length.toString().padStart(3)}  +SP500=${MERGE_SP500[filter] ? '✓' : '✗'}  overlap=${overlap.toString().padStart(2)}  → merged=${merged.length}`,
  );
}
