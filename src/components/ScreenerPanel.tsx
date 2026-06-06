import { useEffect, useRef, useState, type MouseEvent } from 'react';
import type { ScreenerSummary } from '../lib/screenerTypes.js';
import { LEVEL_KO, SCORE_TEXT, scoreLevel } from './scoreColors.js';
import { MarketRegimeBanner } from './MarketRegimeBanner.js';
import { SectorRegimePanel } from './SectorRegimePanel.js';

type Row = ScreenerSummary;
type Status = 'idle' | 'running' | 'done' | 'error';
type PoolFilter = 'all' | 'breakout_us' | 'entry_us' | 'uptrend_us' | 'breakout_kr' | 'entry_kr' | 'uptrend_kr';
type SortKey = 'overall' | 'fundamental' | 'timing';
type SortDir = 'asc' | 'desc';

const FILTER_LABELS: Record<PoolFilter, string> = {
  all: '전체',
  breakout_us: '🔍 돌파대기(US)',
  entry_us: '🎯 진입적기(US)',
  uptrend_us: '📈 상승추세(US)',
  breakout_kr: '🔍 돌파대기(KR)',
  entry_kr: '🎯 진입적기(KR)',
  uptrend_kr: '📈 상승추세(KR)',
};

const ROW_GRID =
  'grid grid-cols-[minmax(140px,1.5fr)_80px_80px_80px_40px] items-center';

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

interface Props {
  favorites: string[];
  onToggleFavorite: (ticker: string) => void;
  onPickTicker: (ticker: string) => void;
}

