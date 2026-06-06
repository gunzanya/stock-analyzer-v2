import { useEffect, useRef, useState, type MouseEvent } from 'react';
import type { ScreenerSummary } from '../lib/screenerTypes.js';
import { SCORE_TEXT, scoreLevel } from './scoreColors.js';
import { loadScoreHistory, saveScoreEntry, type ScoreEntry } from '../lib/scoreHistory.js';
import { STOCK_TYPE_LABELS, type StockType } from '../lib/types.js';
import { MarketRegimeBanner } from './MarketRegimeBanner.js';
import { SectorRegimePanel } from './SectorRegimePanel.js';

type Status = 'idle' | 'running' | 'done' | 'error';
type SortKey = 'overall' | 'fundamental' | 'timing' | 'ema20Pct' | 'changePct' | 'status';
type SortDir = 'asc' | 'desc';

const CACHE_TTL_MS = 5 * 60 * 1000;

const ROW_GRID =
  'grid grid-cols-[minmax(110px,1.3fr)_60px_70px_50px_50px_50px_50px_55px_50px] items-center';

function typeBadge(r: ScreenerSummary): { icons: string; title: string } | null {
  if (!r.primary) return null;
  if (r.uncertain) return { icons: '❓', title: '분류 불확실' };
  const primary = r.primary as StockType;
  const primaryLabel = STOCK_TYPE_LABELS[primary];
  if (!primaryLabel) return null;
  const secondary = r.secondary as StockType | null | undefined;
  const secondaryLabel = secondary ? STOCK_TYPE_LABELS[secondary] : null;
  if (secondaryLabel) {
    return {
      icons: `${primaryLabel.emoji}/${secondaryLabel.emoji}`,
      title: `${primaryLabel.ko} / ${secondaryLabel.ko}`,
    };
  }
  return { icons: primaryLabel.emoji, title: primaryLabel.ko };
}

function tickerHref(t: string): string {
  return `/?ticker=${encodeURIComponent(t)}`;
}

function linkClickHandler(inApp: () => void) {
  return (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    inApp();
  };
}

function statusOf(r: ScreenerSummary): { icon: string; label: string } {
  if (r.entryReady) return { icon: '🎯', label: '진입 적기' };
  if (r.breakoutReady) return { icon: '🔍', label: '돌파 대기' };
  if (r.uptrendConfirmed) return { icon: '📈', label: '상승 추세' };
  if (r.safetyTriggered) return { icon: '⚠️', label: '주의' };
  return { icon: '—', label: '' };
}

function statusRank(r: ScreenerSummary): number {
  if (r.entryReady) return 1;
  if (r.breakoutReady) return 2;
  if (r.uptrendConfirmed) return 3;
  if (r.safetyTriggered) return 4;
  return 5;
}

interface Props {
  favorites: string[];
  onToggleFavorite: (ticker: string) => void;
  onPickTicker: (ticker: string) => void;
}

