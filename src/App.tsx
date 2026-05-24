import { useEffect, useRef, useState, type ReactNode } from 'react';
import { fetchAnalysis } from './lib/api.js';
import type { AnalysisResult } from './lib/types.js';
import { loadFavorites, saveFavorites } from './lib/favorites.js';
import { pullFromServer } from './lib/sync.js';
import { StockCard } from './components/StockCard.js';
import { ScreenerPanel } from './components/ScreenerPanel.js';
import { TickerInput } from './components/TickerInput.js';
import { PortfolioPanel } from './components/PortfolioPanel.js';
import { WatchlistPanel } from './components/WatchlistPanel.js';

type Tab = 'analyze' | 'screener' | 'watchlist' | 'portfolio';

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

function readURL(): { tab: Tab; ticker: string | null } {
  const params = new URLSearchParams(window.location.search);
  const t = params.get('tab');
  const tab: Tab = t === 'screener' ? 'screener' : t === 'watchlist' ? 'watchlist' : t === 'portfolio' ? 'portfolio' : 'analyze';
  const ticker = params.get('ticker');
  return { tab, ticker: ticker ? ticker.toUpperCase() : null };
}

function pushURL(tab: Tab, ticker?: string | null) {
  const params = new URLSearchParams();
  params.set('tab', tab);
  if (tab === 'analyze' && ticker) params.set('ticker', ticker);
  const url = '?' + params.toString();
  if (window.location.search !== url) {
    window.history.pushState({ tab, ticker: ticker ?? null }, '', url);
  }
}

function App() {
  const initial = readURL();
  const [tab, setTab] = useState<Tab>(initial.tab);
  const [input, setInput] = useState(initial.ticker ?? '');
  const [cards, setCards] = useState<CardState[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [popNav, setPopNav] = useState(0);

  useEffect(() => {
    pullFromServer().then(() => setFavorites(loadFavorites()));
  }, []);

  useEffect(() => {
    const { tab: urlTab, ticker } = readURL();
    pushURL(urlTab, ticker);
    if (ticker && urlTab === 'analyze') {
      void runAnalysis(ticker);
    }
  }, []);

  useEffect(() => {
    function onPop() {
      const { tab: urlTab, ticker } = readURL();
      setTab(urlTab);
      if (urlTab === 'analyze' && ticker) {
        setInput(ticker);
        setPopNav((n) => n + 1);
      }
    }
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    if (popNav === 0) return;
    const { ticker } = readURL();
    if (ticker) void runAnalysis(ticker);
  }, [popNav]);

  useEffect(() => {
    const base = 'Stock Analyzer v2';
    if (tab === 'portfolio') document.title = `포트폴리오 - ${base}`;
    else if (tab === 'watchlist') document.title = `관심종목 - ${base}`;
    else if (tab === 'screener') document.title = `스크리너 - ${base}`;
    else if (cards.length > 0) document.title = `${cards.map((c) => c.ticker).join(', ')} - ${base}`;
    else document.title = base;
  }, [tab, cards]);

  function changeTab(next: Tab) {
    setTab(next);
    pushURL(next);
  }

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
    pushURL('analyze', tickers.join(','));
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
        <div className="max-w-[1400px] mx-auto">
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
            <TabButton active={tab === 'analyze'} onClick={() => changeTab('analyze')}>
              📊 개별 분석
            </TabButton>
            <TabButton active={tab === 'screener'} onClick={() => changeTab('screener')}>
              🎲 스크리너
            </TabButton>
            <TabButton active={tab === 'watchlist'} onClick={() => changeTab('watchlist')}>
              ⭐ 관심종목
            </TabButton>
            <TabButton active={tab === 'portfolio'} onClick={() => changeTab('portfolio')}>
              💼 포트폴리오
            </TabButton>
          </div>

          {tab === 'analyze' && (
            <div className="flex flex-col sm:flex-row gap-2">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void runAnalysis(input);
                }}
                className="flex flex-1 gap-2"
              >
                <TickerInput
                  value={input}
                  onChange={setInput}
                  onSubmit={(t) => void runAnalysis(t)}
                  disabled={cards.some((c) => c.status === 'loading')}
                />
                <button
                  type="submit"
                  className="min-h-[44px] px-6 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-base active:bg-indigo-700 disabled:opacity-50 transition-colors whitespace-nowrap"
                  disabled={cards.some((c) => c.status === 'loading') || input.trim() === ''}
                >
                  분석
                </button>
              </form>
              <FavoritesDropdown
                favorites={favorites}
                onAnalyze={(t) => {
                  setInput(t);
                  void runAnalysis(t);
                }}
                onRemove={toggleFavorite}
              />
            </div>
          )}
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto p-4">
        {tab === 'portfolio' ? (
          <PortfolioPanel onPickTicker={(t) => {
            changeTab('analyze');
            setInput(t);
            void runAnalysis(t);
          }} />
        ) : tab === 'watchlist' ? (
          <WatchlistPanel
            favorites={favorites}
            onToggleFavorite={toggleFavorite}
            onPickTicker={(t) => {
              changeTab('analyze');
              setInput(t);
              void runAnalysis(t);
            }}
          />
        ) : tab === 'screener' ? (
          <ScreenerPanel
            favorites={favorites}
            onToggleFavorite={toggleFavorite}
            onPickTicker={(t) => {
              changeTab('analyze');
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

      <footer className="max-w-[1400px] mx-auto px-4 py-8 text-center text-[11px] text-slate-600">
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

function FavoritesDropdown({
  favorites,
  onAnalyze,
  onRemove,
}: {
  favorites: string[];
  onAnalyze: (ticker: string) => void;
  onRemove: (ticker: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={
          'min-h-[44px] min-w-[44px] px-3 rounded-lg border text-lg transition-colors ' +
          (open
            ? 'border-amber-500 bg-amber-900/30 text-amber-300'
            : favorites.length > 0
              ? 'border-amber-700/40 bg-amber-900/15 text-amber-400 hover:bg-amber-900/30'
              : 'border-[#1e293b] bg-[#0a0f1a] text-slate-500 hover:text-slate-300')
        }
        aria-label={`관심종목 ${favorites.length}개`}
      >
        ⭐{favorites.length > 0 && (
          <span className="ml-1 text-xs font-bold">{favorites.length}</span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-56 rounded-lg border border-[#1e293b] bg-[#0f172a] shadow-xl shadow-black/40 z-50 overflow-hidden">
          {favorites.length === 0 ? (
            <p className="px-4 py-6 text-xs text-slate-500 text-center">
              관심종목이 없습니다<br />
              분석 결과의 ⭐ 버튼으로 추가하세요
            </p>
          ) : (
            <ul className="max-h-72 overflow-y-auto py-1">
              {favorites.map((t) => (
                <li key={t} className="flex items-center">
                  <button
                    type="button"
                    onClick={() => { onAnalyze(t); setOpen(false); }}
                    className="flex-1 text-left px-4 py-2.5 text-sm font-medium text-amber-200 hover:bg-amber-900/25 transition-colors"
                  >
                    ⭐ {t}
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemove(t)}
                    className="px-3 py-2.5 text-amber-400/50 hover:text-red-400 hover:bg-red-900/30 transition-colors text-sm"
                    aria-label={`${t} 관심종목에서 제거`}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
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