export function ScreenerPanel({ favorites, onToggleFavorite, onPickTicker }: Props) {
  const [status, setStatus] = useState<Status>('idle');
  const [rows, setRows] = useState<Row[]>([]);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [strongOnly, setStrongOnly] = useState(false);
  const [hideSafetyTriggered, setHideSafetyTriggered] = useState(false);
  const [filter, setFilter] = useState<PoolFilter>('all');
  const [scanCount, setScanCount] = useState<20 | 50 | 100>(20);
  const [sortKey, setSortKey] = useState<SortKey>('overall');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const esRef = useRef<EventSource | null>(null);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  useEffect(() => {
    return () => {
      esRef.current?.close();
    };
  }, []);

  function startScan() {
    esRef.current?.close();
    setProgress({ completed: 0, total: 0 });
    setErrorMsg(null);
    setStatus('running');

    const excludeList = rows
      .map((r) => r.ticker)
      .filter(Boolean)
      .slice(0, 200);
    const excludeParam =
      excludeList.length > 0
        ? `&exclude=${encodeURIComponent(excludeList.join(','))}`
        : '';
    const es = new EventSource(
      `/api/screen?n=${scanCount}&filter=${filter}${excludeParam}&_=${Date.now()}`,
    );
    esRef.current = es;

    es.addEventListener('start', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as { total: number };
      setProgress({ completed: 0, total: data.total });
    });
    es.addEventListener('result', (e) => {
      const row = JSON.parse((e as MessageEvent).data) as Row;
      setRows((prev) => {
        const idx = prev.findIndex((r) => r.ticker === row.ticker);
        if (idx >= 0) {
          const next = prev.slice();
          next[idx] = row;
          return next;
        }
        return [...prev, row];
      });
    });
    es.addEventListener('progress', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as {
        completed: number;
        total: number;
      };
      setProgress(data);
    });
    es.addEventListener('done', () => {
      setStatus('done');
      es.close();
      esRef.current = null;
    });
    es.addEventListener('error', () => {
      if (es.readyState === EventSource.CLOSED && status === 'running') {
        setStatus('error');
        setErrorMsg('스트림 연결이 끊겼습니다.');
      } else if (es.readyState !== EventSource.OPEN) {
        setStatus((s) => (s === 'running' ? 'error' : s));
      }
    });
  }

  function stopScan() {
    esRef.current?.close();
    esRef.current = null;
    setStatus('done');
  }

  function clearRows() {
    esRef.current?.close();
    esRef.current = null;
    setRows([]);
    setProgress({ completed: 0, total: 0 });
    setStatus('idle');
    setErrorMsg(null);
  }

  const isBreakoutFilter = filter === 'breakout_us' || filter === 'breakout_kr';
  const isEntryFilter = filter === 'entry_us' || filter === 'entry_kr';
  const isUptrendFilter = filter === 'uptrend_us' || filter === 'uptrend_kr';

  const sorted = [...rows].sort((a, b) => {
    if (!a.ok && b.ok) return 1;
    if (a.ok && !b.ok) return -1;
    const valOf = (r: Row): number =>
      sortKey === 'overall' ? (r.overall ?? -1)
        : sortKey === 'fundamental' ? (r.fundamental ?? -1)
        : (r.timing ?? -1);
    return sortDir === 'desc' ? valOf(b) - valOf(a) : valOf(a) - valOf(b);
  });

  const filtered = sorted.filter((r) => {
    if (!r.ok) return !strongOnly && !isBreakoutFilter && !isEntryFilter && !isUptrendFilter;
    if (isBreakoutFilter && !r.breakoutReady) return false;
    if (isEntryFilter && !r.entryReady) return false;
    if (isUptrendFilter && !r.uptrendConfirmed) return false;
    if (strongOnly && ((r.overall ?? 0) < 70 || (r.timing ?? 0) < 45)) return false;
    if (hideSafetyTriggered && r.safetyTriggered) return false;
    return true;
  });

  const pct = progress.total > 0 ? (progress.completed / progress.total) * 100 : 0;
  // Count rows that would survive if `strongOnly` were toggled on, given the
  // other currently-active filters. Otherwise the label reads "(4)" while the
  // list shows 0 when a pool filter (돌파대기/진입적기/상승추세) or
  // hideSafetyTriggered eliminates the strong rows.
  const strongCount = rows.filter((r) => {
    if (!r.ok) return false;
    if (isBreakoutFilter && !r.breakoutReady) return false;
    if (isEntryFilter && !r.entryReady) return false;
    if (isUptrendFilter && !r.uptrendConfirmed) return false;
    if (hideSafetyTriggered && r.safetyTriggered) return false;
    return (r.overall ?? 0) >= 70 && (r.timing ?? 0) >= 45;
  }).length;

  return (
    <div className="space-y-4">
      <MarketRegimeBanner />
      <SectorRegimePanel />
      <div className="rounded-2xl border border-[#1e293b] bg-[#0f172a] p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-3 justify-between mb-3">
          <div>
            <h2 className="text-base sm:text-lg font-bold flex items-center gap-2">
              🎲 무작위 스크리너
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Yahoo Finance 스크리너에서 뽑아 실시간 분석 · 추가 스캔으로 결과 누적
            </p>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as PoolFilter)}
              disabled={status === 'running'}
              className="min-h-[40px] px-3 rounded-lg border border-[#1e293b] bg-[#0a0f1a] text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
              aria-label="종목 풀 필터"
            >
              {(Object.keys(FILTER_LABELS) as PoolFilter[]).map((f) => (
                <option key={f} value={f}>
                  {FILTER_LABELS[f]}
                </option>
              ))}
            </select>
            <select
              value={scanCount}
              onChange={(e) =>
                setScanCount(Number(e.target.value) as 20 | 50 | 100)
              }
              disabled={status === 'running'}
              className="min-h-[40px] px-3 rounded-lg border border-[#1e293b] bg-[#0a0f1a] text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
              aria-label="스캔 종목 수"
            >
              <option value={20}>20개</option>
              <option value={50}>50개</option>
              <option value={100}>100개</option>
            </select>
            {status === 'running' ? (
              <button
                type="button"
                onClick={stopScan}
                className="min-h-[40px] px-4 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-semibold transition-colors"
              >
                ⏹ 중지
              </button>
            ) : (
              <button
                type="button"
                onClick={startScan}
                className="min-h-[40px] px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold active:bg-indigo-700 transition-colors"
              >
                {rows.length === 0 ? '🎯 스캔 시작' : '➕ 추가 스캔'}
              </button>
            )}
            {rows.length > 0 && status !== 'running' && (
              <button
                type="button"
                onClick={clearRows}
                className="min-h-[40px] px-3 rounded-lg border border-[#1e293b] bg-[#0a0f1a] text-slate-300 hover:text-slate-100 hover:bg-[#1e293b] text-sm font-medium transition-colors"
              >
                🗑 초기화
              </button>
            )}
          </div>
        </div>

        {status === 'running' && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span>분석 중… {progress.completed}/{progress.total} 완료</span>
              <span>{pct.toFixed(0)}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-[#1e293b] overflow-hidden">
              <div
                className="h-full bg-indigo-500 transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}
        {status === 'error' && errorMsg && (
          <p className="text-xs text-red-300 mt-2">{errorMsg}</p>
        )}

        {rows.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 mt-4 text-xs">
            <span className="text-slate-500">
              누적 <span className="text-slate-300 font-mono">{rows.length}</span>종목
            </span>
            <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={strongOnly}
                onChange={(e) => setStrongOnly(e.target.checked)}
                className="accent-indigo-500"
              />
              <span className="text-slate-300">강력 매수만 (종합 70+ & 타이밍 45+)</span>
              <span className="text-slate-500">({strongCount})</span>
            </label>
            <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={hideSafetyTriggered}
                onChange={(e) => setHideSafetyTriggered(e.target.checked)}
                className="accent-indigo-500"
              />
              <span className="text-slate-300">안전장치 발동 숨기기</span>
            </label>
          </div>
        )}
      </div>

      {rows.length === 0 && status !== 'running' && (
        <div className="text-center py-16 text-slate-500">
          <p className="text-4xl mb-3">🎲</p>
          <p className="text-sm text-slate-300 mb-1">스캔 시작을 눌러주세요</p>
          <p className="text-[11px]">
            Yahoo Finance 스크리너에서 20/50/100종목을 무작위로 뽑아 분석합니다
          </p>
        </div>
      )}

      {filtered.length > 0 && (
        <>
          {/* Desktop grid */}
          <div className="hidden sm:block rounded-2xl border border-[#1e293b] bg-[#0f172a] overflow-hidden">
            <div
              className={`${ROW_GRID} bg-[#1e293b]/40 text-[11px] uppercase tracking-wider text-slate-400`}
            >
              <div className="px-3 py-2 font-medium">종목명</div>
              <SortHeader
                label="종합"
                active={sortKey === 'overall'}
                dir={sortDir}
                onClick={() => toggleSort('overall')}
              />
              <SortHeader
                label="펀더"
                active={sortKey === 'fundamental'}
                dir={sortDir}
                onClick={() => toggleSort('fundamental')}
              />
              <SortHeader
                label="타이밍"
                active={sortKey === 'timing'}
                dir={sortDir}
                onClick={() => toggleSort('timing')}
              />
              <div className="px-3 py-2 font-medium" />
            </div>
            {filtered.map((r) => (
              <RowItem
                key={r.ticker}
                row={r}
                isFavorite={favorites.includes(r.ticker)}
                onToggleFavorite={() => onToggleFavorite(r.ticker)}
                onPick={() => onPickTicker(r.ticker)}
              />
            ))}
          </div>
          {/* Mobile cards */}
          <div className="sm:hidden space-y-2">
            {filtered.map((r) => (
              <MobileCard
                key={r.ticker}
                row={r}
                isFavorite={favorites.includes(r.ticker)}
                onToggleFavorite={() => onToggleFavorite(r.ticker)}
                onPick={() => onPickTicker(r.ticker)}
              />
            ))}
          </div>
        </>
      )}

      {rows.length > 0 && filtered.length === 0 && status !== 'running' && (
        <div className="text-center py-10 text-slate-500 text-sm">
          필터 조건에 맞는 종목이 없습니다.
        </div>
      )}
    </div>
  );
}

