import type { VercelRequest, VercelResponse } from '@vercel/node';
import YahooFinance from 'yahoo-finance2';
import type { QuoteSummaryResult } from 'yahoo-finance2/modules/quoteSummary-iface';
import type {
  FundamentalData,
  QuarterlyDatum,
  AnnualDatum,
  PriceBar,
  SupplyDemandData,
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
  const debtToEquityHistory: { date: string; ratio: number }[] = [];
  try {
    // ~2 years to give the D/E trend a few data points.
    const period1 = new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000);
    const ftsRaw = (await yahooFinance.fundamentalsTimeSeries(
      upper,
      { period1, type: 'quarterly', module: 'balance-sheet' },
      { validateResult: false },
    )) as Array<Record<string, number | Date | undefined>>;
    if (Array.isArray(ftsRaw) && ftsRaw.length > 0) {
      // Yahoo returns oldest-first; latest is last.
      const latest = ftsRaw[ftsRaw.length - 1];
      const pickFrom = (row: Record<string, number | Date | undefined>, k: string): number | null => {
        const v = row[k];
        return typeof v === 'number' && Number.isFinite(v) ? v : null;
      };
      const pick = (k: string) => pickFrom(latest, k);
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

      // Newest-first D/E history (totalLiabilities / totalEquity)
      for (let i = ftsRaw.length - 1; i >= 0 && debtToEquityHistory.length < 6; i--) {
        const row = ftsRaw[i];
        const liab =
          pickFrom(row, 'totalLiabilitiesNetMinorityInterest') ??
          pickFrom(row, 'totalLiab');
        const assets = pickFrom(row, 'totalAssets');
        if (liab == null || assets == null) continue;
        const equity = assets - liab;
        if (equity <= 0) continue;
        const date = row.date instanceof Date ? row.date.toISOString().slice(0, 10) : '';
        if (!date) continue;
        debtToEquityHistory.push({ date, ratio: liab / equity });
      }
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
  const trailingAnnualDividendRate = num(sd?.trailingAnnualDividendRate);
  const trailingEps = num(ks?.trailingEps);

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

  const out: FundamentalData = {
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
    trailingAnnualDividendRate,
    trailingEps,

    totalAssets,
    totalLiabilities,
    totalEquity,
    cashAndShortTerm,
    investmentAssets,
    debtToEquity,
    debtToEquityHistory,

    quarterly,
    annual,

    shortPercentOfFloat,
    floatShares,

    fetchedAt: new Date().toISOString(),
    warnings,
  };

  // For .KS / .KQ tickers, fill any null Yahoo fields from Naver (HTML
  // scrape, 5s timeout, graceful failure). Yahoo always wins when present.
  if (/\.(KS|KQ)$/i.test(upper)) {
    const nv = await fetchNaverData(upper);
    if (nv) {
      if (out.per == null && nv.per != null) out.per = nv.per;
      if (out.pbr == null && nv.pbr != null) out.pbr = nv.pbr;
      if (out.trailingEps == null && nv.eps != null) out.trailingEps = nv.eps;
      if (out.dividendYield == null && nv.dividendYield != null) {
        out.dividendYield = nv.dividendYield;
      }
      if (out.marketCap == null && nv.marketCapKrw != null) {
        out.marketCap = nv.marketCapKrw;
      }
      if (out.roe == null && nv.roe != null) out.roe = nv.roe;
      if (out.operatingMargin == null && nv.operatingMargin != null) {
        out.operatingMargin = nv.operatingMargin;
      }
    }
  }

  return out;
}

// ---- Naver Finance fallback for Korean tickers --------------------------

interface NaverData {
  per: number | null;
  pbr: number | null;
  eps: number | null;            // native KRW per share
  dividendYield: number | null;  // fraction (Naver shows %, we divide by 100)
  marketCapKrw: number | null;   // raw KRW
  roe: number | null;            // fraction
  operatingMargin: number | null; // fraction
}

const NAVER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

function parseNumeric(s: string | null): number | null {
  if (!s) return null;
  const cleaned = s.replace(/[,\s%]/g, '').replace(/<[^>]+>/g, '');
  if (!/[\d.-]/.test(cleaned)) return null;
  const v = parseFloat(cleaned);
  return Number.isFinite(v) ? v : null;
}

/** Grab the text inside <em id="X">…</em>. Strips inner tags + whitespace. */
function grabEmById(html: string, id: string): string | null {
  const m = html.match(new RegExp(`id="${id}"[^>]*>([\\s\\S]*?)</em>`, 'i'));
  if (!m) return null;
  return m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

/** Find a 기업실적분석 row by its <strong>label</strong> and return the last
 *  numeric <td> value. Returns null if the row or any number can't be found. */
function lastTdInRow(html: string, label: string): number | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const row = html.match(
    new RegExp(`<tr[^>]*>[^<]*<th[^>]*>[^<]*<strong>${escaped}[^<]*</strong>[\\s\\S]*?</tr>`, 'i'),
  );
  if (!row) return null;
  const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/g;
  let last: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = tdRe.exec(row[0])) != null) {
    const txt = m[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
    if (txt && txt !== '-' && /-?\d/.test(txt)) last = txt;
  }
  return parseNumeric(last);
}

