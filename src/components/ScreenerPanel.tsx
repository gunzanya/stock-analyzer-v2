import { useEffect, useRef, useState } from 'react';
import type { ScreenerSummary } from '../lib/screenerTypes.js';
import { STOCK_TYPE_LABELS } from '../lib/types.js';
import { LEVEL_KO, SCORE_TEXT, scoreLevel } from './scoreColors.js';

type Row = ScreenerSummary;
type Status = 'idle' | 'running' | 'done' | 'error';

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
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    return () => {
      esRef.current?.close();
    };
  }, []);

  function startScan() {
    esRef.current?.close();
    setRows([]);
    setProgress({ completed: 0, total: 0 });
    setErrorMsg(null);
    setStatus('running');

    const es = new EventSource(`/api/screen?n=20&_=${Date.now()}`);
    esRef.current = es;

    es.addEventListener('start', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as { total: number };
      setProgress({ completed: 0, total: data.total });
    });
    es.addEventListener('result', (e) => {
      const row = JSON.parse((e as MessageEvent).data) as Row;
      setRows((prev) => [...prev, row]);
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
      // EventSource fires 'error' on completion too; only flag error if we
      // never received the 'done' event.
      if (es.readyState === EventSource.CLOSED && status === 'running') {
        setStatus('error');
        setErrorMsg('스트림 연결이 끊겼습니다.');
      } else if (es.readyState !== EventSource.OPEN) {
        // network/server error mid-stream
        setStatus((s) => (s === 'running' ? 'error' : s));
      }
    });
  }

  function stopScan() {
    esRef.current?.close();
    esRef.current = null;
    setStatus('done');
  }

  // Sort by totalScore desc (failed rows at the bottom)
  const sorted = [...rows].sort((a, b) => {
    if (!a.ok && b.ok) return 1;
    if (a.ok && !b.ok) return -1;
    return (b.totalScore ?? -1) - (a.totalScore ?? -1);
  });

  const filtered = sorted.filter((r) => {
    if (!r.ok) return !strongOnly; // failed rows: drop in strong-only mode
    if (strongOnly && ((r.totalScore ?? 0) < 70 || (r.entryScore ?? 0) < 50)) return false;
    if (hideSafetyTriggered && r.safetyTriggered) return false;
    return true;
  });

  const pct = progress.total > 0 ? (progress.completed / progress.total) * 100 : 0;
  const strongCount = rows.filter(
    (r) => r.ok && (r.totalScore ?? 0) >= 70 && (r.entryScore ?? 0) >= 50,
  ).length;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[#1e293b] bg-[#0f172a] p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-3 justify-between mb-3">
          <div>
            <h2 className="text-base sm:text-lg font-bold flex items-center gap-2">
              🎲 무작위 스크리너
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              미국 주요 종목 풀에서 20개를 무작위로 뽑아 실시간 분석
            </p>
          </div>
          <div className="flex gap-2">
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
                {status === 'idle' ? '🎯 스캔 시작' : '🔄 다시 스캔'}
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
            <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={strongOnly}
                onChange={(e) => setStrongOnly(e.target.checked)}
                className="accent-indigo-500"
              />
              <span className="text-slate-300">강력 매수만 (Total 70+ & Entry 50+)</span>
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
            랜덤 20개 종목을 분석해 TotalScore 순으로 정렬합니다
          </p>
        </div>
      )}

      {filtered.length > 0 && (
        <>
          {/* Desktop / tablet table */}
          <div className="hidden sm:block rounded-2xl border border-[#1e293b] bg-[#0f172a] overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-[#1e293b]/40 text-[11px] uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">티커</th>
                  <th className="text-left px-3 py-2 font-medium">유형</th>
                  <th className="text-right px-3 py-2 font-medium">Total</th>
                  <th className="text-right px-3 py-2 font-medium">Entry</th>
                  <th className="text-center px-3 py-2 font-medium">안전</th>
                  <th className="text-center px-3 py-2 font-medium w-12"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <Row
                    key={r.ticker}
                    row={r}
                    isFavorite={favorites.includes(r.ticker)}
                    onToggleFavorite={() => onToggleFavorite(r.ticker)}
                    onPick={() => onPickTicker(r.ticker)}
                  />
                ))}
              </tbody>
            </table>
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

