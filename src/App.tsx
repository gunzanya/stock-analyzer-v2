import { useState } from 'react';
import { fetchAnalysis } from './lib/api.js';
import type { AnalysisResult } from './lib/types.js';
import { StockCard } from './components/StockCard.js';

const DEFAULT_TICKERS = 'NVDA, AVGO, AAPL, BRK-B';
const PRESET_GROUPS: { label: string; tickers: string }[] = [
  { label: '미국 메가캡', tickers: 'NVDA, AAPL, MSFT, AVGO, META' },
  { label: '한국 대표주', tickers: '005930.KS, 000660.KS, 035720.KS, 003230.KS' },
  { label: '배당주', tickers: 'MO, O, ARCC, JNJ' },
  { label: '턴어라운드', tickers: 'BA, INTC, HOOD' },
  { label: '투기/테마', tickers: 'MSTR, IONQ, RIVN, GME' },
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
    <div className="min-h-screen bg-[#0a0f1a] text-slate-100">
      <header className="border-b border-[#1e293b] bg-[#0f172a] px-4 py-4 sticky top-0 z-10 shadow-lg shadow-black/50">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-baseline justify-between gap-3 mb-3">
            <h1 className="text-lg sm:text-xl font-bold flex items-center gap-2">
              <span>📊</span>
              <span>Stock Analyzer</span>
              <span className="text-xs font-mono text-indigo-400">v2</span>
            </h1>
            <p className="text-[10px] text-slate-500 hidden sm:block">
              7유형 분류 · CANSLIM 12 · TotalScore · 매매 전략
            </p>
          </div>
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
              placeholder="티커 (예: NVDA, AAPL, 005930.KS)"
              className="flex-1 min-h-[44px] px-3 py-2 rounded-lg border border-[#1e293b] bg-[#0a0f1a] text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              aria-label="티커 목록"
            />
            <button
              type="submit"
              className="min-h-[44px] px-6 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm active:bg-indigo-700 disabled:opacity-50 transition-colors"
              disabled={cards.some((c) => c.status === 'loading')}
            >
              분석
            </button>
          </form>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {PRESET_GROUPS.map((g) => (
              <button
                key={g.label}
                type="button"
                onClick={() => setInput(g.tickers)}
                className="min-h-[32px] px-3 py-1 text-xs rounded-full border border-[#1e293b] bg-[#0a0f1a] text-slate-300 hover:bg-[#1e293b] active:bg-indigo-900/40 transition-colors"
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-4">
        {cards.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {cards.map((c) => (
              <CardSlot key={c.ticker} state={c} />
            ))}
          </div>
        )}
      </main>

      <footer className="max-w-6xl mx-auto px-4 py-8 text-center text-[11px] text-slate-600">
        분석 데이터: Yahoo Finance · 본 분석은 투자 권유가 아닙니다.
      </footer>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="text-center py-20 text-slate-500">
      <p className="text-4xl mb-4">📈</p>
      <p className="text-base text-slate-300 font-medium mb-2">
        티커를 입력하고 [분석]을 눌러주세요
      </p>
      <p className="text-xs">
        7가지 유형 분류 · CANSLIM 12 항목 · TotalScore · 매매 전략 · 차트
      </p>
    </div>
  );
}

function CardSlot({ state }: { state: CardState }) {
  if (state.status === 'loading') {
    return (
      <div className="rounded-2xl border border-[#1e293b] bg-[#0f172a] p-8 animate-pulse">
        <p className="font-bold text-xl text-slate-700">{state.ticker}</p>
        <p className="text-xs text-slate-600 mt-2">분석 중…</p>
        <div className="mt-4 h-32 rounded-lg bg-[#1e293b]/40" />
      </div>
    );
  }
  if (state.status === 'error' || !state.result) {
    return (
      <div className="rounded-2xl border border-red-900 bg-red-950/40 p-5">
        <p className="font-bold text-lg text-red-200">{state.ticker}</p>
        <p className="text-xs text-red-300 mt-1 break-words">
          {state.error ?? 'unknown error'}
        </p>
      </div>
    );
  }
  return <StockCard result={state.result} />;
}

export default App;
