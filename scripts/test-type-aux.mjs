// Spot-check new fundamentals fields used by TypeAuxCard.
import { fetchFundamental } from '../api/fetchStock.ts';

const tickers = ['KO', 'F', 'BRK-B', 'INTC', '005930.KS'];
for (const t of tickers) {
  try {
    const f = await fetchFundamental(t);
    const payoutComputed =
      f.trailingAnnualDividendRate != null &&
      f.trailingEps != null &&
      f.trailingEps > 0
        ? f.trailingAnnualDividendRate / f.trailingEps
        : null;
    const lastQ = f.quarterly[0];
    const histStr =
      f.debtToEquityHistory.length > 0
        ? f.debtToEquityHistory
            .map((h) => `${h.date}=${(h.ratio * 100).toFixed(0)}%`)
            .join(' / ')
        : '(none)';
    console.log(
      `${t.padEnd(11)} | div${f.dividendYield != null ? (f.dividendYield * 100).toFixed(2) + '%' : '—'} ` +
        `| rate=${f.trailingAnnualDividendRate ?? '—'} eps=${f.trailingEps ?? '—'} ` +
        `| payout(comp)=${payoutComputed != null ? (payoutComputed * 100).toFixed(0) + '%' : '—'} ` +
        `(yahoo=${f.payoutRatio != null ? (f.payoutRatio * 100).toFixed(0) + '%' : '—'})\n` +
        `            | PER=${f.per ?? '—'} fwdPER=${f.forwardPER ?? '—'} PBR=${f.pbr ?? '—'}\n` +
        `            | lastQ EPS=${lastQ?.eps ?? '—'} (${lastQ?.date ?? '—'})\n` +
        `            | D/E history: ${histStr}`,
    );
  } catch (e) {
    console.log(`${t} FAILED: ${e.message}`);
  }
}
