// Probe Yahoo's quoteSummary for a specific ticker to see what error it
// throws when fundamentals are unavailable. Used to diagnose the
// 483650.KS internal-error case.
import YahooFinance from 'yahoo-finance2';

const yf = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });
const ticker = process.argv[2] || '483650.KS';
const modules = [
  'assetProfile', 'summaryProfile', 'summaryDetail', 'defaultKeyStatistics',
  'financialData', 'price', 'earningsHistory',
  'incomeStatementHistoryQuarterly', 'incomeStatementHistory',
  'balanceSheetHistoryQuarterly', 'balanceSheetHistory',
];
try {
  const r = await yf.quoteSummary(ticker, { modules }, { validateResult: false });
  console.log('OK, keys:', r ? Object.keys(r) : 'null');
  if (r?.price) console.log('  price.regularMarketPrice:', r.price.regularMarketPrice);
} catch (e) {
  console.error(`FAIL: ${e.constructor.name}: ${e.message}`);
  if (e.code) console.error('code:', e.code);
}
