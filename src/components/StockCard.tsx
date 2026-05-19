import { useState } from 'react';
import type { AnalysisResult } from '../lib/types.js';
import { STOCK_TYPE_LABELS } from '../lib/types.js';

const LEVEL_COLOR = {
  STRONG: 'bg-emerald-500 text-white',
  WATCH: 'bg-amber-400 text-amber-950',
  NEUTRAL: 'bg-slate-300 text-slate-800',
  AVOID: 'bg-rose-500 text-white',
} as const;

const LEVEL_KO = {
  STRONG: '강력',
  WATCH: '관심',
  NEUTRAL: '중립',
  AVOID: '회피',
} as const;

function formatPct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${(v * 100).toFixed(digits)}%`;
}

function formatMcap(v: number | null | undefined, currency: string | null): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const isUSD = !currency || currency === 'USD';
  const suffix = isUSD ? '' : ` ${currency}`;
  if (Math.abs(v) >= 1e12) return `${(v / 1e12).toFixed(2)}T${suffix}`;
  if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(1)}B${suffix}`;
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(0)}M${suffix}`;
  return `${v.toFixed(0)}${suffix}`;
}

function formatRatio(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toFixed(1);
}

interface Props {
  result: AnalysisResult;
}

export function StockCard({ result }: Props) {
  const [open, setOpen] = useState(false);
  const { fundamental: f, classification: cls, entryScore: es, safetyGuard: sg, indicators: ind } = result;

  return (
    <article className="flex flex-col rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
      {/* Header */}
      <header className="px-4 pt-4 pb-3 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-baseline justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-bold text-lg leading-tight text-slate-900 dark:text-slate-100">
              {f.ticker}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
              {f.name}
            </p>
          </div>
          <span className="text-xs whitespace-nowrap text-slate-400">
            {f.sector ?? ''}
          </span>
        </div>
        <p className="mt-2 text-sm font-medium text-slate-700 dark:text-slate-200 break-words">
          {cls.display}
        </p>
        {cls.secondary && (
          <BlendBar
            primary={cls.primary}
            secondary={cls.secondary}
            primaryRatio={cls.primaryRatio}
          />
        )}
      </header>

      {/* Entry score */}
      <section className="px-4 py-3 flex items-center gap-4">
        <div
          className={`flex-shrink-0 w-16 h-16 rounded-full flex flex-col items-center justify-center font-bold ${LEVEL_COLOR[es.level]}`}
        >
          <span className="text-2xl leading-none">{es.score}</span>
          <span className="text-[10px] opacity-80 mt-1">/ 90</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-slate-500 dark:text-slate-400">Entry Score</p>
          <p className="text-base font-semibold text-slate-900 dark:text-slate-100">
            {LEVEL_KO[es.level]} ({es.level})
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            벤치 {ind.subIndustryEtf} · RS {ind.rs?.toFixed(0) ?? '—'}
          </p>
        </div>
      </section>

      {/* Safety banner */}
      {sg.triggered && sg.sectorContext && (
        <section className="mx-4 mb-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 dark:bg-amber-950/40 dark:border-amber-900">
          <p className="text-xs text-amber-900 dark:text-amber-100 leading-relaxed break-words">
            🛡️ {sg.sectorContext}
          </p>
        </section>
      )}

      {/* Metrics grid */}
      <section className="px-4 pb-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        <Metric label="시총" value={formatMcap(f.marketCap, f.currency)} />
        <Metric label="PER" value={formatRatio(f.per)} />
        <Metric label="PSR" value={formatRatio(f.psr)} />
        <Metric label="PBR" value={formatRatio(f.pbr)} />
        <Metric label="배당" value={formatPct(f.dividendYield, 2)} />
        <Metric label="ROE" value={formatPct(f.roe, 0)} />
        <Metric label="EPS YoY" value={formatPct(f.epsGrowthYoY, 0)} highlight={f.epsGrowthYoY != null && f.epsGrowthYoY > 0.2} />
        <Metric label="매출 YoY" value={formatPct(f.revenueGrowthYoY, 0)} highlight={f.revenueGrowthYoY != null && f.revenueGrowthYoY > 0.15} />
        <Metric label="ADX" value={ind.adx?.toFixed(0) ?? '—'} />
        <Metric label="거래량" value={ind.volumeRatio?.toFixed(2) + 'x' || '—'} />
        <Metric label="30일" value={formatPct(ind.return30d, 1)} />
        <Metric label="3개월" value={formatPct(ind.return90d, 1)} />
      </section>

      {/* Expandable score breakdown */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="px-4 py-3 min-h-[44px] text-left text-xs font-medium text-slate-600 dark:text-slate-400 border-t border-slate-100 dark:border-slate-800 active:bg-slate-50 dark:active:bg-slate-800"
        aria-expanded={open}
      >
        {open ? '▾ 점수 상세 닫기' : '▸ 점수 상세 보기'}
      </button>
      {open && (
        <section className="px-4 pb-4 border-t border-slate-100 dark:border-slate-800 text-xs space-y-3">
          {/* Entry score breakdown */}
          <div className="pt-3">
            <h3 className="font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Entry Score 구성
            </h3>
            <ul className="space-y-0.5">
              {es.gains.map((g, i) => (
                <li key={`g-${i}`} className="text-emerald-700 dark:text-emerald-400">
                  +{g.delta} {g.reason}
                </li>
              ))}
              {es.deductions.map((d, i) => (
                <li key={`d-${i}`} className="text-rose-700 dark:text-rose-400">
                  {d.delta} {d.reason}
                </li>
              ))}
              {es.gains.length === 0 && es.deductions.length === 0 && (
                <li className="text-slate-500">데이터 없음</li>
              )}
            </ul>
          </div>

          {/* Type candidates */}
          <div>
            <h3 className="font-semibold text-slate-700 dark:text-slate-300 mb-1">
              유형 후보 (7)
            </h3>
            <ul className="space-y-0.5">
              {cls.candidates.map((c) => (
                <li
                  key={c.type}
                  className={`flex justify-between gap-2 ${c.disqualified ? 'text-slate-400 line-through' : ''}`}
                >
                  <span>
                    {STOCK_TYPE_LABELS[c.type].emoji} {STOCK_TYPE_LABELS[c.type].ko}
                  </span>
                  <span className="font-mono">
                    {c.disqualified ? '✗' : c.score.toFixed(0)}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* Warnings */}
          {f.warnings.length > 0 && (
            <div>
              <h3 className="font-semibold text-slate-700 dark:text-slate-300 mb-1">
                데이터 경고
              </h3>
              <ul className="text-slate-500 dark:text-slate-400 space-y-0.5">
                {f.warnings.map((w, i) => (
                  <li key={i}>⚠️ {w}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </article>
  );
}

function Metric({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex justify-between items-baseline gap-1 min-w-0">
      <span className="text-slate-500 dark:text-slate-400 truncate">{label}</span>
      <span
        className={`font-mono tabular-nums truncate ${
          highlight
            ? 'font-semibold text-emerald-700 dark:text-emerald-400'
            : 'text-slate-800 dark:text-slate-200'
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function BlendBar({
  primary,
  secondary,
  primaryRatio,
}: {
  primary: keyof typeof STOCK_TYPE_LABELS;
  secondary: keyof typeof STOCK_TYPE_LABELS;
  primaryRatio: number;
}) {
  return (
    <div className="mt-2 flex h-1.5 rounded overflow-hidden bg-slate-100 dark:bg-slate-800">
      <div
        className="bg-indigo-500"
        style={{ width: `${primaryRatio}%` }}
        aria-label={`${STOCK_TYPE_LABELS[primary].ko} ${primaryRatio}%`}
      />
      <div
        className="bg-indigo-300"
        style={{ width: `${100 - primaryRatio}%` }}
        aria-label={`${STOCK_TYPE_LABELS[secondary].ko} ${100 - primaryRatio}%`}
      />
    </div>
  );
}
