import { useEffect, useState, type ReactNode } from 'react';
import { fetchAnalysis } from './lib/api.js';
import type { AnalysisResult } from './lib/types.js';
import { loadFavorites, saveFavorites } from './lib/favorites.js';
import { StockCard } from './components/StockCard.js';
import { ScreenerPanel } from './components/ScreenerPanel.js';

type Tab = 'analyze' | 'screener';

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
  const [tab, setTab] = useState<Tab>('analyze');
  const [input, setInput] = useState('');
  const [cards, setCards] = useState<CardState[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);

  // Load favorites on mount
  useEffect(() => {
    setFavorites(loadFavorites());
  }, []);

  // Auto-analyze when arriving with ?ticker=XYZ (e.g. middle-click from
  // the screener opens a new tab whose URL has this param). Runs once on
  // mount, then strips the param so refresh / tab switches don't re-fire.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ticker = params.get('ticker');
    if (!ticker) return;
    const upper = ticker.toUpperCase();
    setTab('analyze');
    setInput(upper);
    void runAnalysis(upper);
    window.history.replaceState({}, '', window.location.pathname);
  }, []);

  function toggleFavorite(ticker: string) {
    const upper = ticker.toUpperCase();
    setFavorites((prev) => {
      const next = prev.includes(upper)
        ? prev.filter((t) => t !== upper)
        : [...prev, upper];
      saveFavorites(next);
      return next;
    });
  }

  async function runAnalysis(rawInput: string) {
    const tickers = parseTickers(rawInput);
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

          <div className="flex gap-1 mb-3 border-b border-[#1e293b]">
            <TabButton active={tab === 'analyze'} onClick={() => setTab('analyze')}>
              📊 개별 분석
            </TabButton>
            <TabButton active={tab === 'screener'} onClick={() => setTab('screener')}>
              🎲 스크리너
            </TabButton>
          </div>

          {tab === 'analyze' && (
            <>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void runAnalysis(input);
                }}
                className="flex flex-col sm:flex-row gap-2"
              >
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="티커 입력 (NVDA, AAPL, 005930.KS...)"
                  className="flex-1 min-h-[44px] px-3 py-2 rounded-lg border border-[#1e293b] bg-[#0a0f1a] text-base text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  aria-label="티커 목록"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="submit"
                  className="min-h-[44px] px-6 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-base active:bg-indigo-700 disabled:opacity-50 transition-colors"
                  disabled={cards.some((c) => c.status === 'loading') || input.trim() === ''}
                >
                  분석
                </button>
              </form>

              {favorites.length > 0 && (
                <div className="mt-3">
                  <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">
                    ⭐ 내 관심종목 ({favorites.length})
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {favorites.map((t) => (
                      <FavoriteChip
                        key={t}
                        ticker={t}
                        onAnalyze={() => {
                          setInput(t);
                          void runAnalysis(t);
                        }}
                        onRemove={() => toggleFavorite(t)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-4">
        {tab === 'screener' ? (
          <ScreenerPanel
            favorites={favorites}
            onToggleFavorite={toggleFavorite}
            onPickTicker={(t) => {
              setTab('analyze');
              setInput(t);
              void runAnalysis(t);
            }}
          />
        ) : cards.length === 0 ? (
          <EmptyState hasFavorites={favorites.length > 0} />
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {cards.map((c) => (
              <CardSlot
                key={c.ticker}
                state={c}
                isFavorite={favorites.includes(c.ticker)}
                onToggleFavorite={() => toggleFavorite(c.ticker)}
              />
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

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'px-3 py-2 -mb-px text-sm font-medium border-b-2 transition-colors ' +
        (active
          ? 'border-indigo-500 text-indigo-300'
          : 'border-transparent text-slate-400 hover:text-slate-200')
      }
    >
      {children}
    </button>
  );
}

function FavoriteChip({
  ticker,
  onAnalyze,
  onRemove,
}: {
  ticker: string;
  onAnalyze: () => void;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-0 rounded-full border border-amber-700/40 bg-amber-900/15 text-amber-200 overflow-hidden">
      <button
        type="button"
        onClick={onAnalyze}
        className="min-h-[32px] pl-3 pr-2 py-1 text-xs font-medium hover:bg-amber-800/30 active:bg-amber-700/40 transition-colors"
      >
        ⭐ {ticker}
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="min-h-[32px] min-w-[28px] px-1.5 text-amber-400/60 hover:text-amber-300 hover:bg-red-900/40 active:bg-red-800/50 transition-colors text-sm leading-none"
        aria-label={`${ticker} 관심종목에서 제거`}
      >
        ×
      </button>
    </span>
  );
}

function EmptyState({ hasFavorites }: { hasFavorites: boolean }) {
  return (
    <div className="text-center py-20 text-slate-500">
      <p className="text-4xl mb-4">📈</p>
      <p className="text-base text-slate-300 font-medium mb-2">
        티커를 입력하고 [분석]을 눌러주세요
      </p>
      <p className="text-xs">
        7가지 유형 분류 · CANSLIM 12 항목 · TotalScore · 매매 전략 · 차트
      </p>
      {!hasFavorites && (
        <p className="text-xs mt-4 text-slate-600">
          분석 결과의 ⭐ 버튼을 누르면 관심종목으로 저장됩니다
        </p>
      )}
    </div>
  );
}

function CardSlot({
  state,
  isFavorite,
  onToggleFavorite,
}: {
  state: CardState;
  isFavorite: boolean;
  onToggleFavorite: () => void;
}) {
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
  return (
    <StockCard
      result={state.result}
      isFavorite={isFavorite}
      onToggleFavorite={onToggleFavorite}
    />
  );
}

export default App;