function typeBadge(primary: ScreenerSummary['primary']) {
  if (!primary) return '—';
  const { emoji, ko } = STOCK_TYPE_LABELS[primary];
  return `${emoji} ${ko}`;
}

function Row({
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
      <tr className="border-t border-[#1e293b]">
        <td className="px-3 py-2 font-mono font-semibold text-red-300">{row.ticker}</td>
        <td colSpan={4} className="px-3 py-2 text-xs text-red-400">
          {row.error ?? '분석 실패'}
        </td>
        <td className="px-3 py-2"></td>
      </tr>
    );
  }
  const totalLevel = scoreLevel(row.totalScore ?? 0);
  const entryLevel = scoreLevel(row.entryScore ?? 0);
  return (
    <tr
      className="border-t border-[#1e293b] hover:bg-[#1e293b]/30 cursor-pointer transition-colors"
      onClick={onPick}
    >
      <td className="px-3 py-2">
        <div className="font-mono font-semibold text-slate-100">{row.ticker}</div>
        <div className="text-[10px] text-slate-500 truncate max-w-[180px]">
          {row.name ?? ''}
        </div>
      </td>
      <td className="px-3 py-2 text-xs text-slate-200">
        {row.uncertain ? '❓ 불확실' : typeBadge(row.primary)}
      </td>
      <td className={`px-3 py-2 text-right font-mono font-semibold ${SCORE_TEXT[totalLevel]}`}>
        {Math.round(row.totalScore ?? 0)}
        <div className="text-[10px] text-slate-500 font-normal">
          {row.totalLevel ? LEVEL_KO[row.totalLevel] : ''}
        </div>
      </td>
      <td className={`px-3 py-2 text-right font-mono font-semibold ${SCORE_TEXT[entryLevel]}`}>
        {Math.round(row.entryScore ?? 0)}
        <div className="text-[10px] text-slate-500 font-normal">
          {row.entryLevel ? LEVEL_KO[row.entryLevel] : ''}
        </div>
      </td>
      <td className="px-3 py-2 text-center">
        {row.safetyTriggered ? (
          <span className="text-red-400 text-base" title="안전장치 발동">
            🚨
          </span>
        ) : (
          <span className="text-slate-600">·</span>
        )}
      </td>
      <td className="px-3 py-2 text-center">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite();
          }}
          className="text-lg leading-none hover:scale-110 transition-transform"
          aria-label={isFavorite ? '관심종목 제거' : '관심종목 추가'}
        >
          {isFavorite ? '⭐' : '☆'}
        </button>
      </td>
    </tr>
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
  const totalLevel = scoreLevel(row.totalScore ?? 0);
  const entryLevel = scoreLevel(row.entryScore ?? 0);
  return (
    <button
      type="button"
      onClick={onPick}
      className="w-full text-left rounded-xl border border-[#1e293b] bg-[#0f172a] p-3 hover:bg-[#1e293b]/40 transition-colors"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono font-semibold text-slate-100">{row.ticker}</span>
            {row.safetyTriggered && <span title="안전장치 발동">🚨</span>}
          </div>
          <p className="text-[11px] text-slate-500 truncate">{row.name ?? ''}</p>
          <p className="text-xs text-slate-300 mt-1">
            {row.uncertain ? '❓ 불확실' : typeBadge(row.primary)}
          </p>
        </div>
        <div
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite();
          }}
          className="text-xl leading-none cursor-pointer"
          aria-label={isFavorite ? '관심종목 제거' : '관심종목 추가'}
        >
          {isFavorite ? '⭐' : '☆'}
        </div>
      </div>
      <div className="flex gap-4 mt-2 text-xs">
        <div>
          <span className="text-slate-500">Total </span>
          <span className={`font-mono font-semibold ${SCORE_TEXT[totalLevel]}`}>
            {Math.round(row.totalScore ?? 0)}
          </span>
          <span className="text-slate-500 ml-1">
            ({row.totalLevel ? LEVEL_KO[row.totalLevel] : ''})
          </span>
        </div>
        <div>
          <span className="text-slate-500">Entry </span>
          <span className={`font-mono font-semibold ${SCORE_TEXT[entryLevel]}`}>
            {Math.round(row.entryScore ?? 0)}
          </span>
        </div>
      </div>
    </button>
  );
}
