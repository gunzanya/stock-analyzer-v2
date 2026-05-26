import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

const LEGACY_KEY = 'portfolio_all';
const LIST_KEY = 'portfolio:list';
const WATCHLIST_KEY = 'portfolio:watchlist';

interface PortfolioMeta { id: string; name: string }
interface PortfolioData {
  positions: unknown[];
  closed: unknown[];
  snapshots: unknown[];
  events: unknown[];
}
interface SyncPayload {
  list: PortfolioMeta[];
  portfolios: Record<string, PortfolioData>;
  watchlist: string[];
}

function dataKey(id: string): string {
  return `portfolio:${id}:data`;
}

function emptyData(): PortfolioData {
  return { positions: [], closed: [], snapshots: [], events: [] };
}

async function readAll(): Promise<SyncPayload> {
  const list = (await redis.get<PortfolioMeta[]>(LIST_KEY)) ?? [];
  if (Array.isArray(list) && list.length > 0) {
    const portfolios: Record<string, PortfolioData> = {};
    for (const m of list) {
      const data = (await redis.get<PortfolioData>(dataKey(m.id))) ?? emptyData();
      portfolios[m.id] = {
        positions: data.positions ?? [],
        closed: data.closed ?? [],
        snapshots: data.snapshots ?? [],
        events: data.events ?? [],
      };
    }
    const watchlist = (await redis.get<string[]>(WATCHLIST_KEY)) ?? [];
    return { list, portfolios, watchlist };
  }

  // Migration: lift the legacy single-portfolio blob into a "기본" entry so
  // existing users keep their data on first reload after this deploy.
  const legacy = await redis.get<{
    positions?: unknown[];
    closed?: unknown[];
    snapshots?: unknown[];
    events?: unknown[];
    watchlist?: string[];
  }>(LEGACY_KEY);
  if (legacy) {
    const defaultMeta: PortfolioMeta[] = [{ id: 'default', name: '기본' }];
    const data: PortfolioData = {
      positions: legacy.positions ?? [],
      closed: legacy.closed ?? [],
      snapshots: legacy.snapshots ?? [],
      events: legacy.events ?? [],
    };
    const watchlist = legacy.watchlist ?? [];
    // Persist new schema so future reads skip the migration branch.
    await redis.set(LIST_KEY, defaultMeta);
    await redis.set(dataKey('default'), data);
    await redis.set(WATCHLIST_KEY, watchlist);
    return { list: defaultMeta, portfolios: { default: data }, watchlist };
  }
  return { list: [], portfolios: {}, watchlist: [] };
}

async function writeAll(payload: SyncPayload): Promise<void> {
  const incomingList = Array.isArray(payload.list) ? payload.list : [];
  const portfolios = payload.portfolios ?? {};
  const watchlist = Array.isArray(payload.watchlist) ? payload.watchlist : [];

  const prevList = (await redis.get<PortfolioMeta[]>(LIST_KEY)) ?? [];
  const incomingIds = new Set(incomingList.map((m) => m.id));
  // Drop data keys for portfolios that were removed in this push.
  for (const m of prevList) {
    if (!incomingIds.has(m.id)) {
      await redis.del(dataKey(m.id));
    }
  }
  await redis.set(LIST_KEY, incomingList);
  for (const m of incomingList) {
    const d = portfolios[m.id] ?? emptyData();
    await redis.set(dataKey(m.id), {
      positions: d.positions ?? [],
      closed: d.closed ?? [],
      snapshots: d.snapshots ?? [],
      events: d.events ?? [],
    });
  }
  await redis.set(WATCHLIST_KEY, watchlist);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    const data = await readAll();
    return res.json(data);
  }

  if (req.method === 'POST') {
    const body = req.body as SyncPayload;
    await writeAll(body);
    return res.json({ ok: true });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}
