// Rewrite src/lib/krStocks.ts using KRX-canonical names, with a handful
// of curated "popular brand name" overrides (so we keep KT instead of
// 케이티, KCC instead of 케이씨씨, etc.). Cross-checks every ticker
// against the latest KOSPI + KOSDAQ rosters and removes tickers that
// no longer resolve on either Naver Finance or KRX.
//
// Usage: node scripts/rewrite-kr-stocks.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const SRC = new URL('../src/lib/krStocks.ts', import.meta.url);

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
    const name = cells[0];
    const code = cells[2].replace(/\D/g, '').padStart(6, '0');
    if (!/^\d{6}$/.test(code)) continue;
    out.set(code, { name, market });
  }
  return out;
}

const kospi = parseRoster(ensureRoster('stockMkt', 'kospi'), 'KS');
const kosdaq = parseRoster(ensureRoster('kosdaqMkt', 'kosdaq'), 'KQ');
const konex = parseRoster(ensureRoster('konexMkt', 'konex'), 'KX');

function lookup(code, market) {
  // Same 6-digit code can appear in both rosters because KRX reuses codes
  // after delisting. Prefer the suffix the caller asked for.
  if (market === 'KS') return kospi.get(code) ?? kosdaq.get(code);
  return kosdaq.get(code) ?? kospi.get(code);
}

// Naver fallback for ETFs / preferred shares / KONEX-only listings that
// the KIND roster excludes.
async function fetchNaverName(code) {
  const url = `https://finance.naver.com/item/main.naver?code=${code}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
    },
  });
  if (!res.ok) return null;
  const html = await res.text();
  const m = html.match(/<title>([^<]+?)\s*:/);
  if (!m) return null;
  const name = m[1].trim();
  if (['네이버페이 증권', 'Npay 증권', '네이버 증권'].includes(name)) return null;
  return name;
}

// Keep the popular short brand name when KRX has the long legal name.
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
  ['298380', 'ABL바이오'],  // Naver displays as ABL바이오 too
]);

// Tickers KIND excludes (ETFs, preferred shares, etc) — manually curated.
const SPECIAL = new Map([
  ['005935', { name: '삼성전자우', market: 'KS' }],
  ['005385', { name: '현대차우', market: 'KS' }],
  ['005387', { name: '현대차2우B', market: 'KS' }],
  ['006405', { name: '삼성SDI우', market: 'KS' }],
  ['078935', { name: 'GS우', market: 'KS' }],
  ['069500', { name: 'KODEX 200', market: 'KS' }],
]);

const file = readFileSync(SRC, 'utf8');
const re = /\{ ticker: '([0-9]{6})\.(KS|KQ)', name: '([^']*)' \}/g;

const seen = new Set();
const original = [];
for (const m of file.matchAll(re)) {
  const key = `${m[1]}.${m[2]}`;
  if (seen.has(m[1])) continue; // also dedupe by code
  seen.add(m[1]);
  original.push({ code: m[1], market: m[2], current: m[3] });
}

// User-requested additions.
const ADDITIONS = [
  { code: '214450' },
  { code: '096530' },
];
for (const a of ADDITIONS) {
  if (!original.some(e => e.code === a.code)) {
    original.push({ code: a.code, market: kospi.has(a.code) ? 'KS' : 'KQ', current: '' });
  }
}

// Build the new list.
const TICKER_OVERRIDE = new Map([
  // Code-change: ticker number itself changed; remap to the live code.
  ['002270', '280360'], // 롯데웰푸드
  ['036490', '018670'], // SK가스
]);

console.error(`Processing ${original.length} entries...`);
const finalList = [];
const removed = [];
const renamed = [];
let i = 0;
for (const entry of original) {
  i++;
  const code = TICKER_OVERRIDE.get(entry.code) ?? entry.code;

  // Try KRX in both markets (prefer the one matching the current suffix).
  let info = lookup(code, entry.market) ?? SPECIAL.get(code);
  let market = info?.market ?? entry.market;
  let name = info?.name;

  // KONEX-only listings can't be queried via yfinance with a .KS/.KQ
  // suffix, so drop them too even though they technically exist.
  if (!name && konex.has(code)) {
    removed.push({ ...entry, reason: 'KONEX' });
    continue;
  }

  // Fallback: ask Naver (handles preferred shares Naver knows about, etc.)
  if (!name) {
    name = await fetchNaverName(code);
    await sleep(60);
    if (!name) {
      removed.push({ ...entry, reason: 'delisted' });
      continue;
    }
    market = entry.market;
  }

  // Popular-brand override wins over KRX's formal name.
  if (BRAND_NAME.has(code)) name = BRAND_NAME.get(code);

  if (TICKER_OVERRIDE.has(entry.code)) {
    renamed.push({ from: entry.code, to: code, name });
  }

  finalList.push({ code, market, name });
  if (i % 30 === 0) console.error(`  ${i}/${original.length}`);
}

console.error(`Final list: ${finalList.length} entries (removed ${removed.length} dead tickers)`);
console.error('Removed:', removed.map(r => `${r.code}.${r.market} ${r.current}`).join(', '));
console.error('Code remaps:', renamed);

// Sort: KS first, then KQ, by code ascending — easier to maintain.
finalList.sort((a, b) => {
  if (a.market !== b.market) return a.market === 'KS' ? -1 : 1;
  return a.code.localeCompare(b.code);
});

const header = `// KOSPI 200 + KOSDAQ 150 constituents — static list for the Korean
// market screener + name search/autocomplete.
//   .KS = KOSPI (Korea Exchange main board)
//   .KQ = KOSDAQ (Korea Exchange tech/growth board)
//
// Names verified against KRX (kind.krx.co.kr) listed-companies roster +
// Naver Finance. Last refreshed: 2026-05-24

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