export function WatchlistPanel({ favorites, onToggleFavorite, onPickTicker }: Props) {
  const [status, setStatus] = useState<Status>('idle');
  const [rows, setRows] = useState<ScreenerSummary[]>([]);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('overall');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [histories, setHistories] = useState<Record<string, ScoreEntry[]>>({});
  const esRef = useRef<EventSource | null>(null);
  const cacheTimeRef = useRef<number>(0);
  const cachedFavsRef = useRef<string>('');

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortDir('desc'); }
  }

  useEffect(() => () => { esRef.current?.close(); }, []);

  const favsKey = favorites.slice().sort().join(',');
  useEffect(() => {
    if (favorites.length === 0) {
      setRows([]);
      setStatus('idle');
      return;
    }
    const cacheValid =
      cacheTimeRef.current > 0 &&
      Date.now() - cacheTimeRef.current < CACHE_TTL_MS &&
      cachedFavsRef.current === favsKey;
    if (cacheValid) {
      const h: Record<string, ScoreEntry[]> = {};
      for (const t of favorites) h[t] = loadScoreHistory(t);
      setHistories(h);
      return;
    }
    startScan();
  }, [favsKey]);

  function startScan() {
    if (favorites.length === 0) return;
    esRef.current?.close();
    setProgress({ completed: 0, total: 0 });
    setErrorMsg(null);
    setStatus('running');
    setRows([]);

    const tickerList = encodeURIComponent(favorites.join(','));
    const es = new EventSource(
      `/api/screen?tickers=${tickerList}&mode=watchlist&_=${Date.now()}`,
    );
    esRef.current = es;

    es.addEventListener('start', (e) => {
      const d = JSON.parse((e as MessageEvent).data) as { total: number };
      setProgress({ completed: 0, total: d.total });
    });
    es.addEventListener('result', (e) => {
      const row = JSON.parse((e as MessageEvent).data) as ScreenerSummary;
      if (row.ok && row.overall != null && row.fundamental != null && row.timing != null) {
        saveScoreEntry(row.ticker, row.overall, row.fundamental, row.timing);
      }
      setRows(prev => {
        const idx = prev.findIndex(r => r.ticker === row.ticker);
        if (idx >= 0) { const next = prev.slice(); next[idx] = row; return next; }
        return [...prev, row];
      });
    });
    es.addEventListener('progress', (e) => {
      setProgress(JSON.parse((e as MessageEvent).data));
    });
    es.addEventListener('done', () => {
      setStatus('done');
      cacheTimeRef.current = Date.now();
      cachedFavsRef.current = favsKey;
      es.close();
      esRef.current = null;
      const h: Record<string, ScoreEntry[]> = {};
      for (const t of favorites) h[t] = loadScoreHistory(t);
      setHistories(h);
    });
    es.addEventListener('error', () => {
      if (es.readyState !== EventSource.OPEN) {
        setStatus(s => s === 'running' ? 'error' : s);
        setErrorMsg('스트림 연결이 끊겼습니다.');
      }
    });
  }

  const sorted = [...rows].sort((a, b) => {
    if (!a.ok && b.ok) return 1;
    if (a.ok && !b.ok) return -1;
    if (sortKey === 'status') {
      const diff = statusRank(a) - statusRank(b);
      return sortDir === 'desc' ? diff : -diff;
    }
    const valOf = (r: ScreenerSummary): number => {
      if (sortKey === 'overall') return r.overall ?? -1;
      if (sortKey === 'fundamental') return r.fundamental ?? -1;
      if (sortKey === 'timing') return r.timing ?? -1;
      if (sortKey === 'ema20Pct') return r.ema20Pct ?? -999;
      return r.changePct ?? -999;
    };
    return sortDir === 'desc' ? valOf(b) - valOf(a) : valOf(a) - valOf(b);
  });

  const pct = progress.total > 0 ? (progress.completed / progress.total) * 100 : 0;

  if (favorites.length === 0) {
    return (
      <div className="text-center py-20 text-slate-500">
        <p className="text-4xl mb-3">⭐</p>
        <p className="text-sm text-slate-300 mb-1">관심종목이 없습니다</p>
        <p className="text-[11px]">개별 분석에서 ⭐ 버튼을 눌러 관심종목을 추가하세요</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <MarketRegimeBanner />
      <SectorRegimePanel />
      <div className="rounded-2xl border border-[#1e293b] bg-[#0f172a] p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <div>
            <h2 className="text-base sm:text-lg font-bold flex items-center gap-2">
              ⭐ 관심종목
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {favorites.length}개 종목 · 5분 캐시 · 실시간 SSE 분석
            </p>
          </div>
          <button
            type="button"
            onClick={startScan}
            disabled={status === 'running'}
            className="min-h-[40px] px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold active:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {status === 'running' ? '분석 중…' : '🔄 새로고침'}
          </button>
        </div>

        {status === 'running' && (
          <div className="space-y-1 mt-3">
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span>분석 중… {progress.completed}/{progress.total}</span>
              <span>{pct.toFixed(0)}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-[#1e293b] overflow-hidden">
              <div className="h-full bg-indigo-500 transition-all duration-300" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}
        {status === 'error' && errorMsg && (
          <p className="text-xs text-red-300 mt-2">{errorMsg}</p>
        )}
      </div>

      {sorted.length > 0 && (
        <>
          {/* Desktop grid */}
          <div className="hidden sm:block rounded-2xl border border-[#1e293b] bg-[#0f172a] overflow-hidden">
            <div className={`${ROW_GRID} bg-[#1e293b]/40 text-[10px] uppercase tracking-wider text-slate-400`}>
              <div className="px-3 py-2 font-medium">종목명</div>
              <div className="px-2 py-2 font-medium text-center">유형</div>
              <div className="px-2 py-2 font-medium text-right">현재가</div>
              <SortHeader label="등락" active={sortKey === 'changePct'} dir={sortDir} onClick={() => toggleSort('changePct')} />
              <SortHeader label="종합" active={sortKey === 'overall'} dir={sortDir} onClick={() => toggleSort('overall')} />
              <SortHeader label="펀더" active={sortKey === 'fundamental'} dir={sortDir} onClick={() => toggleSort('fundamental')} />
              <SortHeader label="타이밍" active={sortKey === 'timing'} dir={sortDir} onClick={() => toggleSort('timing')} />
              <SortHeader label="EMA20" active={sortKey === 'ema20Pct'} dir={sortDir} onClick={() => toggleSort('ema20Pct')} />
              <SortHeader label="상태" active={sortKey === 'status'} dir={sortDir} onClick={() => toggleSort('status')} center />
            </div>
            {sorted.map(r => (
              <WatchRow
                key={r.ticker}
                row={r}
                history={histories[r.ticker]}
                isFavorite={true}
                onToggleFavorite={() => onToggleFavorite(r.ticker)}
                onPick={() => onPickTicker(r.ticker)}
              />
            ))}
          </div>
          {/* Mobile cards */}
          <div className="sm:hidden space-y-2">
            {sorted.map(r => (
              <WatchMobileCard
                key={r.ticker}
                row={r}
                history={histories[r.ticker]}
                onToggleFavorite={() => onToggleFavorite(r.ticker)}
                onPick={() => onPickTicker(r.ticker)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function SortHeader({ label, active, dir, onClick, center }: {
  label: string; active: boolean; dir: SortDir; onClick: () => void; center?: boolean;
}) {
  const arrow = active ? (dir === 'desc' ? '▼' : '▲') : '↕';
  return (
    <div className={`px-2 py-2 font-medium ${center ? 'text-center' : 'text-right'}`}>
      <button
        type="button"
        onClick={onClick}
        className={'inline-flex items-center gap-0.5 hover:text-slate-200 transition-colors ' +
          (active ? 'text-indigo-300' : 'text-slate-400')}
      >
        {label}
        <span className="text-[8px]">{arrow}</span>
      </button>
    </div>
  );
}

function MiniHistoryStrip({ history }: { history?: ScoreEntry[] }) {
  if (!history || history.length < 2) return null;
  return (
    <div className="flex items-end gap-px mt-0.5">
      {history.map((h, i) => (
        <div
          key={i}
          className={`w-1.5 rounded-[1px] ${
            h.overall >= 70 ? 'bg-emerald-500'
            : h.overall >= 60 ? 'bg-amber-400'
            : h.overall >= 50 ? 'bg-slate-400'
            : 'bg-red-500'
          }`}
          style={{ height: `${Math.max(2, (h.overall / 100) * 12)}px` }}
          title={`${h.date}: ${h.overall}`}
        />
      ))}
    </div>
  );
}

function formatPrice(v: number | null | undefined): string {
  if (v == null) return '—';
  if (v >= 10000) return Math.round(v).toLocaleString();
  if (v >= 100) return v.toFixed(1);
  return v.toFixed(2);
}

function WatchRow({ row, history, isFavorite, onToggleFavorite, onPick }: {
  row: ScreenerSummary;
  history?: ScoreEntry[];
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onPick: () => void;
}) {
  if (!row.ok) {
    return (
      <div className="border-t border-[#1e293b] grid grid-cols-[140px_1fr] items-center">
        <div className="px-3 py-2 font-mono font-semibold text-red-300">{row.ticker}</div>
        <div className="px-3 py-2 text-xs text-red-400">{row.error ?? '분석 실패'}</div>
      </div>
    );
  }
  const oLvl = scoreLevel(row.overall ?? 0);
  const fLvl = scoreLevel(row.fundamental ?? 0);
  const tLvl = scoreLevel(row.timing ?? 0);
  const st = statusOf(row);
  const chg = row.changePct;
  const ema = row.ema20Pct;
  const tb = typeBadge(row);
  return (
    <a
      href={tickerHref(row.ticker)}
      onClick={linkClickHandler(onPick)}
      className={`${ROW_GRID} border-t border-[#1e293b] hover:bg-[#1e293b]/30 transition-colors no-underline text-inherit`}
    >
      <div className="px-3 py-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={e => { e.preventDefault(); e.stopPropagation(); onToggleFavorite(); }}
            className="text-sm leading-none hover:scale-110 transition-transform"
          >
            {isFavorite ? '⭐' : '☆'}
          </button>
          <span className="font-mono font-semibold text-slate-100 text-xs">{row.ticker}</span>
        </div>
        <div className="text-[9px] text-slate-500 truncate max-w-[140px] ml-5">{row.name ?? ''}</div>
        <div className="ml-5"><MiniHistoryStrip history={history} /></div>
      </div>
      <div className="px-2 py-2 text-center text-xs" title={tb?.title ?? ''}>
        {tb ? tb.icons : '—'}
      </div>
      <div className="px-2 py-2 text-right text-xs font-mono text-slate-200">
        {formatPrice(row.price)}
      </div>
      <div className={`px-2 py-2 text-right text-xs font-mono ${
        chg != null ? (chg >= 0 ? 'text-emerald-400' : 'text-red-400') : 'text-slate-500'
      }`}>
        {chg != null ? `${chg >= 0 ? '+' : ''}${chg.toFixed(1)}%` : '—'}
      </div>
      <div className={`px-2 py-2 text-right text-xs font-mono font-semibold ${SCORE_TEXT[oLvl]}`}>
        {Math.round(row.overall ?? 0)}
      </div>
      <div className={`px-2 py-2 text-right text-xs font-mono font-semibold ${SCORE_TEXT[fLvl]}`}>
        {Math.round(row.fundamental ?? 0)}
      </div>
      <div className={`px-2 py-2 text-right text-xs font-mono font-semibold ${SCORE_TEXT[tLvl]}`}>
        {Math.round(row.timing ?? 0)}
      </div>
      <div className={`px-2 py-2 text-right text-xs font-mono ${
        ema != null ? (Math.abs(ema) <= 2 ? 'text-emerald-400' : ema > 0 ? 'text-amber-400' : 'text-red-400') : 'text-slate-500'
      }`}>
        {ema != null ? `${ema >= 0 ? '+' : ''}${ema.toFixed(1)}%` : '—'}
      </div>
      <div className="px-2 py-2 text-center text-sm" title={st.label}>
        {st.icon}
      </div>
    </a>
  );
}

function WatchMobileCard({ row, history, onToggleFavorite, onPick }: {
  row: ScreenerSummary;
  history?: ScoreEntry[];
  onToggleFavorite: () => void;
  onPick: () => void;
}) {
  if (!row.ok) {
    return (
      <div className="rounded-xl border border-red-900 bg-red-950/40 p-3">
        <p className="font-mono font-semibold text-red-200">{row.ticker}</p>
        <p className="text-xs text-red-300 mt-1">{row.error ?? '분석 실패'}</p>
      </div>
    );
  }
  const oLvl = scoreLevel(row.overall ?? 0);
  const fLvl = scoreLevel(row.fundamental ?? 0);
  const tLvl = scoreLevel(row.timing ?? 0);
  const st = statusOf(row);
  const chg = row.changePct;
  const ema = row.ema20Pct;
  const tb = typeBadge(row);
  return (
    <a
      href={tickerHref(row.ticker)}
      onClick={linkClickHandler(onPick)}
      className="block rounded-xl border border-[#1e293b] bg-[#0f172a] p-3 hover:bg-[#1e293b]/40 transition-colors no-underline text-inherit"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono font-semibold text-slate-100">{row.ticker}</span>
            {tb && <span title={tb.title}>{tb.icons}</span>}
            {st.icon !== '—' && <span title={st.label}>{st.icon}</span>}
          </div>
          <p className="text-[11px] text-slate-500 truncate">{row.name ?? ''}</p>
          <MiniHistoryStrip history={history} />
        </div>
        <div className="text-right shrink-0">
          <div className="text-sm font-mono text-slate-200">{formatPrice(row.price)}</div>
          <div className={`text-xs font-mono ${chg != null ? (chg >= 0 ? 'text-emerald-400' : 'text-red-400') : 'text-slate-500'}`}>
            {chg != null ? `${chg >= 0 ? '+' : ''}${chg.toFixed(1)}%` : ''}
          </div>
        </div>
      </div>
      <div className="flex gap-3 mt-2 text-xs">
        <div>
          <span className="text-slate-500">종합 </span>
          <span className={`font-mono font-semibold ${SCORE_TEXT[oLvl]}`}>{Math.round(row.overall ?? 0)}</span>
        </div>
        <div>
          <span className="text-slate-500">펀더 </span>
          <span className={`font-mono font-semibold ${SCORE_TEXT[fLvl]}`}>{Math.round(row.fundamental ?? 0)}</span>
        </div>
        <div>
          <span className="text-slate-500">타이밍 </span>
          <span className={`font-mono font-semibold ${SCORE_TEXT[tLvl]}`}>{Math.round(row.timing ?? 0)}</span>
        </div>
        <div className={`font-mono ${ema != null ? (Math.abs(ema) <= 2 ? 'text-emerald-400' : ema > 0 ? 'text-amber-400' : 'text-red-400') : 'text-slate-500'}`}>
          EMA {ema != null ? `${ema >= 0 ? '+' : ''}${ema.toFixed(1)}%` : '—'}
        </div>
      </div>
      <div className="flex items-center justify-end mt-2">
        <button
          type="button"
          onClick={e => { e.preventDefault(); e.stopPropagation(); onToggleFavorite(); }}
          className="text-lg leading-none cursor-pointer"
        >
          ⭐
        </button>
      </div>
    </a>
  );
}
