// Stage 4/5 verification: TOST, AVGO, LLY, NVDA
import { fetchFundamental, fetchPriceHistory } from '../api/fetchStock.ts';
import { resolveBenchmarkEtf, volumeRatio, adx as adxOf, obvBearishDivergence, return30d } from '../src/lib/indicators.ts';
import { evaluateSafetyGuard } from '../src/lib/safetyGuard.ts';
import { computeEntryScore } from '../src/lib/entryScore.ts';

const TICKERS = ['TOST', 'AVGO', 'LLY', 'NVDA'];

for (const t of TICKERS) {
  try {
    const fund = await fetchFundamental(t);
    const stockBars = await fetchPriceHistory(t);
    const benchEtf = resolveBenchmarkEtf(fund);
    const benchBars = await fetchPriceHistory(benchEtf);

    const safety = evaluateSafetyGuard({
      stockBars,
      benchmarkBars: benchBars,
      benchmarkLabel: benchEtf,
    });
    const entry = computeEntryScore({ stockBars, benchmarkBars: benchBars });

    // Raw indicators for inspection
    const vr = volumeRatio(stockBars);
    const adxV = adxOf(stockBars);
    const obv = obvBearishDivergence(stockBars);
    const r30 = return30d(stockBars);

    console.log(`\n=== ${t} (${fund.name}) — bench ${benchEtf} ===`);
    console.log(`  sector=${fund.sector} | industry=${fund.industry}`);
    console.log(
      `  raw: vol=${vr?.toFixed(2)}x ADX=${adxV?.toFixed(0)} OBVdiv=${obv} 30d=${(r30 * 100).toFixed(1)}%`,
    );
    console.log(
      `  RS=${safety.stockReturn3M != null ? '3M ' + (safety.stockReturn3M * 100).toFixed(0) + '% vs bench ' + (safety.sectorReturn3M * 100).toFixed(0) + '% (excess ' + (safety.excessVsSector * 100).toFixed(0) + 'pp)' : 'n/a'}`,
    );
    console.log(`  SAFETY: triggered=${safety.triggered} ${safety.reasons.join(', ')}`);
    if (safety.sectorContext) console.log(`          ${safety.sectorContext}`);
    console.log(`  ENTRY: score=${entry.score} (${entry.level})`);
    for (const g of entry.gains) console.log(`    +${g.delta} ${g.reason}`);
    for (const d of entry.deductions) console.log(`    ${d.delta} ${d.reason}`);

    // ms throttle so we don't blast Yahoo
    await new Promise((r) => setTimeout(r, 500));
  } catch (e) {
    console.error(`${t}: FAILED — ${e.message}`);
  }
}
