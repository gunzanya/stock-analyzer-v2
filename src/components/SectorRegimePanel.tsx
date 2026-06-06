import { useEffect, useState } from 'react';
import { fetchSectorRegime } from '../lib/api.js';
import type { SectorEntry, SectorRegime, SectorStatus } from '../lib/sectorRegime.js';

const STATUS_META: Record<SectorStatus, { ko: string; emoji: string; head: string; dot: string }> = {
  leading: { ko: '주도', emoji: '🟢', head: 'text-emerald-300', dot: 'text-emerald-400' },
  neutral: { ko: '중립', emoji: '🟡', head: 'text-amber-300', dot: 'text-amber-400' },
  lagging: { ko: '부진', emoji: '🔴', head: 'text-red-300', dot: 'text-red-400' },
};

function fmtPct(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;
}

export function SectorRegimePanel() {
  const [regime, setRegime] = useState<SectorRegime | null>(null);
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [open, setOpen] = useState(true);

  useEffect(() => {
    let alive = true;
    fetchSectorRegime()
      .then((r) => {
        if (!alive) return;
        setRegime(r);
        setStatus('ok');
      })
      .catch(() => {
        if (alive) setStatus('error');
      });
    return () => {
      alive = false;
    };
  }, []);

  if (status === 'loading') {
    return (
      <div className="rounded-xl border border-[#1e293b] bg-[#0f172a] p-4 animate-pulse">
        <div className="h-4 w-44 rounded bg-[#1e293b]" />
        <div className="mt-3 h-3 w-full rounded bg-[#1e293b]/60" />
      </div>
    );
  }
  if (status === 'error' || !regime) return null;

  const counts: Record<SectorStatus, number> = { leading: 0, neutral: 0, lagging: 0 };
  for (const s of regime.sectors) counts[s.status]++;

  return (
    <section className="rounded-xl border border-[#1e293b] bg-[#0f172a] overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left hover:bg-[#1e293b]/30 transition-colors"
        aria-expanded={open}
      >
        <h3 className="text-sm font-bold flex items-center gap-2 text-slate-200">
          <span>📊</span>
          <span>섹터 레짐</span>
          <span className="text-[11px] font-normal text-slate-500">(SPY 대비)</span>
          {regime.stale && <span className="text-[10px] text-amber-400/80">⚠ 데이터 지연</span>}
        </h3>
        <div className="flex items-center gap-3 text-[11px] tabular-nums text-slate-400">
          <span>🟢 {counts.leading}</span>
          <span>🟡 {counts.neutral}</span>
          <span>🔴 {counts.lagging}</span>
          <span className="text-slate-600">{open ? '▾' : '▸'}</span>
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          {(['leading', 'neutral', 'lagging'] as const).map((st) =>
            counts[st] === 0 ? null : (
              <div key={st}>
                <p className={`text-[11px] font-bold mb-1.5 ${STATUS_META[st].head}`}>
                  {STATUS_META[st].emoji} {STATUS_META[st].ko}
                </p>
                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-1">
                  {regime.sectors
                    .filter((s) => s.status === st)
                    .map((s) => (
                      <SectorRow key={s.ticker} s={s} />
                    ))}
                </ul>
              </div>
            ),
          )}
        </div>
      )}
    </section>
  );
}

function SectorRow({ s }: { s: SectorEntry }) {
  return (
    <li className="flex items-baseline gap-2 text-[12px] sm:text-[13px] tabular-nums">
      <span className={STATUS_META[s.status].dot}>●</span>
      <span className="font-mono text-slate-500 w-10 shrink-0">{s.ticker}</span>
      <span className="text-slate-300 truncate flex-1 min-w-0">
        {s.label}
        {s.kind === 'theme' && (
          <span className="ml-1 text-[9px] text-indigo-400/70 align-middle">테마</span>
        )}
      </span>
      <span className="font-bold text-slate-100 w-7 text-right shrink-0">{s.score}</span>
      <span className="text-slate-500 w-12 text-right shrink-0">RS {s.rs}</span>
      <span
        className={`w-14 text-right shrink-0 ${
          s.return3M != null && s.return3M > 0
            ? 'text-emerald-400'
            : s.return3M != null && s.return3M < 0
              ? 'text-red-400'
              : 'text-slate-500'
        }`}
      >
        {fmtPct(s.return3M)}
      </span>
    </li>
  );
}
