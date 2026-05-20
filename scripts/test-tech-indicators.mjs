// Verify Fibonacci / MACD / Bollinger contributions in entryScore + risks.
// Also report raw indicator state so we can see when conditions don't fire.
// Usage: npx tsx scripts/test-tech-indicators.mjs

import { analyzeOne } from '../api/analyze.ts';
import { fetchFundamental, fetchPriceHistory } from '../api/fetchStock.ts';
import {
  bollingerBands,
  bollingerBreakout,
  bollingerSqueeze,
  fibProximity,
  fibonacciLevels,
  macd,
  macdCross,
  macdHistTrend,
  rsi,
} from '../src/lib/indicators.ts';

const TICKERS = ['GOOG', 'LLY', 'AGX', 'KO'];

for (const t of TICKERS) {
  try {
    const fund = await fetchFundamental(t);
    const bars = await fetchPriceHistory(t);
    const r = await analyzeOne(t);

    const fib = fibonacciLevels(bars);
    const prox = fib ? fibProximity(bars, fib) : null;
    const md = macd(bars);
    const cross = md ? macdCross(md) : null;
    const trend = md ? macdHistTrend(md) : null;
    const bb = bollingerBands(bars);
    const squeeze = bb ? bollingerSqueeze(bb) : null;
    const breakout = bb ? bollingerBreakout(bars, bb) : null;
    const rsiVal = rsi(bars, 14);
    const px = bars[0]?.close ?? null;

    console.log(
      `\n=== ${t} [${r.classification.primary}] Entry=${r.entryScore.score} (${r.entryScore.level}) ===`,
    );
    console.log(`  price=${px?.toFixed(2)}  RSI=${rsiVal?.toFixed(0) ?? '—'}`);
    if (fib) {
      console.log(
        `  Fib: 38.2=${fib.level382.toFixed(2)} / 50=${fib.level500.toFixed(2)} / 61.8=${fib.level618.toFixed(2)} → ${JSON.stringify(prox)}`,
      );
    }
    if (md) {
      console.log(`  MACD: cross=${cross}  histTrend=${trend ?? 'mixed'}`);
    }
    if (bb) {
      console.log(`  BB: squeeze=${squeeze}  breakout=${breakout}`);
    }

    const techReasons = [
      ...r.entryScore.gains,
      ...r.entryScore.deductions,
    ].filter((x) => /피보나치|MACD|볼린저/.test(x.reason));
    if (techReasons.length > 0) {
      console.log('  entry breakdown:');
      for (const x of techReasons) {
        const sign = x.delta > 0 ? '+' : x.delta < 0 ? '' : ' ';
        console.log(`     ${sign}${x.delta.toString().padStart(3)}  ${x.reason}`);
      }
    }
    const techRisks = r.riskFactors.filter((rf) =>
      /피보나치|볼린저|MACD/.test(rf.message),
    );
    if (techRisks.length > 0) {
      console.log('  risks:');
      for (const rf of techRisks) {
        console.log(`     [${rf.severity}] ${rf.message}`);
      }
    }
    void fund;
  } catch (e) {
    console.log(`💥 ${t}: ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 400));
}
