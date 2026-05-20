// Verify HBM/FSM/ARIS classify as CYCLICAL with the materials/mining tweak.
// Usage: npx tsx scripts/test-materials-cyclical.mjs

import { fetchFundamental } from '../api/fetchStock.ts';
import { scoreAllTypes } from '../src/lib/stockType.ts';
import { classify } from '../src/lib/typeWeights.ts';

const TICKERS = ['HBM', 'FSM', 'ARIS'];

for (const t of TICKERS) {
  try {
    const fund = await fetchFundamental(t);
    const cls = classify(fund);
    const all = scoreAllTypes(fund);
    const cyc = all.find((c) => c.type === 'CYCLICAL');
    const ok = cls.primary === 'CYCLICAL';
    console.log(
      `${ok ? '✅' : '❌'} ${t.padEnd(5)} sec="${fund.sector ?? '—'}"  ind="${fund.industry ?? '—'}"  → ${cls.primary}  CYCLICAL=${cyc?.score ?? '—'}`,
    );
    if (cyc && !cyc.disqualified) {
      for (const r of cyc.reasons) console.log(`    ${r}`);
    }
  } catch (e) {
    console.log(`💥 ${t}: ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 300));
}
