const KEY = 'stock-analyzer-v2:score-history';

export interface ScoreEntry {
  date: string;
  overall: number;
  fundamental: number;
  timing: number;
}

type ScoreHistoryMap = Record<string, ScoreEntry[]>;

function load(): ScoreHistoryMap {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function save(data: ScoreHistoryMap): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // quota exceeded — ignore
  }
}

export function saveScoreEntry(
  ticker: string,
  overall: number,
  fundamental: number,
  timing: number,
): void {
  const today = new Date().toISOString().slice(0, 10);
  const data = load();
  const entries = data[ticker] ?? [];
  const idx = entries.findIndex(e => e.date === today);
  const entry: ScoreEntry = { date: today, overall, fundamental, timing };
  if (idx >= 0) entries[idx] = entry;
  else entries.push(entry);
  entries.sort((a, b) => a.date.localeCompare(b.date));
  data[ticker] = entries.slice(-14);
  save(data);
}

export function loadScoreHistory(ticker: string): ScoreEntry[] {
  return load()[ticker] ?? [];
}
