// Run classifier on a set of tickers and compare with expectations.
// Usage: node --experimental-strip-types scripts/test-classify.mjs

import { fetchFundamental } from '../api/fetchStock.ts';
import { classify } from '../src/lib/typeWeights.ts';

const CASES = [
  // ticker,            expected, comment
  ['NVDA',              ['FAST_GROWER'],                          '🚀 고성장'],
  ['AAPL',              ['STALWART', 'FAST_GROWER'],              '🏛️ 대형우량 + 🚀 고성장'],
  ['BRK-B',             ['ASSET_PLAY'],                            '🏗️ 자산주'],
  ['MSTR',              ['ASSET_PLAY', 'SPECULATIVE'],             '🏗️ + 🎰'],
  ['XOM',               ['CYCLICAL', 'FAST_GROWER'],               '🔄 + 🚀'],
  ['GM',                ['CYCLICAL'],                              '🔄 순환'],
  ['BA',                ['TURNAROUND'],                            '🔃 턴어라운드'],
  ['INTC',              ['TURNAROUND', 'CYCLICAL'],                '🔃 + 🔄'],
  ['RIVN',              ['SPECULATIVE'],                           '🎰 투기'],
  ['GME',               ['SPECULATIVE'],                           '🎰 투기'],
  ['MO',                ['SLOW_GROWER'],                           '💰 저성장/배당'],
  ['O',                 ['SLOW_GROWER'],                           '💰 저성장/배당'],
];

let pass = 0;
for (const [ticker, expected, comment] of CASES) {
  try {
    const fund = await fetchFundamental(ticker);
    const cls = classify(fund);
    const ok = expected.includes(cls.primary);
    if (ok) pass++;
    const top3 = cls.candidates
      .slice(0, 3)
      .map((c) => `${c.type}=${c.score.toFixed(0)}${c.disqualified ? '✗' : ''}`)
      .join(' ');
    console.log(
      `${ok ? '✅' : '❌'} ${ticker.padEnd(8)} → ${cls.display.padEnd(40)} ` +
        `| top: ${top3} | expected ${expected.join('/')} (${comment})`,
    );
  } catch (e) {
    console.log(`💥 ${ticker.padEnd(8)} → ERROR: ${e.message}`);
  }
  // tiny delay to avoid Yahoo rate-limit
  await new Promise((r) => setTimeout(r, 400));
}
console.log(`\n${pass}/${CASES.length} primary type matches expected`);
