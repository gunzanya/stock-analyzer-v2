// Verify the STALWART mega-cap floor:
//   $1T+ → ≥25, $500B+ → ≥20, $200B+ → ≥15
// Usage: node --experimental-strip-types scripts/test-stalwart-floor.mjs

import { fetchFundamental } from '../api/fetchStock.ts';
import { scoreAllTypes } from '../src/lib/stockType.ts';
import { classify } from '../src/lib/typeWeights.ts';

const CASES = ['AMZN', 'GOOG', 'MSFT', 'NVDA'];

function expectedFloor(mcap) {
  if (mcap >= 1e12) return 25;
  if (mcap >= 500e9) return 20;
  if (mcap >= 200e9) return 15;
  return 0;
}

let pass = 0;
for (const t of CASES) {
  try {
    const fund = await fetchFundamental(t);
    const all = scoreAllTypes(fund);
    const stalwart = all.find((c) => c.type === 'STALWART');
    const cls = classify(fund);
    const mcap = fund.marketCap ?? 0;
    const floor = expectedFloor(mcap);
    const ok = !stalwart.disqualified && stalwart.score >= floor;
    if (ok) pass++;
    console.log(
      `${ok ? '✅' : '❌'} ${t.padEnd(6)} mcap=$${(mcap / 1e9).toFixed(0)}B ` +
        `floor=${floor} STALWART=${stalwart.score.toFixed(0)}` +
        `${stalwart.disqualified ? '✗' : ''} → primary=${cls.primary}`,
    );
    const floorReason = stalwart.reasons.find((r) => r.includes('floor'));
    if (floorReason) console.log(`     reason: ${floorReason}`);
  } catch (e) {
    console.log(`💥 ${t}: ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 400));
}
console.log(`\n${pass}/${CASES.length} pass floor check`);