function SortHeader({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
}) {
  const arrow = active ? (dir === 'desc' ? '▼' : '▲') : '↕';
  return (
    <div className="px-3 py-2 font-medium text-right">
      <button
        type="button"
        onClick={onClick}
        className={
          'inline-flex items-center gap-1 hover:text-slate-200 transition-colors ' +
          (active ? 'text-indigo-300' : 'text-slate-400')
        }
      >
        {label}
        <span className="text-[9px]">{arrow}</span>
      </button>
    </div>
  );
}

function RowItem({
  row,
  isFavorite,
  onToggleFavorite,
  onPick,
}: {
  row: Row;
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
  const overallLevel = scoreLevel(row.overall ?? 0);
  const fundLevel = scoreLevel(row.fundamental ?? 0);
  const timingLevel = scoreLevel(row.timing ?? 0);
  return (
    <a
      href={tickerHref(row.ticker)}
      onClick={linkClickHandler(onPick)}
      className={`${ROW_GRID} border-t border-[#1e293b] hover:bg-[#1e293b]/30 transition-colors no-underline text-inherit`}
    >
      <div className="px-3 py-2">
        <div className="flex items-center gap-1.5">
          <span className="font-mono font-semibold text-slate-100">{row.ticker}</span>
          {row.safetyTriggered && <span title="안전장치 발동" className="text-xs">🚨</span>}
        </div>
        <div className="text-[10px] text-slate-500 truncate max-w-[180px]">
          {row.name ?? ''}
        </div>
      </div>
      <div className={`px-3 py-2 text-right font-mono font-semibold ${SCORE_TEXT[overallLevel]}`}>
        {Math.round(row.overall ?? 0)}
        <div className="text-[10px] text-slate-500 font-normal">
          {row.overallLevel ? LEVEL_KO[row.overallLevel] : ''}
        </div>
      </div>
      <div className={`px-3 py-2 text-right font-mono font-semibold ${SCORE_TEXT[fundLevel]}`}>
        {Math.round(row.fundamental ?? 0)}
      </div>
      <div className={`px-3 py-2 text-right font-mono font-semibold ${SCORE_TEXT[timingLevel]}`}>
        {Math.round(row.timing ?? 0)}
      </div>
      <div className="px-3 py-2 text-center">
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onToggleFavorite();
          }}
          className="text-lg leading-none hover:scale-110 transition-transform"
          aria-label={isFavorite ? '관심종목 제거' : '관심종목 추가'}
        >
          {isFavorite ? '⭐' : '☆'}
        </button>
      </div>
    </a>
  );
}

