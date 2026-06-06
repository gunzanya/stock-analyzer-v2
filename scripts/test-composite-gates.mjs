// Verify Composite-driven gates: per-ticker score, overheat, chase warning,
// and breakout/entry/uptrend flags. Should confirm SK Hynix (000660.KS,
// overheat 40 < 50) drops out of 진입적기 even though Composite is high.
//
// Usage: npx tsx scripts/test-composite-gates.mjs

import { analyzeOne } from '../api/analyze.ts';

const TICKERS = [
  'PWR', 'CAT', 'NTAP', 'NVDA', 'GLW', 'TWLO', 'LLY',
  '005930.KS', '000660.KS', 'WDC',
];

function pad(s, n, dir = 'r') {
  const str = String(s);
  if (str.length >= n) return str.slice(0, n);
  const fill = ' '.repeat(n - str.length);
  return dir === 'r' ? fill + str : str + fill;
}

const rows = [];
for (const t of TICKERS) {
  try {
    const r = await analyzeOne(t);
    const c = r.timingComposite;
    const chase = r.riskFactors.some((rk) => rk.message.startsWith('🚨 사이클 상단'));
    rows.push({
      t,
      overall: r.overallScore.score,
      fund: r.fundamentalScore.score,
      timing: r.timingScore.score,
      level: r.timingScore.level,
      overheat: c?.overheatControl ?? null,
      chase,
      breakout: r.priceBars.length > 0,
      breakoutReady: undefined, // filled by toSummary path later
    });
    // Re-evaluate gates inline since toSummary isn't exported
    const isKR = /\.(KS|KQ)$/i.test(t);
    const fundMin = isKR ? 60 : 65;
    const isChase = chase;
    const breakoutReady =
      r.fundamentalScore.score >= fundMin &&
      r.timingScore.score >= 45 && r.timingScore.score <= 74 &&
      !r.safetyGuard.triggered && !isChase;
    const entryReady =
      r.fundamentalScore.score >= fundMin &&
      r.timingScore.score >= 75 &&
      (c?.overheatControl ?? -1) >= 50 &&
      !r.safetyGuard.triggered && !isChase;
    const uptrendConfirmed =
      r.fundamentalScore.score >= fundMin &&
      r.overallScore.score >= (isKR ? 65 : 70) &&
      r.timingScore.score >= 65 &&
      !r.safetyGuard.triggered && !isChase;
    rows[rows.length - 1] = {
      ...rows[rows.length - 1],
      breakoutReady, entryReady, uptrendConfirmed,
    };
  } catch (e) {
    console.log(`💥 ${t}: ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 500));
}

console.log('');
console.log(
  pad('종목', 11, 'l') + ' | ' +
  pad('종합', 5) + ' | ' +
  pad('펀더', 5) + ' | ' +
  pad('타이밍', 6) + ' | ' +
  pad('level', 8, 'l') + ' | ' +
  pad('overheat', 8) + ' | ' +
  pad('chase', 5) + ' | ' +
  pad('break', 5) + ' | ' +
  pad('entry', 5) + ' | ' +
  pad('uptrend', 7),
);
console.log('-'.repeat(95));
for (const r of rows) {
  console.log(
    pad(r.t, 11, 'l') + ' | ' +
    pad(r.overall, 5) + ' | ' +
    pad(r.fund, 5) + ' | ' +
    pad(r.timing, 6) + ' | ' +
    pad(r.level, 8, 'l') + ' | ' +
    pad(r.overheat ?? '—', 8) + ' | ' +
    pad(r.chase ? 'YES' : '—', 5) + ' | ' +
    pad(r.breakoutReady ? '✓' : '·', 5) + ' | ' +
    pad(r.entryReady ? '✓' : '·', 5) + ' | ' +
    pad(r.uptrendConfirmed ? '✓' : '·', 7),
  );
}
