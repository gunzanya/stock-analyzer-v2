// localStorage-backed favorites list. Tickers are stored uppercased.

const KEY = 'stock-analyzer-v2:favorites';

export function loadFavorites(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((t): t is string => typeof t === 'string')
      .map((t) => t.toUpperCase());
  } catch {
    return [];
  }
}

export function saveFavorites(list: string[], sync = true): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // quota or private mode — silently ignore
  }
  if (sync) import('./sync.js').then((m) => m.pushToServer());
}
