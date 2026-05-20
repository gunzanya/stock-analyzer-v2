// Probe a handful of tickers for the "돌파 대기" pattern.
// Usage: npx tsx scripts/test-breakout.mjs

import { analyzeOne } from '../api/analyze.ts';

const TICKERS = ['GOOG', 'LLY', 'V', 'KO', 'XOM', 'CAT', 'JNJ', 'PEP', 'MO', 'WMT'];

for (const t of TICKERS) {
  try {
    const r = await analyzeOne(t);
    const tpct = Math.round((r.timingScore.score / 90) * 100);
    const adx = r.indicators.adx;
    const obv = r.indicators.obvDivergence;
    const safe = r.safetyGuard.triggered;
    const ready =
      r.fundamentalScore.score >= 70 &&
      tpct >= 25 && tpct <= 55 &&
      adx != null && adx >= 15 && adx <= 25 &&
      obv !== true &&
      !safe;
    console.log(
      `${ready ? '✅' : '  '} ${t.padEnd(5)}  펀더=${r.fundamentalScore.score.toString().padStart(2)}  타이밍=${tpct.toString().padStart(2)}  ADX=${adx?.toFixed(0).padStart(2) ?? '—'}  OBV=${obv ? 'div' : '·'}  safety=${safe ? '🚨' : '·'}`,
    );
  } catch (e) {
    console.log(`💥 ${t}: ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 300));
}
