// Spot-check classification — show top-3 candidates per ticker.
import { fetchFundamental } from '../api/fetchStock.ts';
import { classify } from '../src/lib/typeWeights.ts';
import { STOCK_TYPE_LABELS } from '../src/lib/types.ts';

const tickers = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['NEE', 'PYPL', 'CCJ', 'RTX', 'F'];

for (const t of tickers) {
  try {
    const f = await fetchFundamental(t);
    const r = classify(f);
    const top4 = r.candidates.slice(0, 4);
    console.log(
      `${t.padEnd(6)} ${(f.name ?? '').slice(0, 26).padEnd(26)} ` +
        `sec=${(f.sector ?? '—').padEnd(20)} ` +
        `mcap=${f.marketCap != null ? '$' + (f.marketCap / 1e9).toFixed(0) + 'B' : '—'}`,
    );
    console.log(
      `   → ${r.uncertain ? '⚠️ UNCERTAIN' : r.display}  (confidence ${r.confidence})`,
    );
    for (const c of top4) {
      const label = STOCK_TYPE_LABELS[c.type];
      console.log(
        `     ${label.emoji} ${label.ko.padEnd(7)} ${String(c.score).padStart(3)}` +
          (c.disqualified ? '  ✗' : ''),
      );
    }
    console.log('');
  } catch (e) {
    console.log(`${t} FAILED: ${e.message}`);
  }
}