function MobileCard({
  row,
  isFavorite,
  onToggleFavorite,
  onPick,
}: {
  row: Row;
  isFavorite: boolean;
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
  const overallLevel = scoreLevel(row.overall ?? 0);
  const fundLevel = scoreLevel(row.fundamental ?? 0);
  const timingLevel = scoreLevel(row.timing ?? 0);
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
            {row.safetyTriggered && <span title="안전장치 발동">🚨</span>}
          </div>
          <p className="text-[11px] text-slate-500 truncate">{row.name ?? ''}</p>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onToggleFavorite();
          }}
          className="text-xl leading-none cursor-pointer"
          aria-label={isFavorite ? '관심종목 제거' : '관심종목 추가'}
        >
          {isFavorite ? '⭐' : '☆'}
        </button>
      </div>
      <div className="flex gap-4 mt-2 text-xs">
        <div>
          <span className="text-slate-500">종합 </span>
          <span className={`font-mono font-semibold ${SCORE_TEXT[overallLevel]}`}>
            {Math.round(row.overall ?? 0)}
          </span>
          <span className="text-slate-500 ml-1">
            ({row.overallLevel ? LEVEL_KO[row.overallLevel] : ''})
          </span>
        </div>
        <div>
          <span className="text-slate-500">펀더 </span>
          <span className={`font-mono font-semibold ${SCORE_TEXT[fundLevel]}`}>
            {Math.round(row.fundamental ?? 0)}
          </span>
        </div>
        <div>
          <span className="text-slate-500">타이밍 </span>
          <span className={`font-mono font-semibold ${SCORE_TEXT[timingLevel]}`}>
            {Math.round(row.timing ?? 0)}
          </span>
        </div>
      </div>
    </a>
  );
}
