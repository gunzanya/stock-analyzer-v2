import type { VercelRequest, VercelResponse } from '@vercel/node';
import YahooFinance from 'yahoo-finance2';
import type { QuoteSummaryResult } from 'yahoo-finance2/modules/quoteSummary-iface';
import type {
  FundamentalData,
  QuarterlyDatum,
  AnnualDatum,
  PriceBar,
} from '../src/lib/types.js';

// v3 requires instantiation
const yahooFinance = new YahooFinance({
  suppressNotices: ['yahooSurvey', 'ripHistorical'],
});

const QUOTE_SUMMARY_MODULES = [
  'assetProfile',
  'summaryProfile',
  'summaryDetail',
  'defaultKeyStatistics',
  'financialData',
  'price',
  'earningsHistory',
  'incomeStatementHistoryQuarterly',
  'incomeStatementHistory',
  'balanceSheetHistoryQuarterly',
  'balanceSheetHistory',
] as const;

type RawNum = number | null | undefined | { raw?: number };
function num(v: RawNum): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'object' && typeof v.raw === 'number') {
    return Number.isFinite(v.raw) ? v.raw : null;
  }
  return null;
}

function dateString(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'string') return v.slice(0, 10);
  if (typeof v === 'number') return new Date(v * 1000).toISOString().slice(0, 10);
  if (v && typeof v === 'object' && 'raw' in v) {
    const raw = (v as { raw: unknown }).raw;
    if (typeof raw === 'number') return new Date(raw * 1000).toISOString().slice(0, 10);
  }
  return '';
}

