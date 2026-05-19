import { useState } from 'react';
import type { AnalysisResult } from '../lib/types.js';
import { STOCK_TYPE_LABELS } from '../lib/types.js';
import { TotalScoreCard } from './TotalScoreCard.js';
import { CanslimBars } from './CanslimBars.js';
import { SafetyBanner } from './SafetyBanner.js';
import { StrategyCard } from './StrategyCard.js';
import { PriceChart } from './PriceChart.js';
import { TypeInsightCard } from './TypeInsightCard.js';
import { RiskFactorsCard } from './RiskFactorsCard.js';

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
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
}

export function StockCard({ result, isFavorite = false, onToggleFavorite }: Props) {
  const [open, setOpen] = useState(false);
  const f = result.fundamental;
  const cls = result.classification;
  const ind = result.indicators;
  return (
    <article className="flex flex-col rounded-2xl bg-[#0f172a] border border-[#1e293b] overflow-hidden">
      {/* Header */}
      <header className="px-5 pt-5 pb-4 border-b border-[#1e293b]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <h2 className="text-xl font-bold text-slate-100">{f.ticker}</h2>
              {onToggleFavorite && (
                <button
                  type="button"
                  onClick={onToggleFavorite}
                  className={`inline-flex items-center justify-center min-w-[32px] min-h-[32px] -my-1 rounded text-base transition-colors ${
                    isFavorite
                      ? 'text-amber-400 hover:text-amber-300'
                      : 'text-slate-600 hover:text-slate-400'
                  }`}
                  aria-label={
                    isFavorite ? '관심종목에서 제거' : '관심종목에 추가'
                  }
                  aria-pressed={isFavorite}
                >
                  {isFavorite ? '⭐' : '☆'}
                </button>
              )}
              <span className="text-[10px] text-slate-500 truncate">
                {f.exchange ?? ''}
              </span>
            </div>
            <p className="text-sm text-slate-400 truncate">{f.name}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {f.sector ?? '—'} · {f.industry ?? '—'}
            </p>
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-2xl font-bold tabular-nums text-slate-100">
              {f.price != null ? f.price.toFixed(2) : '—'}
            </p>
            <p className="text-[10px] text-slate-500">{f.currency ?? 'USD'}</p>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <span
            className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${
              cls.uncertain
                ? 'bg-slate-700/40 border-slate-600 text-slate-300'
                : 'bg-indigo-500/15 border-indigo-700/50 text-indigo-300'
            }`}
          >
            {cls.display}
          </span>
          {!cls.uncertain && (
            <span className="text-[11px] text-slate-500">
              신뢰도 {cls.confidence}%
            </span>
          )}
        </div>
        {cls.uncertain && (
          <p className="mt-2 text-[11px] text-slate-500 leading-relaxed">
            7개 유형 모두 30점 미만. 다른 카드의 점수·인사이트·전략은 신뢰하지
            마세요. 데이터 경고를 확인하거나 정확한 티커로 재시도하세요.
          </p>
        )}
      </header>

      {/* Safety banner (only when triggered) */}
      {result.safetyGuard.triggered && (
        <div className="px-5 pt-4">
          <SafetyBanner safety={result.safetyGuard} />
        </div>
      )}

      {/* Score row */}
      <div className="px-5 pt-4">
        <TotalScoreCard total={result.totalScore} entry={result.entryScore} />
      </div>

      {/* Strategy */}
      <div className="px-5 pt-4">
        <StrategyCard strategy={result.strategy} currency={f.currency} />
      </div>

      {/* Price chart */}
      <div className="px-5 pt-4">
        <PriceChart
          bars={result.priceBars}
          ema20={ind.ema20}
          sma50={ind.sma50}
          sma200={ind.sma200}
        />
      </div>

      {/* CANSLIM */}
      <div className="px-5 pt-4">
        <CanslimBars canslim={result.canslim} primaryType={cls.primary} />
      </div>

      {/* Type insight */}
      <div className="px-5 pt-4">
        <TypeInsightCard insight={result.typeInsight} />
      </div>

      {/* Risk factors */}
      <div className="px-5 pt-4 pb-5">
        <RiskFactorsCard risks={result.riskFactors} />
      </div>

      {/* Expandable: raw fundamentals */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="px-5 py-3 min-h-[44px] text-left text-xs font-medium text-slate-400 border-t border-[#1e293b] hover:bg-[#1e293b]/30 active:bg-[#1e293b]"
        aria-expanded={open}
      >
        {open ? '▾ 펀더멘털 / 후보 점수 닫기' : '▸ 펀더멘털 / 후보 점수 보기'}
      </button>
      {open && (
        <section className="px-5 pb-5 text-xs border-t border-[#1e293b] space-y-4">
          <div className="pt-4">
            <h3 className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-2">
              펀더멘털
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-1.5">
              <Metric label="시총" value={formatMcap(f.marketCap, f.currency)} />
              <Metric label="PER" value={formatRatio(f.per)} />
              <Metric label="PSR" value={formatRatio(f.psr)} />
              <Metric label="PBR" value={formatRatio(f.pbr)} />
              <Metric label="PEG" value={formatRatio(f.peg)} />
              <Metric label="배당" value={formatPct(f.dividendYield, 2)} />
              <Metric label="ROE" value={formatPct(f.roe, 0)} />
              <Metric label="영업이익률" value={formatPct(f.operatingMargin, 0)} />
              <Metric label="순이익률" value={formatPct(f.netMargin, 0)} />
              <Metric label="EPS YoY" value={formatPct(f.epsGrowthYoY, 0)} />
              <Metric label="매출 YoY" value={formatPct(f.revenueGrowthYoY, 0)} />
              <Metric label="부채/자본" value={formatRatio(f.debtToEquity)} />
            </div>
          </div>

          <div>
            <h3 className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-2">
              7유형 후보 점수
            </h3>
            <ul className="space-y-1">
              {cls.candidates.map((c) => (
                <li
                  key={c.type}
                  className={`flex justify-between gap-2 tabular-nums ${c.disqualified ? 'text-slate-600 line-through' : 'text-slate-300'}`}
                >
                  <span>
                    {STOCK_TYPE_LABELS[c.type].emoji} {STOCK_TYPE_LABELS[c.type].ko}
                  </span>
                  <span className="font-mono">
                    {c.disqualified ? '✗ 자격박탈' : c.score}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-2">
              지표
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-1.5">
              <Metric label="벤치마크" value={ind.subIndustryEtf ?? '—'} />
              <Metric label="RS" value={ind.rs?.toFixed(0) ?? '—'} />
              <Metric label="ADX" value={ind.adx?.toFixed(0) ?? '—'} />
              <Metric label="거래량" value={ind.volumeRatio != null ? ind.volumeRatio.toFixed(2) + 'x' : '—'} />
              <Metric label="30일" value={formatPct(ind.return30d)} />
              <Metric label="3개월" value={formatPct(ind.return90d)} />
              <Metric label="1년" value={formatPct(ind.return1y)} />
              <Metric label="EMA20" value={ind.ema20?.toFixed(2) ?? '—'} />
              <Metric label="SMA50" value={ind.sma50?.toFixed(2) ?? '—'} />
              <Metric label="SMA200" value={ind.sma200?.toFixed(2) ?? '—'} />
              <Metric label="OBV div" value={ind.obvDivergence === true ? '있음' : ind.obvDivergence === false ? '없음' : '—'} />
            </div>
          </div>

          {f.warnings.length > 0 && (
            <div>
              <h3 className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-2">
                데이터 경고
              </h3>
              <ul className="space-y-0.5 text-slate-500">
                {f.warnings.map((w, i) => (
                  <li key={i}>⚠ {w}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-baseline gap-1 min-w-0">
      <span className="text-slate-500 truncate">{label}</span>
      <span className="font-mono tabular-nums truncate text-slate-200">{value}</span>
    </div>
  );
}
