import { useEffect, useState } from 'react';
import { fetchMarketRegime } from '../lib/api.js';
import type { MarketRegime, RegimeKind } from '../lib/marketRegime.js';

const TONE: Record<RegimeKind, string> = {
  attack: 'from-emerald-950/80 to-emerald-900/30 border-emerald-700/70 text-emerald-100',
  neutral: 'from-amber-950/80 to-amber-900/30 border-amber-700/70 text-amber-100',
  defense: 'from-red-950/80 to-red-900/40 border-red-700 text-red-100',
};

export function MarketRegimeBanner() {
  const [regime, setRegime] = useState<MarketRegime | null>(null);
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');

  useEffect(() => {
    let alive = true;
    fetchMarketRegime()
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
        <div className="h-4 w-40 rounded bg-[#1e293b]" />
        <div className="mt-3 h-3 w-full rounded bg-[#1e293b]/60" />
      </div>
    );
  }
  if (status === 'error' || !regime) {
    // Stay quiet on failure — the regime banner is a helper, not core data.
    return null;
  }

  const scoreSign = regime.totalScore >= 0 ? '+' : '';
  const tone = TONE[regime.regime];

  return (
    <section className={`rounded-xl border bg-gradient-to-r ${tone} p-4`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-sm sm:text-base font-bold flex items-center gap-2">
          <span>📊</span>
          <span>시장 레짐:</span>
          <span>{regime.emoji} {regime.label}</span>
          <span className="text-xs font-mono opacity-80 tabular-nums">
            (점수 {scoreSign}{regime.totalScore})
          </span>
        </h3>
        {regime.stale && (
          <span className="text-[10px] opacity-70">⚠ 일부 데이터 지연</span>
        )}
      </div>

      <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-1.5">
        {regime.signals.map((s) => (
          <li
            key={s.key}
            className="flex items-baseline justify-between gap-2 text-[12px] sm:text-[13px]"
          >
            <span className="opacity-80">{s.label}</span>
            <span className="flex items-baseline gap-1.5 min-w-0">
              <span className="font-semibold tabular-nums whitespace-nowrap">{s.value}</span>
              <span>{s.emoji}</span>
              <span className="opacity-70 text-[11px] truncate hidden sm:inline">{s.note}</span>
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-3 pt-3 border-t border-white/10 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
        <span className="font-semibold opacity-90">권장: {regime.recommendation}</span>
        <span className="opacity-70">
          {regime.guide.positions} · {regime.guide.size} · {regime.guide.grade} · {regime.guide.cash}
        </span>
      </div>
    </section>
  );
}
