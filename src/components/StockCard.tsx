import { useEffect, useMemo, useState } from 'react';
import type {
  AnalysisResult,
  ClassificationResult,
  StockType,
  StrategyResult,
} from '../lib/types.js';
import { STOCK_TYPE_LABELS } from '../lib/types.js';
import { computeStrategy } from '../lib/strategy.js';
import { mixedDisplay } from '../lib/typeWeights.js';
import { getTypeInsight } from '../lib/typeInsights.js';
import { TotalScoreCard } from './TotalScoreCard.js';
import { CanslimBars } from './CanslimBars.js';
import { SafetyBanner } from './SafetyBanner.js';
import { StrategyCard } from './StrategyCard.js';
import { PriceChart } from './PriceChart.js';
import { TypeInsightCard } from './TypeInsightCard.js';
import { TypeAuxCard } from './TypeAuxCard.js';
import { RiskFactorsCard } from './RiskFactorsCard.js';
import { TimingDetailCard } from './TimingDetailCard.js';
import { AddToPortfolioModal } from './AddToPortfolioModal.js';
import { SupplyDemandCard } from './SupplyDemandCard.js';
import { NewsCard } from './NewsCard.js';
import { saveScoreEntry, loadScoreHistory, type ScoreEntry } from '../lib/scoreHistory.js';

const STOCK_TYPE_ORDER: StockType[] = [
  'FAST_GROWER',
  'STALWART',
  'SLOW_GROWER',
  'CYCLICAL',
  'TURNAROUND',
  'ASSET_PLAY',
  'SPECULATIVE',
];

const FX_FALLBACK_USDKRW = 1380;

type DisplayCurrency = 'USD' | 'KRW';

function convertPrice(
  value: number | null,
  from: string | null,
  to: DisplayCurrency,
  rate: number,
): number | null {
  if (value == null) return null;
  const fromU = (from ?? 'USD').toUpperCase();
  if (fromU === to) return value;
  if (fromU === 'USD' && to === 'KRW') return value * rate;
  if (fromU === 'KRW' && to === 'USD') return value / rate;
  return value;
}

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

// Same convention as PriceChart's formatPrice / header price block, so the
// indicator panel renders EMA20/SMA50/SMA200 the way the rest of the card
// (and chart tooltip) does. KRW → rounded with separators, USD → 2 decimals.
function formatNativePrice(
  v: number | null | undefined,
  currency: DisplayCurrency,
): string {
  if (v == null || !Number.isFinite(v)) return '—';
  if (currency === 'KRW') return Math.round(v).toLocaleString('en-US');
  return v.toFixed(2);
}

interface Props {
  result: AnalysisResult;
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
}

