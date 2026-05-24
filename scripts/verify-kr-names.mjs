// Verify Korean stock names against the official KRX listed-companies
// roster (kind.krx.co.kr), which is the canonical source. Fetches both
// KOSPI and KOSDAQ rosters and cross-references with src/lib/krStocks.ts.
//
// Usage: node scripts/verify-kr-names.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const SRC = new URL('../src/lib/krStocks.ts', import.meta.url);

function ensureRoster(market, suffix) {
  const xls = `/tmp/krx-${suffix}.xls`;
  const html = `/tmp/krx-${suffix}.html`;
  if (!existsSync(html)) {
    console.error(`Fetching KRX ${suffix} roster...`);
    execSync(
      `curl -s "https://kind.krx.co.kr/corpgeneral/corpList.do?method=download&searchType=13&marketType=${market}" -o ${xls} && ` +
        `iconv -f EUC-KR -t UTF-8 ${xls} -o ${html}`,
    );
  }
  return readFileSync(html, 'utf8');
}

const rowRe = /<tr>([\s\S]*?)<\/tr>/g;
const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/g;

function parseRoster(html, market) {
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

// KRX reissues codes after delisting, so the same 6-digit number can
// appear in both rosters. Lookup must respect the .KS / .KQ suffix.
function lookupByMarket(code, market) {
  if (market === 'KS') return kospi.get(code) ?? kosdaq.get(code);
  if (market === 'KQ') return kosdaq.get(code) ?? kospi.get(code);
  return kospi.get(code) ?? kosdaq.get(code);
}

console.error(`Loaded KOSPI ${kospi.size} + KOSDAQ ${kosdaq.size} companies.`);

const file = readFileSync(SRC, 'utf8');
const re = /\{ ticker: '([0-9]{6})\.(KS|KQ)', name: '([^']*)' \}/g;

const entries = [];
for (const m of file.matchAll(re)) {
  entries.push({ code: m[1], market: m[2], current: m[3] });
}

// Common preferred-share / ETF tickers — KRX's "listed companies" download
// excludes those, so we annotate them manually.
const SPECIAL = new Map([
  ['005935', { name: '삼성전자우', market: 'KS' }],
  ['005385', { name: '현대차우', market: 'KS' }],
  ['005387', { name: '현대차2우B', market: 'KS' }],
  ['006405', { name: '삼성SDI우', market: 'KS' }],
  ['078935', { name: 'GS우', market: 'KS' }],
  ['069500', { name: 'KODEX 200', market: 'KS' }],
]);

const EXTRA = [
  { code: '214450' },
  { code: '096530' },
];
for (const e of EXTRA) {
  if (!entries.some(x => x.code === e.code)) {
    const k = lookupByMarket(e.code, 'KS') ?? lookupByMarket(e.code, 'KQ');
    entries.push({ code: e.code, market: k?.market ?? 'KS', current: '' });
  }
}

const results = entries.map(e => {
  const k = lookupByMarket(e.code, e.market) ?? SPECIAL.get(e.code) ?? null;
  return {
    ...e,
    krxName: k?.name ?? null,
    krxMarket: k?.market ?? null,
  };
});

writeFileSync(
  new URL('../scripts/.kr-names.json', import.meta.url),
  JSON.stringify(results, null, 2),
);

console.error('\n=== Mismatches ===');
let mismatch = 0, missing = 0, marketDiff = 0;
const dups = new Map();
for (const r of results) dups.set(r.code, (dups.get(r.code) ?? 0) + 1);

for (const r of results) {
  if (!r.krxName) {
    missing++;
    console.error(`  ❌ ${r.code}.${r.market}  "${r.current}" → not on KRX (delisted/merged?)`);
  } else if (r.krxName !== r.current) {
    mismatch++;
    console.error(`  ⚠️  ${r.code}.${r.market}  "${r.current}" → "${r.krxName}"`);
  }
  if (r.krxMarket && r.krxMarket !== r.market) {
    marketDiff++;
    console.error(`  📈 ${r.code}: .${r.market} → .${r.krxMarket}`);
  }
}

console.error('\n=== Duplicate tickers in krStocks.ts ===');
for (const [code, n] of dups) {
  if (n > 1) console.error(`  ${code}: ${n} entries`);
}

console.error(
  `\nTotal: ${results.length}, mismatch: ${mismatch}, missing: ${missing}, market mismatch: ${marketDiff}`,
);
