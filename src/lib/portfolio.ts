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

const POS_KEY = 'portfolio_positions';
const CLOSED_KEY = 'portfolio_closed';

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

export function savePositions(positions: PortfolioPosition[]) {
  write(POS_KEY, positions);
}

export function loadClosed(): ClosedPosition[] {
  return read<ClosedPosition>(CLOSED_KEY).map((c) => ({
    ...c,
    quantity: c.quantity ?? 100,
    closedQuantity: c.closedQuantity ?? c.quantity ?? 100,
  }));
}

export function saveClosed(closed: ClosedPosition[]) {
  write(CLOSED_KEY, closed);
}

export function addPosition(pos: PortfolioPosition) {
  const all = loadPositions();
  all.push(pos);
  savePositions(all);
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
