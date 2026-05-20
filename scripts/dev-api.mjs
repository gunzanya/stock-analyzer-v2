// Local /api server that mirrors what Vercel Functions do in production.
// Vite dev (port 5173) proxies /api/* → this server (port 3001).
//
// Usage: npx tsx scripts/dev-api.mjs

import { createServer } from 'node:http';
import { analyzeOne } from '../api/analyze.ts';
import { fetchFundamental } from '../api/fetchStock.ts';
import { runScreener } from '../api/screen.ts';
import { fetchScreenerPool } from '../api/fetchStock.ts';
import { SCREENER_POOL } from '../src/lib/screenerPool.ts';

const FILTERS = new Set(['all', 'large_cap', 'small_mid', 'tech']);

function sampleFrom(pool, n) {
  const copy = [...pool];
  const k = Math.min(n, copy.length);
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(Math.random() * (copy.length - i));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, k);
}

async function buildPool(filter) {
  const opts =
    filter === 'large_cap'
      ? { minMarketCap: 10e9 }
      : filter === 'small_mid'
        ? { maxMarketCap: 10e9 }
        : {};
  try {
    const dynamic = await fetchScreenerPool(filter, opts);
    if (dynamic.length >= 20) return dynamic;
    return Array.from(new Set([...dynamic, ...SCREENER_POOL]));
  } catch {
    return [...SCREENER_POOL];
  }
}

const PORT = Number(process.env.PORT ?? 3001);

const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const ticker = url.searchParams.get('ticker') ?? url.searchParams.get('symbol');

  const json = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  };

  try {
    if (url.pathname === '/api/analyze' && ticker) {
      const data = await analyzeOne(ticker);
      return json(200, data);
    }
    if (url.pathname === '/api/fetchStock' && ticker) {
      const data = await fetchFundamental(ticker);
      return json(200, data);
    }
    if (url.pathname === '/api/screen') {
      const nRaw = url.searchParams.get('n');
      const n = Math.max(1, Math.min(100, Number(nRaw ?? 20) || 20));
      const filterRaw = url.searchParams.get('filter');
      const filter = FILTERS.has(filterRaw) ? filterRaw : 'all';
      const tickersParam = url.searchParams.get('tickers');
      let tickers;
      if (tickersParam) {
        tickers = Array.from(
          new Set(
            tickersParam.split(',').map((t) => t.trim().toUpperCase()).filter(Boolean),
          ),
        )
          .filter((t) => SCREENER_POOL.includes(t))
          .slice(0, 40);
      } else {
        const pool = await buildPool(filter);
        const excludeRaw = url.searchParams.get('exclude');
        const exclude = excludeRaw
          ? new Set(
              excludeRaw
                .split(',')
                .map((t) => t.trim().toUpperCase())
                .filter(Boolean),
            )
          : null;
        const eligible = exclude ? pool.filter((t) => !exclude.has(t)) : pool;
        tickers = sampleFrom(eligible, n);
      }
      if (tickers.length === 0) return json(400, { error: 'no_tickers' });

      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      const writer = {
        write: (chunk) => res.write(chunk),
        end: () => res.end(),
      };
      await runScreener(tickers, writer);
      return;
    }
    json(404, { error: 'unknown endpoint or missing ?ticker=' });
  } catch (err) {
    json(502, { error: 'fetch_failed', message: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`Dev API listening on http://localhost:${PORT}`);
});
