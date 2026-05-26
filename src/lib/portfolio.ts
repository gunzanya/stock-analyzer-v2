export type StrategyTag = 'A' | 'B';

export type StrategySource = 'auto' | 'manual';

export interface PortfolioPosition {
  id: string;
  ticker: string;
  name: string;
  quantity: number;
  entryPrice: number;
  stopPrice: number | null;
  /** 1차 목표가. Kept under the original `targetPrice` name for backwards
   *  compatibility with positions stored before the 2-target split. */
  targetPrice: number | null;
  target2Price?: number | null;
  /** Stock-type used when the auto-suggest was generated (e.g. "CYCLICAL").
   *  Helps reconstruct the rationale even after re-classification drifts. */
  strategyType?: string | null;
  riskReward1?: number | null;
  riskReward2?: number | null;
  strategySource?: StrategySource;
  entryDate: string;
  scores: { fundamental: number; timing: number; overall: number };
  strategyTag: StrategyTag;
  memo: string;
}

export interface ClosedPosition extends PortfolioPosition {
  closePrice: number;
  closeDate: string;
  returnPct: number;
  holdingDays: number;
  closedQuantity: number;
}

export interface PortfolioSnapshot {
  date: string;
  totalInvestedKRW: number;
  totalValueKRW: number;
  returnPct: number;
}

export interface PortfolioEvent {
  date: string;
  type: 'buy' | 'close';
  ticker: string;
}

export interface PortfolioMeta {
  id: string;
  name: string;
}

const LIST_KEY = 'portfolio_list';
const SELECTED_KEY = 'portfolio_selected';

const LEGACY_POS = 'portfolio_positions';
const LEGACY_CLOSED = 'portfolio_closed';
const LEGACY_SNAP = 'portfolio_snapshots';
const LEGACY_EVENT = 'portfolio_events';

const DEFAULT_ID = 'default';
const DEFAULT_NAME = '기본';

function posKey(id: string): string { return `portfolio:${id}:positions`; }
function closedKey(id: string): string { return `portfolio:${id}:closed`; }
function snapKey(id: string): string { return `portfolio:${id}:snapshots`; }
function eventKey(id: string): string { return `portfolio:${id}:events`; }

function readRaw<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeRaw<T>(key: string, data: T[]) {
  localStorage.setItem(key, JSON.stringify(data));
}

let initialized = false;
function ensureInitialized(): void {
  if (initialized) return;
  initialized = true;
  const listRaw = localStorage.getItem(LIST_KEY);
  if (listRaw) {
    try {
      const parsed = JSON.parse(listRaw);
      if (Array.isArray(parsed) && parsed.length > 0) return;
    } catch { /* fall through to bootstrap */ }
  }
  // Bootstrap with default portfolio. Carry over any legacy single-portfolio
  // data into portfolio:default:* so existing users see no data loss.
  const seed: PortfolioMeta[] = [{ id: DEFAULT_ID, name: DEFAULT_NAME }];
  localStorage.setItem(LIST_KEY, JSON.stringify(seed));
  if (!localStorage.getItem(SELECTED_KEY)) {
    localStorage.setItem(SELECTED_KEY, DEFAULT_ID);
  }
  const moves: [string, string][] = [
    [LEGACY_POS, posKey(DEFAULT_ID)],
    [LEGACY_CLOSED, closedKey(DEFAULT_ID)],
    [LEGACY_SNAP, snapKey(DEFAULT_ID)],
    [LEGACY_EVENT, eventKey(DEFAULT_ID)],
  ];
  for (const [oldK, newK] of moves) {
    if (localStorage.getItem(newK)) continue;
    const v = localStorage.getItem(oldK);
    if (v != null) localStorage.setItem(newK, v);
  }
}

// ----- portfolio list / selection -----

const listeners = new Set<() => void>();
function emitChange() {
  for (const fn of listeners) fn();
}

