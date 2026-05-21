import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

const KEY = 'portfolio_all';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    const data = await redis.get(KEY);
    return res.json(data ?? { positions: [], closed: [], watchlist: [] });
  }

  if (req.method === 'POST') {
    const { positions, closed, watchlist } = req.body as {
      positions: unknown[];
      closed: unknown[];
      watchlist: unknown[];
    };
    await redis.set(KEY, { positions, closed, watchlist });
    return res.json({ ok: true });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}
