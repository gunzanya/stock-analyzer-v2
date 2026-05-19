import { useState } from 'react';
import { fetchAnalysis } from './lib/api.js';
import type { AnalysisResult } from './lib/types.js';
import { StockCard } from './components/StockCard.js';

const DEFAULT_TICKERS = 'NVDA, AAPL, AVGO, BRK-B, MSTR';
const PRESET_GROUPS: { label: string; tickers: string }[] = [
  { label: '미국 메가캡', tickers: 'NVDA, AAPL, MSFT, AVGO, META' },
  { label: '한국 대표주', tickers: '005930.KS, 000660.KS, 035720.KS, 003230.KS' },
  { label: '배당주', tickers: 'MO, O, ARCC, JNJ' },
  { label: '턴어라운드 후보', tickers: 'BA, INTC, HOOD, 035720.KS' },
];

interface CardState {
  ticker: string;
  status: 'loading' | 'ok' | 'error';
  result?: AnalysisResult;
  error?: string;
}

function parseTickers(input: string): string[] {
  return Array.from(
    new Set(
      input
        .split(/[,\s]+/)
        .map((t) => t.trim().toUpperCase())
        .filter(Boolean),
    ),
  );
}

function App() {
  const [input, setInput] = useState(DEFAULT_TICKERS);
  const [cards, setCards] = useState<CardState[]>([]);

  async function runAnalysis() {
    const tickers = parseTickers(input);
    if (tickers.length === 0) return;
    setCards(tickers.map((t) => ({ ticker: t, status: 'loading' })));
    await Promise.all(
      tickers.map(async (t) => {
        try {
          const result = await fetchAnalysis(t);
          setCards((prev) =>
            prev.map((c) => (c.ticker === t ? { ticker: t, status: 'ok', result } : c)),
          );
        } catch (err) {
          setCards((prev) =>
            prev.map((c) =>
              c.ticker === t
                ? { ticker: t, status: 'error', error: (err as Error).message }
                : c,
            ),
          );
        }
      }),
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-4 sticky top-0 z-10 shadow-sm">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-xl font-bold mb-3">📊 Stock Analyzer v2</h1>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void runAnalysis();
            }}
            className="flex flex-col sm:flex-row gap-2"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="티커 입력 (예: NVDA, AAPL, 005930.KS)"
              className="flex-1 min-h-[44px] px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              aria-label="티커 목록"
            />
            <button
              type="submit"
              className="min-h-[44px] px-5 py-2 rounded-lg bg-indigo-600 text-white font-semibold text-sm active:bg-indigo-700 disabled:opacity-50"
              disabled={cards.some((c) => c.status === 'loading')}
            >
              분석
            </button>
          </form>
          <div className="mt-2 flex flex-wrap gap-2">
            {PRESET_GROUPS.map((g) => (
              <button
                key={g.label}
                type="button"
                onClick={() => setInput(g.tickers)}
                className="min-h-[32px] px-3 py-1 text-xs rounded-full border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 active:bg-slate-200 dark:active:bg-slate-700"
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4">
        {cards.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {cards.map((c) => (
              <CardSlot key={c.ticker} state={c} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="text-center py-20 text-slate-500 dark:text-slate-400">
      <p className="text-3xl mb-3">📈</p>
      <p className="text-sm">티커를 입력하고 [분석]을 눌러주세요.</p>
      <p className="text-xs mt-2">7가지 유형 분류 + Entry Score + 안전장치 컨텍스트</p>
    </div>
  );
}

function CardSlot({ state }: { state: CardState }) {
  if (state.status === 'loading') {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 animate-pulse">
        <p className="font-bold text-lg text-slate-400">{state.ticker}</p>
        <p className="text-xs text-slate-400 mt-1">분석 중…</p>
      </div>
    );
  }
  if (state.status === 'error' || !state.result) {
    return (
      <div className="rounded-xl border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 p-4">
        <p className="font-bold text-lg text-rose-900 dark:text-rose-100">{state.ticker}</p>
        <p className="text-xs text-rose-700 dark:text-rose-300 mt-1 break-words">
          {state.error ?? 'unknown error'}
        </p>
      </div>
    );
  }
  return <StockCard result={state.result} />;
}

export default App;
