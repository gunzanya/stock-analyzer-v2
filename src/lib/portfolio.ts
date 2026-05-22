export type StrategyTag = 'A' | 'B';

export interface PortfolioPosition {
  id: string;
  ticker: string;
  name: string;
  quantity: number;
  entryPrice: number;
  stopPrice: number | null;
  targetPrice: number | null;
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

const POS_KEY = 'portfolio_positions';
const CLOSED_KEY = 'portfolio_closed';
const SNAP_KEY = 'portfolio_snapshots';
const EVENT_KEY = 'portfolio_events';

function read<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function write<T>(key: string, data: T[]) {
  localStorage.setItem(key, JSON.stringify(data));
}

export function loadPositions(): PortfolioPosition[] {
  return read<PortfolioPosition>(POS_KEY).map((p) => ({
    ...p,
    quantity: p.quantity ?? 100,
  }));
}

export function savePositions(positions: PortfolioPosition[], sync = true) {
  write(POS_KEY, positions);
  if (sync) import('./sync.js').then((m) => m.pushToServer());
}

export function loadClosed(): ClosedPosition[] {
  return read<ClosedPosition>(CLOSED_KEY).map((c) => ({
    ...c,
    quantity: c.quantity ?? 100,
    closedQuantity: c.closedQuantity ?? c.quantity ?? 100,
  }));
}

export function saveClosed(closed: ClosedPosition[], sync = true) {
  write(CLOSED_KEY, closed);
  if (sync) import('./sync.js').then((m) => m.pushToServer());
}

export function updatePosition(id: string, patch: Partial<Omit<PortfolioPosition, 'id' | 'ticker' | 'name'>>) {
  savePositions(loadPositions().map((p) => (p.id === id ? { ...p, ...patch } : p)));
}

export function addPosition(pos: PortfolioPosition) {
  const all = loadPositions();
  all.push(pos);
  savePositions(all);
  addEvent('buy', pos.ticker);
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

// ---- Snapshots & events ----

export function loadSnapshots(): PortfolioSnapshot[] {
  return read<PortfolioSnapshot>(SNAP_KEY);
}

export function saveSnapshots(snaps: PortfolioSnapshot[], sync = true) {
  write(SNAP_KEY, snaps);
  if (sync) import('./sync.js').then((m) => m.pushToServer());
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

export function loadEvents(): PortfolioEvent[] {
  return read<PortfolioEvent>(EVENT_KEY);
}

export function saveEvents(events: PortfolioEvent[], sync = true) {
  write(EVENT_KEY, events);
  if (sync) import('./sync.js').then((m) => m.pushToServer());
}

function addEvent(type: 'buy' | 'close', ticker: string) {
  const date = new Date().toISOString().slice(0, 10);
  const all = loadEvents();
  all.push({ date, type, ticker });
  saveEvents(all);
}
