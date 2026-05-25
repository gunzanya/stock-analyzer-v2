// Expand src/lib/krStocks.ts with the top KOSPI + KOSDAQ tickers from
// Naver Finance's market-cap rankings. Preserves the existing list
// (existing names win), adds new tickers with names scraped from Naver,
// and cross-checks each new entry against KRX to drop anything that no
// longer resolves.
//
// Usage: node scripts/expand-kr-stocks.mjs [pagesPerMarket]
//   pagesPerMarket default = 15 (≈750 entries / market, ~50 per page)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const SRC = new URL('../src/lib/krStocks.ts', import.meta.url);
const PAGES = Number(process.argv[2] ?? 15);
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

// ------------------------------------------------------------ KRX roster
function ensureRoster(market, suffix) {
  const xls = `/tmp/krx-${suffix}.xls`;
  const html = `/tmp/krx-${suffix}.html`;
  if (!existsSync(html)) {
    execSync(
      `curl -s "https://kind.krx.co.kr/corpgeneral/corpList.do?method=download&searchType=13&marketType=${market}" -o ${xls} && ` +
        `iconv -f EUC-KR -t UTF-8 ${xls} -o ${html}`,
    );
  }
  return readFileSync(html, 'utf8');
}

function parseRoster(html, market) {
  const rowRe = /<tr>([\s\S]*?)<\/tr>/g;
  const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/g;
  const out = new Map();
  for (const r of html.matchAll(rowRe)) {
    const cells = [];
    for (const c of r[1].matchAll(cellRe)) {
      cells.push(c[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim());
    }
    if (cells.length < 3) continue;
    const code = cells[2].replace(/\D/g, '').padStart(6, '0');
    if (!/^\d{6}$/.test(code)) continue;
    out.set(code, { name: cells[0], market });
  }
  return out;
}

console.error('Loading KRX rosters…');
const kospi = parseRoster(ensureRoster('stockMkt', 'kospi'), 'KS');
const kosdaq = parseRoster(ensureRoster('kosdaqMkt', 'kosdaq'), 'KQ');
console.error(`  KOSPI: ${kospi.size}, KOSDAQ: ${kosdaq.size}`);

// ------------------------------------------------------- Naver scraping
const ENTRY_RE = /item\/main\.naver\?code=(\d{6})"[^>]*class="tltle"[^>]*>([^<]+)/g;

async function fetchNaverPage(sosok, page) {
  const url = `https://finance.naver.com/sise/sise_market_sum.naver?sosok=${sosok}&page=${page}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  // Naver returns EUC-KR; decode via Node's iconv-free path: spawn iconv.
  // Simpler: write to /tmp + iconv.
  const tmp = `/tmp/naver-p-${sosok}-${page}.html`;
  writeFileSync(tmp, buf);
  const html = execSync(`iconv -f EUC-KR -t UTF-8 ${tmp}`).toString();
  const rows = [];
  for (const m of html.matchAll(ENTRY_RE)) {
    rows.push({ code: m[1], name: m[2].trim() });
  }
  return rows;
}

const naverHits = new Map(); // code -> { name, market }
for (const [sosok, market] of [[0, 'KS'], [1, 'KQ']]) {
  console.error(`Scraping ${market} (sosok=${sosok}) — ${PAGES} pages…`);
  for (let p = 1; p <= PAGES; p++) {
    const rows = await fetchNaverPage(sosok, p);
    if (rows.length === 0) {
      console.error(`  page ${p}: 0 entries — stopping`);
      break;
    }
    for (const r of rows) {
      if (!naverHits.has(r.code)) naverHits.set(r.code, { name: r.name, market });
    }
    console.error(`  page ${p}: +${rows.length} (total ${naverHits.size})`);
    await sleep(120);
  }
}

// ------------------------------------------------------ Existing entries
const existing = readFileSync(SRC, 'utf8');
const existingRe = /\{ ticker: '(\d{6})\.(KS|KQ)', name: '([^']*)' \}/g;
const existingMap = new Map(); // code -> { market, name }
for (const m of existing.matchAll(existingRe)) {
  existingMap.set(m[1], { market: m[2], name: m[3] });
}
console.error(`Existing entries: ${existingMap.size}`);

// Brand-name overrides — keep popular short names over KRX legal names.
const BRAND_NAME = new Map([
  ['005380', '현대차'],
  ['000810', '삼성화재'],
  ['015760', '한국전력'],
  ['030200', 'KT'],
  ['033780', 'KT&G'],
  ['326030', 'SK바이오팜'],
  ['002380', 'KCC'],
  ['010120', 'LS일렉트릭'],
  ['009070', 'KCTC'],
  ['298380', 'ABL바이오'],
]);

// Tickers KIND excludes (preferred shares, etc) the existing roster covers.
const SPECIAL = new Map([
  ['005935', { name: '삼성전자우', market: 'KS' }],
  ['005385', { name: '현대차우', market: 'KS' }],
  ['005387', { name: '현대차2우B', market: 'KS' }],
  ['006405', { name: '삼성SDI우', market: 'KS' }],
  ['078935', { name: 'GS우', market: 'KS' }],
]);

// ------------------------------------------------------------ Build list
const finalMap = new Map(); // code -> { market, name }

// 1) keep all existing entries as-is (names already curated)
for (const [code, info] of existingMap) {
  finalMap.set(code, info);
}

// 2) add new tickers from Naver, validated against KRX
let added = 0;
let skipped = 0;
for (const [code, hit] of naverHits) {
  if (finalMap.has(code)) continue;

  // Validate against KRX roster + special table; if neither knows it, skip.
  const krx = kospi.get(code) ?? kosdaq.get(code) ?? SPECIAL.get(code);
  if (!krx) {
    skipped++;
    continue;
  }
  const market = krx.market;
  const name = BRAND_NAME.get(code) ?? hit.name;
  finalMap.set(code, { market, name });
  added++;
}

console.error(`\nAdded ${added} new entries, skipped ${skipped} not in KRX roster.`);

// Sanity check expected popular names exist.
for (const code of ['278470', '096530']) {
  const info = finalMap.get(code);
  console.error(`  ${code}: ${info ? `${info.name} (.${info.market})` : 'MISSING'}`);
}

// ----------------------------------------------------------------- Sort + write
const finalList = [...finalMap.entries()].map(([code, info]) => ({
  code,
  market: info.market,
  name: info.name,
}));
finalList.sort((a, b) => {
  if (a.market !== b.market) return a.market === 'KS' ? -1 : 1;
  return a.code.localeCompare(b.code);
});

const header = `// KOSPI + KOSDAQ market-cap-ranked tickers — static list for the
// Korean market screener + name search/autocomplete.
//   .KS = KOSPI (Korea Exchange main board)
//   .KQ = KOSDAQ (Korea Exchange tech/growth board)
//
// Names verified against KRX (kind.krx.co.kr) listed-companies roster +
// Naver Finance market-cap rankings. Last refreshed: 2026-05-25

export interface KrStock {
  readonly ticker: string;
  readonly name: string;
}

export const KR_STOCKS: readonly KrStock[] = [
`;

const body = finalList
  .map(e => `  { ticker: '${e.code}.${e.market}', name: '${e.name}' },`)
  .join('\n');

const footer = `
];

// Ticker-only list for screener backward compatibility
export const KR_TICKERS: readonly string[] = KR_STOCKS.map(s => s.ticker);
`;

writeFileSync(SRC, header + body + footer);
console.error(`\nWrote ${finalList.length} entries to ${SRC.pathname}`);
