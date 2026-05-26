import {
  listPortfolios,
  readPortfolioData,
  writePortfolioData,
  setPortfolioList,
  getSelectedPortfolioId,
  selectPortfolio,
  type PortfolioMeta,
  type PortfolioPosition,
  type ClosedPosition,
  type PortfolioSnapshot,
  type PortfolioEvent,
} from './portfolio.js';
import { loadFavorites, saveFavorites } from './favorites.js';

type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error';
type Listener = (status: SyncStatus) => void;

let status: SyncStatus = 'idle';
const listeners = new Set<Listener>();
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function notify(next: SyncStatus) {
  status = next;
  listeners.forEach((fn) => fn(next));
}

export function onSyncStatus(fn: Listener): () => void {
  listeners.add(fn);
  fn(status);
  return () => { listeners.delete(fn); };
}

interface PortfolioData {
  positions: PortfolioPosition[];
  closed: ClosedPosition[];
  snapshots: PortfolioSnapshot[];
  events: PortfolioEvent[];
}

interface SyncPayload {
  list: PortfolioMeta[];
  portfolios: Record<string, PortfolioData>;
  watchlist: string[];
}

function buildPayload(): SyncPayload {
  const list = listPortfolios();
  const portfolios: Record<string, PortfolioData> = {};
  for (const m of list) {
    portfolios[m.id] = readPortfolioData(m.id);
  }
  return { list, portfolios, watchlist: loadFavorites() };
}

export async function pullFromServer(): Promise<boolean> {
  try {
    const res = await fetch('/api/portfolio-sync');
    if (!res.ok) return false;
    const data = (await res.json()) as Partial<SyncPayload>;

    const serverList = Array.isArray(data.list) ? data.list : [];
    const serverPortfolios = data.portfolios ?? {};
    const serverWatchlist = Array.isArray(data.watchlist) ? data.watchlist : [];

    // Only overwrite local state when the server has actually-sourced data.
    // An empty server response means "no remote data yet" — keep local intact
    // so a fresh device doesn't wipe out a user's just-migrated portfolios.
    const hasPortfolios =
      serverList.length > 0 ||
      Object.keys(serverPortfolios).length > 0;
    if (hasPortfolios) {
      const normalizedList: PortfolioMeta[] =
        serverList.length > 0
          ? serverList
          : Object.keys(serverPortfolios).map((id) => ({ id, name: id }));
      setPortfolioList(normalizedList);
      for (const m of normalizedList) {
        const p = serverPortfolios[m.id];
        if (!p) continue;
        writePortfolioData(m.id, {
          positions: Array.isArray(p.positions) ? p.positions : [],
          closed: Array.isArray(p.closed) ? p.closed : [],
          snapshots: Array.isArray(p.snapshots) ? p.snapshots : [],
          events: Array.isArray(p.events) ? p.events : [],
        });
      }
      // If the previously-selected id is no longer in the list, fall back to
      // the first available portfolio.
      const cur = getSelectedPortfolioId();
      if (!normalizedList.some((m) => m.id === cur)) {
        selectPortfolio(normalizedList[0].id);
      }
    }
    if (serverWatchlist.length) saveFavorites(serverWatchlist, false);
    notify('synced');
    return true;
  } catch {
    notify('error');
    return false;
  }
}

export function pushToServer() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(async () => {
    notify('syncing');
    try {
      const body = buildPayload();
      const res = await fetch('/api/portfolio-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      notify(res.ok ? 'synced' : 'error');
    } catch {
      notify('error');
    }
  }, 2000);
}
