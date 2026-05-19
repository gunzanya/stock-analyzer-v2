import YahooFinance from 'yahoo-finance2';
const yf = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });
const symbol = process.argv[2] || 'INTC';
const period1 = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
const out = await yf.fundamentalsTimeSeries(
  symbol,
  { period1, type: 'quarterly', module: 'financials' },
  { validateResult: false },
);
console.log(`rows: ${Array.isArray(out) ? out.length : 'n/a'}`);
if (Array.isArray(out) && out.length) {
  for (const row of out) {
    console.log(`${row.date} (${row.periodType}): rev=${row.totalRevenue} op=${row.operatingIncome} net=${row.netIncome} dEPS=${row.dilutedEPS}`);
  }
}