export function StockCard({ result, isFavorite = false, onToggleFavorite }: Props) {
  const [open, setOpen] = useState(false);
  const [showPortfolioModal, setShowPortfolioModal] = useState(false);
  const [override, setOverride] = useState<StockType | null>(null);
  const f = result.fundamental;
  const cls = result.classification;
  const ind = result.indicators;

  const [scoreHistory, setScoreHistory] = useState<ScoreEntry[]>([]);

  const nativeCurrency: DisplayCurrency =
    (f.currency ?? 'USD').toUpperCase() === 'KRW' ? 'KRW' : 'USD';
  const [displayCurrency, setDisplayCurrency] =
    useState<DisplayCurrency>(nativeCurrency);
  const fxRate = result.usdKrwRate ?? FX_FALLBACK_USDKRW;
  const fxFallbackUsed = result.usdKrwRate == null;

  const effectiveType: StockType = override ?? cls.primary;
  const isOverride = override !== null;

  // Scores are always server-computed and type-independent.
  const fundamentalScore = result.fundamentalScore;
  const overallScore = result.overallScore;

  // UI-level display label (X / Y 혼합 when top-2 close).
  const aiDisplay = cls.uncertain ? cls.display : mixedDisplay(cls);
  // Chase-warning is surfaced as a high-severity risk message — detect it
  // here to flip the entry grade label without recomputing thresholds.
  const chaseWarning = result.riskFactors.some((r) =>
    r.message.startsWith('🚨 사이클 상단'),
  );

  // Only typeInsight + strategy change with override.
  const { typeInsight, strategy } = useMemo(() => {
    if (!isOverride) {
      return {
        typeInsight: result.typeInsight,
        strategy: result.strategy,
      };
    }
    const syntheticCls: ClassificationResult = {
      primary: override!,
      primaryRatio: 100,
      secondary: null,
      secondaryRatio: 0,
      confidence: 100,
      candidates: cls.candidates,
      display: '',
      uncertain: false,
    };
    return {
      typeInsight: getTypeInsight(override!),
      strategy:
        result.priceBars.length >= 50
          ? computeStrategy(result.priceBars, syntheticCls)
          : result.strategy,
    };
  }, [
    isOverride,
    override,
    result.priceBars,
    result.typeInsight,
    result.strategy,
    cls.candidates,
  ]);

  const displayStrategy: StrategyResult = useMemo(() => {
    if (displayCurrency === nativeCurrency) return strategy;
    return {
      ...strategy,
      entry: convertPrice(strategy.entry, nativeCurrency, displayCurrency, fxRate),
      stop: convertPrice(strategy.stop, nativeCurrency, displayCurrency, fxRate),
      target1: convertPrice(strategy.target1, nativeCurrency, displayCurrency, fxRate),
      target2: convertPrice(strategy.target2, nativeCurrency, displayCurrency, fxRate),
    };
  }, [strategy, displayCurrency, nativeCurrency, fxRate]);

  const displayPrice = convertPrice(
    f.price,
    nativeCurrency,
    displayCurrency,
    fxRate,
  );
  useEffect(() => {
    saveScoreEntry(
      f.ticker,
      overallScore.score,
      fundamentalScore.score,
      result.timingScore.score,
    );
    setScoreHistory(loadScoreHistory(f.ticker));
  }, [f.ticker, overallScore.score, fundamentalScore.score, result.timingScore.score]);

  const canToggleFx = nativeCurrency === 'USD' || nativeCurrency === 'KRW';

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
              <button
                type="button"
                onClick={() => setShowPortfolioModal(true)}
                className="inline-flex items-center justify-center min-w-[32px] min-h-[32px] -my-1 rounded text-base text-slate-600 hover:text-indigo-400 transition-colors"
                aria-label="포트폴리오 추가"
              >
                💼
              </button>
              <span className="text-[10px] text-slate-500 truncate">
                {f.exchange ?? ''}
              </span>
            </div>
            <p className="text-sm text-slate-400 truncate">{f.name}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {f.sector ?? '—'} · {f.industry ?? '—'}
            </p>
            {result.targetPriceGap && (
              <p className="text-[11px] text-slate-400 mt-0.5">
                목표가{' '}
                {nativeCurrency === 'KRW'
                  ? `₩${Math.round(result.targetPriceGap.targetMeanPrice).toLocaleString()}`
                  : `$${result.targetPriceGap.targetMeanPrice.toFixed(2)}`}
                {' '}(괴리{' '}
                <span className={
                  result.targetPriceGap.gapPercent >= 15 ? 'text-emerald-400'
                  : result.targetPriceGap.gapPercent < 0 ? 'text-red-400'
                  : 'text-slate-400'
                }>
                  {result.targetPriceGap.gapPercent > 0 ? '+' : ''}
                  {result.targetPriceGap.gapPercent.toFixed(1)}%
                </span>)
                {result.targetPriceGap.delta !== 0 && (
                  <span className={result.targetPriceGap.delta > 0 ? 'text-emerald-400 ml-1' : 'text-red-400 ml-1'}>
                    펀더 {result.targetPriceGap.delta > 0 ? '+' : ''}{result.targetPriceGap.delta}
                  </span>
                )}
              </p>
            )}
          </div>
          <div className="text-right flex-shrink-0">
            <div className="flex items-center justify-end gap-1.5">
              <p className="text-2xl font-bold tabular-nums text-slate-100">
                {displayPrice != null
                  ? displayCurrency === 'KRW'
                    ? Math.round(displayPrice).toLocaleString()
                    : displayPrice.toFixed(2)
                  : '—'}
              </p>
              {canToggleFx && (
                <button
                  type="button"
                  onClick={() =>
                    setDisplayCurrency((c) => (c === 'USD' ? 'KRW' : 'USD'))
                  }
                  className="min-h-[28px] min-w-[28px] px-1.5 rounded-md border border-[#1e293b] bg-[#0a0f1a] text-xs text-slate-300 hover:bg-[#1e293b] active:bg-[#1e293b]/70 transition-colors"
                  aria-label={
                    displayCurrency === 'USD'
                      ? 'KRW로 환산'
                      : 'USD로 환산'
                  }
                  title={
                    fxFallbackUsed
                      ? `1 USD = ${FX_FALLBACK_USDKRW}원 (기본값)`
                      : `1 USD = ${Math.round(fxRate).toLocaleString()}원`
                  }
                >
                  {displayCurrency === 'USD' ? '₩' : '💲'}
                </button>
              )}
            </div>
            <p className="text-[10px] text-slate-500">
              {displayCurrency}
              {displayCurrency !== nativeCurrency && (
                <span className="ml-1 text-slate-600">
                  · 환율 {Math.round(fxRate).toLocaleString()}
                  {fxFallbackUsed && ' (기본)'}
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <label
              htmlFor={`type-select-${f.ticker}`}
              className="text-[10px] uppercase tracking-wider font-bold text-slate-500"
            >
              유형 직접 선택
            </label>
            <select
              id={`type-select-${f.ticker}`}
              value={override ?? ''}
              onChange={(e) =>
                setOverride(
                  e.target.value === '' ? null : (e.target.value as StockType),
                )
              }
              className="min-h-[32px] px-2 py-1 rounded-md bg-[#0a0f1a] border border-[#1e293b] text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            >
              <option value="">🤖 AI 추천</option>
              {STOCK_TYPE_ORDER.map((t) => {
                const { emoji, ko } = STOCK_TYPE_LABELS[t];
                return (
                  <option key={t} value={t}>
                    {emoji} {ko}
                  </option>
                );
              })}
            </select>
            {isOverride && (
              <button
                type="button"
                onClick={() => setOverride(null)}
                className="text-[11px] text-slate-400 hover:text-slate-200 underline underline-offset-2"
              >
                AI 추천으로 복원
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {isOverride ? (
              <>
                <span className="px-2.5 py-1 rounded-full text-xs font-semibold border bg-amber-500/15 border-amber-700/50 text-amber-200">
                  ✋ 수동 선택: {STOCK_TYPE_LABELS[override!].emoji}{' '}
                  {STOCK_TYPE_LABELS[override!].ko}
                </span>
                <span className="px-2 py-1 rounded-full text-[11px] border border-slate-700 bg-slate-800/40 text-slate-400">
                  🤖 AI 추천: {aiDisplay}
                </span>
              </>
            ) : (
              <>
                <span
                  className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${
                    cls.uncertain
                      ? 'bg-slate-700/40 border-slate-600 text-slate-300'
                      : 'bg-indigo-500/15 border-indigo-700/50 text-indigo-300'
                  }`}
                >
                  🤖 AI 추천: {aiDisplay}
                </span>
                {!cls.uncertain && (
                  <span className="text-[11px] text-slate-500">
                    신뢰도 {cls.confidence}%
                  </span>
                )}
              </>
            )}
          </div>
        </div>
        {cls.uncertain && !isOverride && (
          <p className="mt-2 text-[11px] text-slate-500 leading-relaxed">
            7개 유형 모두 30점 미만. 다른 카드의 점수·인사이트·전략은 신뢰하지
            마세요. 데이터 경고를 확인하거나 정확한 티커로 재시도하세요. 또는
            위 드롭다운에서 유형을 직접 선택해 점수·인사이트를 재계산할 수
            있습니다.
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
        <TotalScoreCard
          overall={overallScore}
          fundamental={fundamentalScore}
          timing={result.timingScore}
          chaseWarning={chaseWarning}
        />
      </div>

      {/* Score history strip (14-day) */}
      {scoreHistory.length >= 2 && (
        <div className="px-5 pt-2">
          <ScoreHistoryStrip history={scoreHistory} />
        </div>
      )}

      {/* Timing precision analysis */}
      {result.timingDetail && (
        <div className="px-5 pt-4">
          <TimingDetailCard detail={result.timingDetail} />
        </div>
      )}

      {/* Supply & Demand (Korean stocks only) */}
      {result.supplyDemand ? (
        <div className="px-5 pt-4">
          <SupplyDemandCard data={result.supplyDemand} />
        </div>
      ) : /\.(KS|KQ)$/i.test(result.fundamental.ticker) && (
        <div className="px-5 pt-4">
          <section className="rounded-xl border border-[#1e293b] bg-[#0a0f1a] p-4">
            <h3 className="text-[10px] uppercase tracking-wider font-bold text-slate-500">
              수급 (외인·기관)
            </h3>
            <p className="mt-2 text-xs text-slate-500">데이터 없음</p>
          </section>
        </div>
      )}

      {/* News */}
      {result.news && result.news.length > 0 && (
        <div className="px-5 pt-4">
          <NewsCard news={result.news} />
        </div>
      )}

      {/* Strategy */}
      <div className="px-5 pt-4">
        <StrategyCard strategy={displayStrategy} currency={displayCurrency} />
      </div>

      {showPortfolioModal && (
        <AddToPortfolioModal
          ticker={f.ticker}
          name={f.name}
          currentPrice={f.price}
          stopPrice={strategy.stop}
          targetPrice={strategy.target1}
          target2Price={strategy.target2}
          atr14={strategy.atr14}
          strategyType={effectiveType}
          scores={{
            fundamental: fundamentalScore.score,
            timing: Math.round(result.timingScore.score),
            overall: overallScore.score,
          }}
          fxRate={fxRate}
          onClose={() => setShowPortfolioModal(false)}
          onAdded={() => setShowPortfolioModal(false)}
        />
      )}

      {/* Price chart */}
      <div className="px-5 pt-4">
        <PriceChart bars={result.priceBars} currency={nativeCurrency} />
      </div>

      {/* CANSLIM */}
      <div className="px-5 pt-4">
        <CanslimBars canslim={result.canslim} primaryType={effectiveType} />
      </div>

      {/* Type-specific auxiliary indicators (only for some types) */}
      {(['SLOW_GROWER', 'CYCLICAL', 'ASSET_PLAY', 'TURNAROUND'] as const).includes(
        effectiveType as 'SLOW_GROWER' | 'CYCLICAL' | 'ASSET_PLAY' | 'TURNAROUND',
      ) && (
        <div className="px-5 pt-4">
          <TypeAuxCard type={effectiveType} fund={f} />
        </div>
      )}

      {/* Type insight */}
      <div className="px-5 pt-4">
        <TypeInsightCard insight={typeInsight} />
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
              <Metric label="EMA20" value={formatNativePrice(ind.ema20, nativeCurrency)} />
              <Metric label="SMA50" value={formatNativePrice(ind.sma50, nativeCurrency)} />
              <Metric label="SMA200" value={formatNativePrice(ind.sma200, nativeCurrency)} />
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

function ScoreHistoryStrip({ history }: { history: ScoreEntry[] }) {
  const streak80 = (() => {
    let count = 0;
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].overall >= 80) count++;
      else break;
    }
    return count;
  })();

  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-slate-500 shrink-0">14일 추이</span>
      <div className="flex items-end gap-px">
        {history.map((h, i) => (
          <div
            key={i}
            className={`w-2.5 rounded-sm ${
              h.overall >= 70
                ? 'bg-emerald-500'
                : h.overall >= 60
                  ? 'bg-amber-400'
                  : h.overall >= 50
                    ? 'bg-slate-400'
                    : 'bg-red-500'
            }`}
            style={{ height: `${Math.max(4, (h.overall / 100) * 20)}px` }}
            title={`${h.date}: 종합 ${h.overall} / 펀더 ${h.fundamental} / 타이밍 ${h.timing}`}
          />
        ))}
      </div>
      {streak80 >= 3 && (
        <span className="text-[10px] text-emerald-400">{streak80}일 연속 80+</span>
      )}
    </div>
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
