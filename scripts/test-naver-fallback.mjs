// Verify Naver fallback for .KS tickers — show what Yahoo had vs. what
// the merged FundamentalData ends up with.
// Usage: npx tsx scripts/test-naver-fallback.mjs

import { fetchFundamental, fetchNaverData } from '../api/fetchStock.ts';

const TICKERS = [
  ['005930.KS', '삼성전자'],
  ['000660.KS', '하이닉스'],
  ['003230.KS', '삼양식품'],
];

function fmt(v) {
  if (v == null) return 'null'.padStart(8);
  if (typeof v === 'number') {
    if (Math.abs(v) >= 1e9) return `${(v / 1e12).toFixed(2)}T`.padStart(8);
    if (Math.abs(v) < 0.01 && v !== 0) return v.toExponential(2).padStart(8);
    return v.toFixed(2).padStart(8);
  }
  return String(v).padStart(8);
}

for (const [ticker, label] of TICKERS) {
  console.log(`\n=== ${ticker} (${label}) ===`);
  // First, what does Naver scraper return on its own?
  const naver = await fetchNaverData(ticker);
  console.log(
    `  Naver scraped:  per=${fmt(naver?.per)}  pbr=${fmt(naver?.pbr)}  ` +
      `eps=${fmt(naver?.eps)}  divY=${fmt(naver?.dividendYield)}  ` +
      `mcap=${fmt(naver?.marketCapKrw)}  roe=${fmt(naver?.roe)}  ` +
      `opMargin=${fmt(naver?.operatingMargin)}`,
  );
  // Then what the full merged result looks like
  const fund = await fetchFundamental(ticker);
  console.log(
    `  Final merged:   per=${fmt(fund.per)}  pbr=${fmt(fund.pbr)}  ` +
      `eps=${fmt(fund.trailingEps)}  divY=${fmt(fund.dividendYield)}  ` +
      `mcap=${fmt(fund.marketCap)}  roe=${fmt(fund.roe)}  ` +
      `opMargin=${fmt(fund.operatingMargin)}`,
  );
  await new Promise((r) => setTimeout(r, 500));
}