async function fetchFundamental(ticker: string): Promise<FundamentalData> {
  const warnings: string[] = [];
  const upper = ticker.trim().toUpperCase();

  // Run with validateResult:false so Yahoo schema drift doesn't abort the call.
  // Then cast to the validated shape; missing fields are handled via optional chaining.
  const summaryRaw = await yahooFinance.quoteSummary(
    upper,
    { modules: [...QUOTE_SUMMARY_MODULES] },
    { validateResult: false },
  );
  const summary = summaryRaw as QuoteSummaryResult | null;

  if (!summary) {
    throw new Error(`Yahoo returned no data for ${upper}`);
  }

  const price = summary.price;
  const sd = summary.summaryDetail;
  const fd = summary.financialData;
  const ks = summary.defaultKeyStatistics;
  const ap = summary.assetProfile;
  const sp = summary.summaryProfile;

  // ----- Income statement (quarterly): primary source is now
  // fundamentalsTimeSeries(financials). The quoteSummary submodules return
  // "almost no data since Nov 2024" (Yahoo deprecation notice). Adjusted EPS
  // still comes from earningsHistory.
  const quarterly: QuarterlyDatum[] = [];
  try {
    const period1 = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
    const ftsRaw = (await yahooFinance.fundamentalsTimeSeries(
      upper,
      { period1, type: 'quarterly', module: 'financials' },
      { validateResult: false },
    )) as Array<Record<string, number | Date | undefined>>;
    if (Array.isArray(ftsRaw) && ftsRaw.length > 0) {
      // Yahoo returns oldest-first; we want newest-first.
      const ordered = [...ftsRaw].reverse().slice(0, 4);
      for (const row of ordered) {
        const date = row.date instanceof Date ? row.date.toISOString().slice(0, 10) : '';
        if (!date) continue;
        quarterly.push({
          date,
          eps: null, // filled below
          revenue: typeof row.totalRevenue === 'number' ? row.totalRevenue : null,
          operatingIncome:
            typeof row.operatingIncome === 'number' ? row.operatingIncome : null,
          netIncome: typeof row.netIncome === 'number' ? row.netIncome : null,
        });
      }
    }
  } catch (err) {
    warnings.push(`fundamentalsTimeSeries(financials) failed: ${(err as Error).message}`);
  }
  // Fallback: quoteSummary submodule (rarely populated after 2024-11)
  if (quarterly.length === 0) {
    const isq = summary.incomeStatementHistoryQuarterly?.incomeStatementHistory ?? [];
    for (const row of isq.slice(0, 4)) {
      quarterly.push({
        date: dateString(row.endDate),
        eps: null,
        revenue: num(row.totalRevenue),
        operatingIncome: num(row.operatingIncome),
        netIncome: num(row.netIncome),
      });
    }
  }

  // Merge quarterly EPS from earningsHistory (adjusted/reported EPS, which is
  // what investors use; GAAP EPS from financials TS may be skewed by one-offs).
  const eh = summary.earningsHistory?.history ?? [];
  const ehByDate = new Map<string, number | null>();
  for (const e of eh) {
    const d = dateString(e.quarter);
    if (d) ehByDate.set(d, num(e.epsActual));
  }
  for (const q of quarterly) {
    if (q.date && ehByDate.has(q.date)) q.eps = ehByDate.get(q.date) ?? null;
  }
  // Last resort: if quarterly is still empty, build from earningsHistory alone
  if (quarterly.length === 0 && eh.length > 0) {
    for (const e of eh.slice(0, 4)) {
      quarterly.push({
        date: dateString(e.quarter),
        eps: num(e.epsActual),
        revenue: null,
        operatingIncome: null,
        netIncome: null,
      });
    }
  }
  // Data-bug warnings (stage 6)
  if (quarterly.every((q) => q.revenue == null || q.revenue === 0)) {
    warnings.push('quarterly revenue all null/0 — 지주사 가능성 OR 데이터 부족');
  }
  if (quarterly.every((q) => q.operatingIncome == null)) {
    warnings.push('quarterly operatingIncome 전체 null — CYCLICAL 변동성 분석 제한');
  }

  // ----- Income statement (annual) via fundamentalsTimeSeries
  const annual: AnnualDatum[] = [];
  try {
    const period1 = new Date(Date.now() - 6 * 365 * 24 * 60 * 60 * 1000);
    const ftsRaw = (await yahooFinance.fundamentalsTimeSeries(
      upper,
      { period1, type: 'annual', module: 'financials' },
      { validateResult: false },
    )) as Array<Record<string, number | Date | undefined>>;
    if (Array.isArray(ftsRaw) && ftsRaw.length > 0) {
      const ordered = [...ftsRaw].reverse().slice(0, 5);
      for (const row of ordered) {
        const date = row.date instanceof Date ? row.date.toISOString().slice(0, 10) : '';
        if (!date) continue;
        annual.push({
          date,
          eps: typeof row.dilutedEPS === 'number' ? row.dilutedEPS : null,
          revenue: typeof row.totalRevenue === 'number' ? row.totalRevenue : null,
          netIncome: typeof row.netIncome === 'number' ? row.netIncome : null,
        });
      }
    }
  } catch (err) {
    warnings.push(`fundamentalsTimeSeries(annual financials) failed: ${(err as Error).message}`);
  }
  // Fallback to quoteSummary
  if (annual.length === 0) {
    const isa = summary.incomeStatementHistory?.incomeStatementHistory ?? [];
    for (const row of isa.slice(0, 5)) {
      annual.push({
        date: dateString(row.endDate),
        eps: null,
        revenue: num(row.totalRevenue),
        netIncome: num(row.netIncome),
      });
    }
  }

  // ----- Balance sheet via fundamentalsTimeSeries (Yahoo deprecated the
  // quoteSummary balanceSheet* submodules in Nov 2024). -----
  let totalAssets: number | null = null;
  let totalLiabilities: number | null = null;
  let cashAndShortTerm: number | null = null;
  let investmentAssets: number | null = null;
  try {
    const period1 = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    const ftsRaw = (await yahooFinance.fundamentalsTimeSeries(
      upper,
      { period1, type: 'quarterly', module: 'balance-sheet' },
      { validateResult: false },
    )) as Array<Record<string, number | Date | undefined>>;
    if (Array.isArray(ftsRaw) && ftsRaw.length > 0) {
      // Latest quarter is last in array
      const latest = ftsRaw[ftsRaw.length - 1];
      const pick = (k: string): number | null => {
        const v = latest[k];
        return typeof v === 'number' && Number.isFinite(v) ? v : null;
      };
      // Yahoo's actual field names (no "quarterly" prefix despite their docs)
      totalAssets = pick('totalAssets');
      totalLiabilities =
        pick('totalLiabilitiesNetMinorityInterest') ?? pick('totalLiab');
      const combinedCash = pick('cashCashEquivalentsAndShortTermInvestments');
      if (combinedCash != null) {
        cashAndShortTerm = combinedCash;
      } else {
        const sum =
          (pick('cashAndCashEquivalents') ?? 0) + (pick('otherShortTermInvestments') ?? 0);
        cashAndShortTerm = sum > 0 ? sum : null;
      }
      const longTermInv =
        pick('investmentsAndAdvances') ?? pick('investmentinFinancialAssets') ?? 0;
      const longTermInv2 = pick('longTermInvestments') ?? 0;
      const invSum = longTermInv + longTermInv2;
      investmentAssets = invSum > 0 ? invSum : null;
    }
  } catch (err) {
    warnings.push(`fundamentalsTimeSeries(balance-sheet) failed: ${(err as Error).message}`);
  }
  const totalEquity =
    totalAssets != null && totalLiabilities != null ? totalAssets - totalLiabilities : null;

  // ----- Valuation / profitability -----
  let pbr = num(ks?.priceToBook);
  // BRK-B and similar return absurdly small PBR (0.0009 etc.) — drop & flag.
  if (pbr != null && pbr > 0 && pbr < 0.05) {
    warnings.push(`PBR=${pbr} dropped (likely data bug)`);
    pbr = null;
  }
  if (pbr === 0) {
    warnings.push('PBR=0 (likely data bug)');
    pbr = null;
  }
  const per = num(sd?.trailingPE);
  const forwardPER = num(sd?.forwardPE) ?? num(ks?.forwardPE);
  const psr = num(sd?.priceToSalesTrailing12Months);
  const peg = num(ks?.pegRatio);
  const evToEbitda = num(ks?.enterpriseToEbitda);
  const roe = num(fd?.returnOnEquity);
  const operatingMargin = num(fd?.operatingMargins);
  const netMargin = num(fd?.profitMargins);
  const grossMargin = num(fd?.grossMargins);

  // ----- Growth -----
  let epsGrowthYoY = num(fd?.earningsGrowth);
  const revenueGrowthYoY = num(fd?.revenueGrowth);
  const epsGrowth5y = null; // not always available; defer to derived calc

  // Data-bug guard: extreme EPS growth (>1000%) is almost always a base-effect
  // artifact (e.g. EPS went from 0.01 to 1.00). Flag and cap downstream.
  if (epsGrowthYoY != null && epsGrowthYoY > 10) {
    warnings.push(
      `EPS growth ${(epsGrowthYoY * 100).toFixed(0)}% — 기저효과/일회성 가능성, FAST_GROWER 점수 캡 적용됨`,
    );
  }
  // Capture extreme negative growth too (just for transparency)
  if (epsGrowthYoY != null && epsGrowthYoY < -5) {
    warnings.push(`EPS growth ${(epsGrowthYoY * 100).toFixed(0)}% — 적자 전환/기저 효과`);
    // leave value unchanged
  }
  void epsGrowthYoY;

  // ----- Dividend -----
  const dividendYield = num(sd?.dividendYield) ?? num(sd?.trailingAnnualDividendYield);
  const payoutRatio = num(sd?.payoutRatio);

  // ----- Balance sheet ratios -----
  const debtToEquity = num(fd?.debtToEquity);

  // ----- Market cap (in quote's currency; we don't FX-normalize here) -----
  const marketCap = num(price?.marketCap) ?? num(sd?.marketCap);
  const currency = (price?.currency ?? null) as string | null;

  // ----- Short interest -----
  const shortPercentOfFloat = num(ks?.shortPercentOfFloat);
  const floatShares = num(ks?.floatShares);

  // ----- Sanity: did Yahoo return anything at all? -----
  const sectorVal = (ap?.sector ?? sp?.sector ?? null) as string | null;
  const industryVal = (ap?.industry ?? sp?.industry ?? null) as string | null;
  if (!sectorVal && !industryVal && marketCap == null && per == null) {
    warnings.push(
      `Yahoo가 핵심 데이터를 반환하지 않음 — '${upper}' 티커가 폐지/변경되었거나 잘못된 입력일 수 있음`,
    );
  }

  return {
    ticker: upper,
    name: price?.longName ?? price?.shortName ?? upper,
    exchange: (price?.exchangeName ?? null) as string | null,
    currency,
    sector: sectorVal,
    industry: industryVal,

    marketCap,
    price: num(price?.regularMarketPrice),
    pbr,
    per,
    forwardPER,
    psr,
    peg,
    evToEbitda,

    roe,
    operatingMargin,
    netMargin,
    grossMargin,

    epsGrowthYoY,
    revenueGrowthYoY,
    epsGrowth5y,

    dividendYield,
    payoutRatio,
    dividendGrowthYears: null,

    totalAssets,
    totalLiabilities,
    totalEquity,
    cashAndShortTerm,
    investmentAssets,
    debtToEquity,

    quarterly,
    annual,

    shortPercentOfFloat,
    floatShares,

    fetchedAt: new Date().toISOString(),
    warnings,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ticker =
    (req.query.ticker as string | undefined) ??
    (req.query.symbol as string | undefined);
  if (!ticker) {
    return res.status(400).json({ error: 'missing ?ticker=' });
  }
  try {
    const data = await fetchFundamental(ticker);
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json(data);
  } catch (err) {
    return res.status(502).json({
      error: 'fetch_failed',
      message: (err as Error).message,
      ticker,
    });
  }
}

/** Fetch daily OHLCV bars for the last `days` calendar days (default 400 — ~1y trading). */
async function fetchPriceHistory(
  ticker: string,
  days = 400,
): Promise<PriceBar[]> {
  const upper = ticker.trim().toUpperCase();
  const period1 = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const out = (await yahooFinance.chart(
    upper,
    { period1, interval: '1d' },
    { validateResult: false },
  )) as { quotes?: Array<Record<string, unknown>> } | null;

  const quotes = out?.quotes ?? [];
  const bars: PriceBar[] = [];
  for (const q of quotes) {
    const close =
      (q.adjclose as number | undefined) ?? (q.close as number | undefined);
    if (typeof close !== 'number' || !Number.isFinite(close)) continue;
    const date =
      q.date instanceof Date
        ? q.date.toISOString().slice(0, 10)
        : typeof q.date === 'string'
          ? q.date.slice(0, 10)
          : '';
    if (!date) continue;
    bars.push({
      date,
      open: (q.open as number) ?? null,
      high: (q.high as number) ?? null,
      low: (q.low as number) ?? null,
      close,
      volume: (q.volume as number) ?? null,
    });
  }
  // Yahoo returns oldest-first; we want newest-first for indicator math.
  return bars.reverse();
}

/** Latest USD/KRW spot from Yahoo Finance, or null on failure. */
async function fetchUsdKrwRate(): Promise<number | null> {
  try {
    const q = (await yahooFinance.quote('USDKRW=X', {}, { validateResult: false })) as
      | { regularMarketPrice?: number }
      | null;
    const r = q?.regularMarketPrice;
    if (typeof r === 'number' && Number.isFinite(r) && r > 0) return r;
  } catch {
    // fall through
  }
  try {
    const out = (await yahooFinance.chart(
      'USDKRW=X',
      {
        period1: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        interval: '1d',
      },
      { validateResult: false },
    )) as { quotes?: Array<{ close?: number }> } | null;
    const quotes = out?.quotes ?? [];
    for (let i = quotes.length - 1; i >= 0; i--) {
      const c = quotes[i].close;
      if (typeof c === 'number' && Number.isFinite(c) && c > 0) return c;
    }
  } catch {
    // ignore
  }
  return null;
}

export { fetchFundamental, fetchPriceHistory, fetchUsdKrwRate };
