// Probe raw fundamentalsTimeSeries response to see actual field names
import YahooFinance from 'yahoo-finance2';
const yf = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });

const symbol = process.argv[2] || 'NVDA';
const period1 = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);

const out = await yf.fundamentalsTimeSeries(
  symbol,
  { period1, type: 'quarterly', module: 'balance-sheet' },
  { validateResult: false },
);

console.log('rows:', Array.isArray(out) ? out.length : 'not-array');
if (Array.isArray(out) && out.length) {
  const latest = out[out.length - 1];
  console.log('latest keys:', Object.keys(latest).sort().slice(0, 60).join('\n  '));
  console.log('---');
  for (const k of Object.keys(latest)) {
    if (/totalAssets|totalLiab|cash|invest/i.test(k)) {
      console.log(`  ${k} = ${latest[k]}`);
    }
  }
}
