// Local /api server that mirrors what Vercel Functions do in production.
// Vite dev (port 5173) proxies /api/* → this server (port 3001).
//
// Usage: npx tsx scripts/dev-api.mjs

import { createServer } from 'node:http';
import { analyzeOne } from '../api/analyze.ts';
import { fetchFundamental } from '../api/fetchStock.ts';
import { runScreener } from '../api/screen.ts';
import { pickRandom, SCREENER_POOL } from '../src/lib/screenerPool.ts';

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
      const n = Math.max(1, Math.min(40, Number(nRaw ?? 20) || 20));
      const tickersParam = url.searchParams.get('tickers');
      const tickers = tickersParam
        ? Array.from(
            new Set(
              tickersParam.split(',').map((t) => t.trim().toUpperCase()).filter(Boolean),
            ),
          )
            .filter((t) => SCREENER_POOL.includes(t))
            .slice(0, 40)
        : pickRandom(n);
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
