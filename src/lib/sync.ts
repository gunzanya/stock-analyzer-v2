import { loadPositions, savePositions, loadClosed, saveClosed, loadSnapshots, saveSnapshots, loadEvents, saveEvents } from './portfolio.js';
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
  return () => listeners.delete(fn);
}

export async function pullFromServer(): Promise<boolean> {
  try {
    const res = await fetch('/api/portfolio-sync');
    if (!res.ok) return false;
    const data = (await res.json()) as {
      positions: unknown[];
      closed: unknown[];
      watchlist: unknown[];
    };
    if (data.positions?.length || data.closed?.length || data.watchlist?.length || (data as any).snapshots?.length || (data as any).events?.length) {
      savePositions(data.positions as never[], false);
      saveClosed(data.closed as never[], false);
      saveFavorites((data.watchlist ?? []) as string[], false);
      if ((data as any).snapshots?.length) saveSnapshots((data as any).snapshots as never[], false);
      if ((data as any).events?.length) saveEvents((data as any).events as never[], false);
    }
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
      const body = {
        positions: loadPositions(),
        closed: loadClosed(),
        watchlist: loadFavorites(),
        snapshots: loadSnapshots(),
        events: loadEvents(),
      };
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
