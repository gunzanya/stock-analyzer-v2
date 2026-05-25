// Simulate yahoo-finance2's "internal-error" throw to verify analyzeOne
// degrades gracefully and produces a usable result with Naver fallback.
import YahooFinance from 'yahoo-finance2';

// Monkey-patch quoteSummary to throw "internal-error" on the first call.
const yf = YahooFinance.prototype;
const origQS = yf.quoteSummary;
let called = false;
yf.quoteSummary = async function (sym, ...rest) {
  if (!called) {
    called = true;
    const err = new Error('internal-error');
    err.code = 500;
    throw err;
  }
  return origQS.call(this, sym, ...rest);
};

const { analyzeOne } = await import('/workspaces/stock-analyzer-v2/api/analyze.ts');

const ticker = process.argv[2] || '483650.KS';
try {
  const r = await analyzeOne(ticker);
  console.log('=== Result ===');
  console.log('ticker:', r.fundamental.ticker);
  console.log('name:', r.fundamental.name);
  console.log('price:', r.fundamental.price);
  console.log('per:', r.fundamental.per, ' pbr:', r.fundamental.pbr, ' roe:', r.fundamental.roe);
  console.log('priceBars:', r.priceBars.length);
  console.log('sma50:', r.indicators.sma50, ' sma200:', r.indicators.sma200);
  console.log('overall:', r.overallScore.score, '(', r.overallScore.level, ')');
  console.log('warnings:', r.fundamental.warnings);
} catch (e) {
  console.error('FAIL:', e.message);
  console.error(e.stack);
  process.exit(1);
}