export function onPortfolioChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function listPortfolios(): PortfolioMeta[] {
  ensureInitialized();
  try {
    const raw = localStorage.getItem(LIST_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch { /* fallthrough */ }
  return [{ id: DEFAULT_ID, name: DEFAULT_NAME }];
}

function writeList(list: PortfolioMeta[], sync = true) {
  localStorage.setItem(LIST_KEY, JSON.stringify(list));
  if (sync) import('./sync.js').then((m) => m.pushToServer());
}

export function getSelectedPortfolioId(): string {
  ensureInitialized();
  const id = localStorage.getItem(SELECTED_KEY) ?? '';
  const list = listPortfolios();
  if (list.some((p) => p.id === id)) return id;
  const fallback = list[0]?.id ?? DEFAULT_ID;
  localStorage.setItem(SELECTED_KEY, fallback);
  return fallback;
}

export function selectPortfolio(id: string) {
  const list = listPortfolios();
  if (!list.some((p) => p.id === id)) return;
  localStorage.setItem(SELECTED_KEY, id);
  emitChange();
}

export function getPortfolioMeta(id: string): PortfolioMeta | null {
  return listPortfolios().find((p) => p.id === id) ?? null;
}

export function createPortfolio(rawName: string): string {
  ensureInitialized();
  const name = rawName.trim() || '새 포트폴리오';
  const id = `p_${genId()}`;
  const list = listPortfolios();
  list.push({ id, name });
  writeList(list, false);
  localStorage.setItem(posKey(id), '[]');
  localStorage.setItem(closedKey(id), '[]');
  localStorage.setItem(snapKey(id), '[]');
  localStorage.setItem(eventKey(id), '[]');
  localStorage.setItem(SELECTED_KEY, id);
  emitChange();
  import('./sync.js').then((m) => m.pushToServer());
  return id;
}

export function renamePortfolio(id: string, rawName: string) {
  const name = rawName.trim();
  if (!name) return;
  const list = listPortfolios();
  const found = list.find((p) => p.id === id);
  if (!found || found.name === name) return;
  found.name = name;
  writeList(list);
  emitChange();
}

export function deletePortfolio(id: string) {
  const list = listPortfolios();
  if (list.length <= 1) return;
  const next = list.filter((p) => p.id !== id);
  writeList(next, false);
  localStorage.removeItem(posKey(id));
  localStorage.removeItem(closedKey(id));
  localStorage.removeItem(snapKey(id));
  localStorage.removeItem(eventKey(id));
  const cur = localStorage.getItem(SELECTED_KEY);
  if (cur === id) {
    localStorage.setItem(SELECTED_KEY, next[0].id);
  }
  emitChange();
  import('./sync.js').then((m) => m.pushToServer());
}

// ----- positions / closed / snapshots / events for the SELECTED portfolio -----

export function loadPositions(): PortfolioPosition[] {
  return readRaw<PortfolioPosition>(posKey(getSelectedPortfolioId())).map((p) => ({
    ...p,
    quantity: p.quantity ?? 100,
  }));
}

export function savePositions(positions: PortfolioPosition[], sync = true) {
  writeRaw(posKey(getSelectedPortfolioId()), positions);
  if (sync) import('./sync.js').then((m) => m.pushToServer());
}

export function loadClosed(): ClosedPosition[] {
  return readRaw<ClosedPosition>(closedKey(getSelectedPortfolioId())).map((c) => ({
    ...c,
    quantity: c.quantity ?? 100,
    closedQuantity: c.closedQuantity ?? c.quantity ?? 100,
  }));
}

export function saveClosed(closed: ClosedPosition[], sync = true) {
  writeRaw(closedKey(getSelectedPortfolioId()), closed);
  if (sync) import('./sync.js').then((m) => m.pushToServer());
}

export function loadSnapshots(): PortfolioSnapshot[] {
  return readRaw<PortfolioSnapshot>(snapKey(getSelectedPortfolioId()));
}

export function saveSnapshots(snaps: PortfolioSnapshot[], sync = true) {
  writeRaw(snapKey(getSelectedPortfolioId()), snaps);
  if (sync) import('./sync.js').then((m) => m.pushToServer());
}

export function loadEvents(): PortfolioEvent[] {
  return readRaw<PortfolioEvent>(eventKey(getSelectedPortfolioId()));
}

export function saveEvents(events: PortfolioEvent[], sync = true) {
  writeRaw(eventKey(getSelectedPortfolioId()), events);
  if (sync) import('./sync.js').then((m) => m.pushToServer());
}

// Sync-layer helpers: read/write per-portfolio data WITHOUT triggering a sync
// push (the caller is the sync layer itself).
export function writePortfolioData(
  id: string,
  data: {
    positions?: PortfolioPosition[];
    closed?: ClosedPosition[];
    snapshots?: PortfolioSnapshot[];
    events?: PortfolioEvent[];
  },
) {
  if (data.positions) writeRaw(posKey(id), data.positions);
  if (data.closed) writeRaw(closedKey(id), data.closed);
  if (data.snapshots) writeRaw(snapKey(id), data.snapshots);
  if (data.events) writeRaw(eventKey(id), data.events);
}

export function readPortfolioData(id: string) {
  return {
    positions: readRaw<PortfolioPosition>(posKey(id)),
    closed: readRaw<ClosedPosition>(closedKey(id)),
    snapshots: readRaw<PortfolioSnapshot>(snapKey(id)),
    events: readRaw<PortfolioEvent>(eventKey(id)),
  };
}

export function setPortfolioList(list: PortfolioMeta[]) {
  if (!Array.isArray(list) || list.length === 0) return;
  writeList(list, false);
  emitChange();
}

// ----- position mutations -----

export function updatePosition(id: string, patch: Partial<Omit<PortfolioPosition, 'id' | 'ticker' | 'name'>>) {
  savePositions(loadPositions().map((p) => (p.id === id ? { ...p, ...patch } : p)));
}

export function addPosition(pos: PortfolioPosition) {
  const all = loadPositions();
  all.push(pos);
  savePositions(all);
  addEvent('buy', pos.ticker);
}

// Append a position to a specific portfolio without changing the globally
// selected one. Used by AddToPortfolioModal when the user picks a non-current
// portfolio in the dropdown.
export function addPositionToPortfolio(portfolioId: string, pos: PortfolioPosition) {
  ensureInitialized();
  const list = listPortfolios();
  if (!list.some((p) => p.id === portfolioId)) return;
  const positions = readRaw<PortfolioPosition>(posKey(portfolioId)).map((p) => ({
    ...p,
    quantity: p.quantity ?? 100,
  }));
  positions.push(pos);
  writeRaw(posKey(portfolioId), positions);
  const events = readRaw<PortfolioEvent>(eventKey(portfolioId));
  events.push({ date: new Date().toISOString().slice(0, 10), type: 'buy', ticker: pos.ticker });
  writeRaw(eventKey(portfolioId), events);
  import('./sync.js').then((m) => m.pushToServer());
  emitChange();
}

export function removePosition(id: string) {
  savePositions(loadPositions().filter((p) => p.id !== id));
}

export function closePosition(id: string, closePrice: number, pct: number = 1) {
  const positions = loadPositions();
  const pos = positions.find((p) => p.id === id);
  if (!pos) return;

  const closeDate = new Date().toISOString().slice(0, 10);
  const holdingDays = Math.max(
    1,
    Math.round(
      (new Date(closeDate).getTime() - new Date(pos.entryDate).getTime()) /
        86_400_000,
    ),
  );
  const returnPct = (closePrice - pos.entryPrice) / pos.entryPrice;
  const closedQty = Math.round(pos.quantity * pct);
  const remainQty = pos.quantity - closedQty;

  const closed: ClosedPosition = {
    ...pos,
    closePrice,
    closeDate,
    returnPct,
    holdingDays,
    closedQuantity: closedQty,
  };

  const allClosed = loadClosed();
  allClosed.push(closed);
  saveClosed(allClosed);
  addEvent('close', pos.ticker);

  if (remainQty <= 0) {
    removePosition(id);
  } else {
    const updated = positions.map((p) =>
      p.id === id ? { ...p, quantity: remainQty } : p,
    );
    savePositions(updated);
  }
}

export function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function recordSnapshot(snap: Omit<PortfolioSnapshot, 'date'>) {
  const date = new Date().toISOString().slice(0, 10);
  const all = loadSnapshots();
  const idx = all.findIndex((s) => s.date === date);
  const entry: PortfolioSnapshot = { date, ...snap };
  if (idx >= 0) all[idx] = entry;
  else all.push(entry);
  saveSnapshots(all);
}

function addEvent(type: 'buy' | 'close', ticker: string) {
  const date = new Date().toISOString().slice(0, 10);
  const all = loadEvents();
  all.push({ date, type, ticker });
  saveEvents(all);
}
