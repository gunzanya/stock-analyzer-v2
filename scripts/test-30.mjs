// Stage 8: 30-ticker live validation per the spec table.
// Accepts a result as a "match" if any of the expected primaries appears as
// either the primary OR (for clear blend cases) the secondary type.

import { fetchFundamental, fetchPriceHistory } from '../api/fetchStock.ts';
import { classify } from '../src/lib/typeWeights.ts';
import { resolveBenchmarkEtf } from '../src/lib/indicators.ts';
import { evaluateSafetyGuard } from '../src/lib/safetyGuard.ts';
import { computeTiming } from '../src/lib/entryScore.ts';

// Each row: [ticker, expectedPrimaries[], note]
//   expectedPrimaries accepts primary OR secondary types per spec
const CASES = [
  ['NVDA',         ['FAST_GROWER'],                          '고성장 70%+'],
  ['AVGO',         ['FAST_GROWER', 'STALWART'],               '고성장 60% + 대형우량 40%'],
  ['AAPL',         ['STALWART', 'FAST_GROWER'],               '대형우량 70% + 고성장 30%'],
  ['MSFT',         ['STALWART', 'FAST_GROWER'],               '대형우량 60% + 고성장 40%'],
  ['COST',         ['STALWART'],                              '대형우량 단독'],
  ['WMT',          ['STALWART'],                              '대형우량 단독'],
  ['MO',           ['SLOW_GROWER'],                           '저성장/배당'],
  ['O',            ['SLOW_GROWER'],                           '저성장/배당'],
  ['JNJ',          ['STALWART', 'SLOW_GROWER'],               '대형우량 60% + 저성장 40%'],
  ['ARCC',         ['SLOW_GROWER'],                           '저성장/배당'],
  ['XOM',          ['CYCLICAL', 'FAST_GROWER'],               '순환 60% + 고성장 40%'],
  ['GOLD',         ['CYCLICAL'],                              '순환 단독'],
  ['GM',           ['CYCLICAL'],                              '순환 단독'],
  ['CLF',          ['CYCLICAL'],                              '순환 단독'],
  ['BA',           ['TURNAROUND'],                            '턴어라운드'],
  ['INTC',         ['TURNAROUND', 'CYCLICAL'],                '턴어라운드 50% + 순환 50%'],
  ['HOOD',         ['TURNAROUND', 'FAST_GROWER'],             '턴어라운드 단독 or +고성장'],
  ['GME',          ['SPECULATIVE'],                           '투기'],
  ['IONQ',         ['SPECULATIVE'],                           '투기'],
  ['RIVN',         ['SPECULATIVE'],                           '투기'],
  ['BRK-B',        ['ASSET_PLAY'],                            '자산주'],
  ['MSTR',         ['ASSET_PLAY', 'SPECULATIVE'],             '자산주 + 투기'],
  ['005930.KS',    ['CYCLICAL', 'FAST_GROWER'],               '순환 55% + 고성장 45% (삼성전자)'],
  ['000660.KS',    ['CYCLICAL', 'FAST_GROWER'],               '순환 55% + 고성장 45% (SK하이닉스)'],
  ['003230.KS',    ['FAST_GROWER'],                           '고성장 단독 (삼양식품)'],
  ['035720.KS',    ['TURNAROUND', 'STALWART'],                '턴어라운드 50% + 대형우량 50% (카카오)'],
  ['CRWD',         ['FAST_GROWER'],                           '고성장 단독'],
  ['SHOP',         ['FAST_GROWER'],                           '고성장 단독'],
  ['PLTR',         ['FAST_GROWER'],                           '고성장 단독 (안전장치 가능)'],
  ['402340.KS',    ['ASSET_PLAY'],                            '자산주 단독'],
];

const TYPE_EMOJI = {
  FAST_GROWER: '🚀',
  STALWART: '🏛️',
  SLOW_GROWER: '💰',
  CYCLICAL: '🔄',
  TURNAROUND: '🔃',
  ASSET_PLAY: '🏗️',
  SPECULATIVE: '🎰',
};

let primaryMatches = 0;
let primaryOrSecondaryMatches = 0;
const failures = [];

for (const [ticker, expected, note] of CASES) {
  try {
    const fund = await fetchFundamental(ticker);
    const cls = classify(fund);

    let priceFailed = false;
    let stockBars = [];
    let benchBars = [];
    try {
      stockBars = await fetchPriceHistory(ticker);
      const bench = resolveBenchmarkEtf(fund);
      benchBars = await fetchPriceHistory(bench);
    } catch (e) {
      priceFailed = true;
    }
    let entryStr = 'n/a';
    let safetyStr = '';
    if (!priceFailed && stockBars.length >= 50 && benchBars.length >= 50) {
      const safety = evaluateSafetyGuard({
        stockBars,
        benchmarkBars: benchBars,
        benchmarkLabel: resolveBenchmarkEtf(fund),
      });
      const entry = computeTiming({ stockBars, benchmarkBars: benchBars });
      entryStr = `Entry ${entry.score} (${entry.level})`;
      if (safety.triggered) safetyStr = `🛡️${safety.sectorContext?.slice(0, 30) || ''}`;
    }

    const primaryOk = expected.includes(cls.primary);
    const secondaryOk =
      cls.secondary != null && expected.includes(cls.secondary);
    if (primaryOk) primaryMatches++;
    if (primaryOk || secondaryOk) primaryOrSecondaryMatches++;
    const mark = primaryOk ? '✅' : secondaryOk ? '🟡' : '❌';

    console.log(
      `${mark} ${ticker.padEnd(11)} ${cls.display.padEnd(35)} | ` +
        `${entryStr.padEnd(20)} ${safetyStr.padEnd(34)} | ` +
        `expected: ${expected.map((t) => TYPE_EMOJI[t]).join('/')} (${note})`,
    );
    if (!primaryOk) {
      failures.push({
        ticker,
        expected,
        got: cls.primary,
        top: cls.candidates.slice(0, 3).map((c) => `${c.type}=${c.score}`).join(' '),
      });
    }
    await new Promise((r) => setTimeout(r, 350));
  } catch (e) {
    console.log(`💥 ${ticker.padEnd(11)} ERROR: ${e.message}`);
    failures.push({ ticker, error: e.message });
  }
}

console.log(`\n${'='.repeat(70)}`);
console.log(
  `Primary match:           ${primaryMatches}/${CASES.length} (${((primaryMatches / CASES.length) * 100).toFixed(0)}%)`,
);
console.log(
  `Primary or secondary:    ${primaryOrSecondaryMatches}/${CASES.length} (${((primaryOrSecondaryMatches / CASES.length) * 100).toFixed(0)}%)`,
);
console.log(`Target: 25/30 (83%+)`);

if (failures.length) {
  console.log(`\nFailures:`);
  for (const f of failures) {
    if (f.error) console.log(`  ${f.ticker}: ${f.error}`);
    else console.log(`  ${f.ticker}: expected ${f.expected.join('/')} got ${f.got} | ${f.top}`);
  }
}