/** Scrape PER/PBR/EPS/dividend yield/marketCap (+ best-effort ROE & op
 *  margin) from Naver Finance for a Korean ticker. Returns null on any
 *  failure so callers can fall back to whatever they already had. */
async function fetchNaverData(ticker: string): Promise<NaverData | null> {
  const code = ticker.replace(/\.(KS|KQ)$/i, '');
  if (!/^\d{6}$/.test(code)) return null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  let html: string;
  try {
    const res = await fetch(
      `https://finance.naver.com/item/main.naver?code=${code}`,
      {
        signal: ctrl.signal,
        headers: { 'User-Agent': NAVER_UA, Accept: 'text/html' },
      },
    );
    if (!res.ok) return null;
    html = await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }

  const per = parseNumeric(grabEmById(html, '_per'));
  const pbr = parseNumeric(grabEmById(html, '_pbr'));
  const eps = parseNumeric(grabEmById(html, '_eps'));
  const dvrPct = parseNumeric(grabEmById(html, '_dvr'));

  // marketCap: "1,613조 5,729" inside <em id="_market_sum"> with suffix 억원
  let marketCapKrw: number | null = null;
  const msRaw = grabEmById(html, '_market_sum');
  if (msRaw) {
    const cleaned = msRaw.replace(/,/g, '');
    const joMatch = cleaned.match(/(\d+)\s*조/);
    const afterJo = cleaned.includes('조')
      ? cleaned.split('조')[1]?.match(/(\d+)/)?.[1]
      : cleaned.match(/^(\d+)$/)?.[1];
    let eok = 0;
    if (joMatch) eok += Number(joMatch[1]) * 10000; // 1조 = 10000억
    if (afterJo) eok += Number(afterJo);
    if (eok > 0) marketCapKrw = eok * 1e8; // 억원 → 원
  }

  // ROE / operating margin: in the 기업실적분석 table — best-effort row scrape.
  // The row has multiple <td>s (annual + quarterly columns). The rightmost
  // non-empty cell is the most recent estimate.
  const roePct = lastTdInRow(html, 'ROE(지배주주)');
  const opMarginPct = lastTdInRow(html, '영업이익률');

  return {
    per,
    pbr,
    eps,
    dividendYield: dvrPct != null ? dvrPct / 100 : null,
    marketCapKrw,
    roe: roePct != null ? roePct / 100 : null,
    operatingMargin: opMarginPct != null ? opMarginPct / 100 : null,
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

// ---- Naver daily price history for Korean tickers -----------------------

/** Fetch daily OHLCV from Naver's chart JSON API.
 *  Returns newest-first PriceBar[], same contract as the Yahoo path.
 *  Falls back to Yahoo if Naver fails. */
async function fetchNaverPriceHistory(
  ticker: string,
  days = 400,
): Promise<PriceBar[]> {
  const code = ticker.replace(/\.(KS|KQ)$/i, '');
  if (!/^\d{6}$/.test(code)) return fetchYahooPriceHistory(ticker, days);

  const end = new Date();
  const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) =>
    `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const url =
      `https://fchart.stock.naver.com/siseJson.nhn?symbol=${code}` +
      `&requestType=1&startTime=${fmt(start)}&endTime=${fmt(end)}&timeframe=day`;
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': NAVER_UA, Accept: '*/*' },
    });
    if (!res.ok) throw new Error(`Naver chart HTTP ${res.status}`);
    const text = await res.text();

    // Response is JS array literal (not strict JSON): parse with eval-safe regex.
    // Each row: ["20260521", 65000, 65500, 64200, 65300, 1234567, 48.5]
    const rowRe = /\["(\d{8})",\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)/g;
    const bars: PriceBar[] = [];
    let m: RegExpExecArray | null;
    while ((m = rowRe.exec(text)) != null) {
      const dateStr = m[1];
      const date = `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
      const open = Number(m[2]);
      const high = Number(m[3]);
      const low = Number(m[4]);
      const close = Number(m[5]);
      const volume = Number(m[6]);
      if (!Number.isFinite(close) || close <= 0) continue;
      bars.push({ date, open, high, low, close, volume });
    }

    if (bars.length < 50) {
      throw new Error(`Naver returned only ${bars.length} bars for ${code}`);
    }

    // Naver returns oldest-first; reverse to newest-first.
    bars.reverse();
    return bars;
  } catch {
    // Naver failed — fall back to Yahoo.
    return fetchYahooPriceHistory(ticker, days);
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch daily OHLCV bars from Yahoo Finance. */
async function fetchYahooPriceHistory(
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

/** Strip an in-progress intraday bar from the front of a newest-first
 *  bar array. The heuristic: if the latest bar's volume is below 50% of
 *  the trailing 50-day average, it's likely a partial session captured
 *  mid-day. Removing it prevents ADX/RSI/EMA from being skewed by an
 *  incomplete candle. Returns the (possibly trimmed) array plus a
 *  human-readable log string. */
function stripIntradayBar(bars: PriceBar[], ticker: string): { bars: PriceBar[]; log: string } {
  if (bars.length < 52) {
    const b = bars[0];
    const log = `[${ticker}] 마지막 봉 ${b?.date ?? '?'}, 종가 ${b?.close?.toLocaleString() ?? '?'}, 거래량 ${b?.volume?.toLocaleString() ?? '?'} (봉 ${bars.length}개, 인트라데이 필터 생략 — 데이터 부족)`;
    return { bars, log };
  }
  const latest = bars[0];
  const vol = latest?.volume;
  if (vol == null) {
    const log = `[${ticker}] 마지막 봉 ${latest?.date ?? '?'}, 종가 ${latest?.close?.toLocaleString() ?? '?'}, 거래량 없음 (필터 생략)`;
    return { bars, log };
  }
  const window = bars.slice(1, 51).map((b) => b.volume).filter((v): v is number => v != null);
  if (window.length < 25) {
    const log = `[${ticker}] 마지막 봉 ${latest.date}, 종가 ${latest.close.toLocaleString()}, 거래량 ${vol.toLocaleString()} (비교 데이터 부족, 필터 생략)`;
    return { bars, log };
  }
  const avg50 = window.reduce((a, b) => a + b, 0) / window.length;
  const ratio = vol / avg50;
  if (ratio < 0.5) {
    const trimmed = bars.slice(1);
    const prev = trimmed[0];
    const log = `[${ticker}] 장중 미완성봉 제거: ${latest.date} 거래량 ${vol.toLocaleString()} (50일 평균 ${Math.round(avg50).toLocaleString()}의 ${(ratio * 100).toFixed(0)}%) → 마지막 봉 ${prev?.date ?? '?'}, 종가 ${prev?.close?.toLocaleString() ?? '?'}, 거래량 ${prev?.volume?.toLocaleString() ?? '?'}`;
    return { bars: trimmed, log };
  }
  const log = `[${ticker}] 마지막 봉 ${latest.date}, 종가 ${latest.close.toLocaleString()}, 거래량 ${vol.toLocaleString()} (50일 평균 ${Math.round(avg50).toLocaleString()}의 ${(ratio * 100).toFixed(0)}% — 완성봉 판정)`;
  return { bars, log };
}

/** Fetch daily OHLCV bars for the last `days` calendar days (default 400).
 *  Korean tickers (.KS/.KQ) use Naver chart API; all others use Yahoo.
 *  An intraday partial bar (volume < 50% of 50-day avg) is stripped so all
 *  downstream indicators compute on completed candles only. */
async function fetchPriceHistory(
  ticker: string,
  days = 400,
): Promise<PriceBar[]> {
  const upper = ticker.trim().toUpperCase();
  const raw = /\.(KS|KQ)$/i.test(upper)
    ? await fetchNaverPriceHistory(upper, days)
    : await fetchYahooPriceHistory(upper, days);
  const { bars, log } = stripIntradayBar(raw, upper);
  console.log(log);
  return bars;
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

// ---- Dynamic pool builder (Yahoo screener) -----------------------------

export type ScreenerFilter = 'all' | 'large_cap' | 'small_mid' | 'tech' | 'breakout' | 'kr';

interface ScreenerHit {
  symbol: string;
  marketCap: number | null;
  quoteType: string | null;
  name: string | null;
}

/** True when the candidate is clearly a fund/ETF/trust rather than a
 *  single-company equity. The screener mixes these in (especially via
 *  most_actives), and we only want individual stocks. */
function looksLikeFund(h: ScreenerHit): boolean {
  const qt = (h.quoteType ?? '').toUpperCase();
  if (qt === 'MUTUALFUND' || qt === 'ETF') return true;
  // Mutual fund tickers tend to be 5+ chars ending in X (FXAIX, PRUIX).
  if (h.symbol.length >= 5 && /X$/.test(h.symbol)) return true;
  // Name-based heuristics catch closed-end funds, trusts, and SPDR/iShares
  // products that don't always report quoteType=ETF.
  if (h.name && /\b(Index|Fund|ETF|Trust)\b/i.test(h.name)) return true;
  return false;
}

type ScrId = Parameters<typeof yahooFinance.screener>[0] extends infer T
  ? T extends string
    ? T
    : never
  : never;

// Map our filter modes to Yahoo's predefined scrIds. Multiple scrIds per
// mode get merged + deduped to widen the pool beyond a single screen's
// ~25 results. `all` unions every scrId we use anywhere.
const ALL_SCR_IDS: ScrId[] = [
  'most_actives',
  'day_gainers',
  'day_losers',
  'undervalued_large_caps',
  'portfolio_anchors',
  'small_cap_gainers',
  'aggressive_small_caps',
  'undervalued_growth_stocks',
  'growth_technology_stocks',
];

const SCR_IDS: Record<ScreenerFilter, ScrId[]> = {
  all: ALL_SCR_IDS,
  // Breakout filter uses the broadest pool — the per-ticker breakout
  // criteria (ADX 15-25, fundamentals 70+, etc.) are evaluated client-side
  // on a flag set by the server, so pool size is the only thing to pick here.
  breakout: ALL_SCR_IDS,
  large_cap: ['undervalued_large_caps', 'portfolio_anchors', 'most_actives'],
  small_mid: ['small_cap_gainers', 'aggressive_small_caps', 'undervalued_growth_stocks'],
  tech: ['growth_technology_stocks'],
  kr: [],
};

/** Pull tickers from Yahoo's predefined screeners, merged + deduped.
 *  Optionally enforces a min/max market cap. Returns plain ticker symbols. */
async function fetchScreenerPool(
  filter: ScreenerFilter,
  opts: { minMarketCap?: number; maxMarketCap?: number; count?: number } = {},
): Promise<string[]> {
  const scrIds = SCR_IDS[filter];
  const count = opts.count ?? 100;
  const results = await Promise.all(
    scrIds.map(async (scrId) => {
      try {
        // Yahoo's screener payload schema sometimes drifts; the data is
        // fine but strict validation rejects it. Disable validation here.
        const r = (await yahooFinance.screener(
          { scrIds: scrId, count },
          undefined,
          { validateResult: false },
        )) as {
          quotes?: {
            symbol?: string;
            marketCap?: number | null;
            quoteType?: string | null;
            longName?: string | null;
            shortName?: string | null;
          }[];
        };
        const qs = r.quotes ?? [];
        return qs
          .filter((q) => typeof q.symbol === 'string' && q.symbol.length > 0)
          .map((q) => ({
            symbol: q.symbol as string,
            marketCap: typeof q.marketCap === 'number' ? q.marketCap : null,
            quoteType: q.quoteType ?? null,
            name: q.longName ?? q.shortName ?? null,
          })) as ScreenerHit[];
      } catch {
        return [] as ScreenerHit[];
      }
    }),
  );

  // Dedupe by symbol, keep the first marketCap we see.
  const seen = new Map<string, ScreenerHit>();
  for (const list of results) {
    for (const hit of list) {
      if (!hit.symbol) continue;
      if (!seen.has(hit.symbol)) seen.set(hit.symbol, hit);
    }
  }

  const filtered = Array.from(seen.values()).filter((h) => {
    if (opts.minMarketCap != null) {
      if (h.marketCap == null || h.marketCap < opts.minMarketCap) return false;
    }
    if (opts.maxMarketCap != null) {
      if (h.marketCap == null || h.marketCap >= opts.maxMarketCap) return false;
    }
    // Skip preferreds / warrants — Yahoo sometimes leaks these into screens
    if (/[.-]P[A-Z]?$|\.WS$|\.W$|^_/.test(h.symbol)) return false;
    // Skip mutual funds / ETFs / trusts — we screen individual equities only
    if (looksLikeFund(h)) return false;
    return true;
  });

  return filtered.map((h) => h.symbol);
}

// ---- Naver supply/demand (외국인·기관 수급) for Korean tickers ----

interface FrgnRow {
  date: string;
  close: number;
  instShares: number;   // 기관 순매매 (주)
  frgnShares: number;   // 외국인 순매매 (주)
}

function parseSignedInt(s: string): number {
  const cleaned = s.replace(/[,\s+]/g, '');
  if (!/^-?\d+$/.test(cleaned)) return 0;
  return parseInt(cleaned, 10);
}

async function fetchNaverSupplyDemand(
  ticker: string,
): Promise<SupplyDemandData | null> {
  const code = ticker.replace(/\.(KS|KQ)$/i, '');
  if (!/^\d{6}$/.test(code)) return null;

  const rows: FrgnRow[] = [];
  for (const page of [1, 2]) {
    if (rows.length >= 20) break;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    try {
      const res = await fetch(
        `https://finance.naver.com/item/frgn.naver?code=${code}&page=${page}`,
        {
          signal: ctrl.signal,
          headers: { 'User-Agent': NAVER_UA, Accept: 'text/html' },
        },
      );
      if (!res.ok) break;
      const buf = Buffer.from(await res.arrayBuffer());
      const html = buf.toString('latin1')
        .replace(/[\x80-\xff]/g, (ch) => {
          const code = ch.charCodeAt(0);
          return `&#${code};`;
        });

      const tableMatch = html.match(
        /<table[^>]*class="type2"[^>]*>([\s\S]*?)<\/table>/g,
      );
      const target = tableMatch?.[1] ?? tableMatch?.[0];
      if (!target) break;
      parseTableRows(target, rows);
    } catch {
      break;
    } finally {
      clearTimeout(timer);
    }
  }

  if (rows.length < 3) return null;

  const slice5 = rows.slice(0, Math.min(5, rows.length));
  const slice20 = rows.slice(0, Math.min(20, rows.length));

  const toEok = (shares: number, close: number) => (shares * close) / 1e8;

  const foreign5d = slice5.reduce((s, r) => s + toEok(r.frgnShares, r.close), 0);
  const foreign20d = slice20.reduce((s, r) => s + toEok(r.frgnShares, r.close), 0);
  const institution5d = slice5.reduce((s, r) => s + toEok(r.instShares, r.close), 0);
  const institution20d = slice20.reduce((s, r) => s + toEok(r.instShares, r.close), 0);

  let consecutiveForeignBuy = 0;
  if (rows[0].frgnShares > 0) {
    for (const r of rows) {
      if (r.frgnShares > 0) consecutiveForeignBuy++;
      else break;
    }
  } else if (rows[0].frgnShares < 0) {
    for (const r of rows) {
      if (r.frgnShares < 0) consecutiveForeignBuy--;
      else break;
    }
  }

  let consecutiveInstBuy = 0;
  if (rows[0].instShares > 0) {
    for (const r of rows) {
      if (r.instShares > 0) consecutiveInstBuy++;
      else break;
    }
  } else if (rows[0].instShares < 0) {
    for (const r of rows) {
      if (r.instShares < 0) consecutiveInstBuy--;
      else break;
    }
  }

  return {
    foreign5d: Math.round(foreign5d),
    foreign20d: Math.round(foreign20d),
    institution5d: Math.round(institution5d),
    institution20d: Math.round(institution20d),
    consecutiveForeignBuy,
    consecutiveInstBuy,
    dailyRows: rows.length,
  };
}

function parseTableRows(tableHtml: string, out: FrgnRow[]): void {
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(tableHtml)) != null) {
    const tds: string[] = [];
    const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/g;
    let td: RegExpExecArray | null;
    while ((td = tdRe.exec(m[1])) != null) {
      tds.push(td[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim());
    }
    if (tds.length < 7) continue;
    const dateStr = tds[0].trim();
    if (!/^\d{4}\.\d{2}\.\d{2}$/.test(dateStr)) continue;
    const close = parseSignedInt(tds[1]);
    if (close <= 0) continue;
    const instShares = parseSignedInt(tds[5]);
    const frgnShares = parseSignedInt(tds[6]);
    out.push({ date: dateStr, close, instShares, frgnShares });
  }
}

export {
  fetchFundamental,
  fetchPriceHistory,
  fetchUsdKrwRate,
  fetchScreenerPool,
  fetchNaverData,
  fetchNaverSupplyDemand,
};
