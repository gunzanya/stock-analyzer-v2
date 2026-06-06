import type { VercelRequest, VercelResponse } from '@vercel/node';
import { fetchFundamental, fetchPriceHistory, fetchUsdKrwRate, fetchNaverSupplyDemand, fetchNews } from './fetchStock.js';
import { classify } from '../src/lib/typeWeights.js';
import {
  adx as adxOf,
  atrTrend as atrTrendOf,
  ema,
  ema20Slope as ema20SlopeOf,
  obvBearishDivergence,
  resolveBenchmarkEtf,
  return1y,
  return30d,
  return90d,
  relativeStrength,
  rsi as rsiOf,
  rsiDivergence as rsiDivergenceOf,
  sma,
  supportResistanceClusters,
  volumePattern as volumePatternOf,
  volumeRatio,
} from '../src/lib/indicators.js';
import { evaluateSafetyGuard } from '../src/lib/safetyGuard.js';
import { applyCoherenceFloor, computeTiming } from '../src/lib/entryScore.js';
import { computeTimingComposite } from '../src/lib/timingComposite.js';
import { computeCanslim } from '../src/lib/canslim.js';
import { computeFundamental } from '../src/lib/totalScore.js';
import { computeOverall } from '../src/lib/overallScore.js';
import { computeStrategy } from '../src/lib/strategy.js';
import { getTypeInsight } from '../src/lib/typeInsights.js';
import { extractRiskFactors } from '../src/lib/riskFactors.js';
import type { AnalysisResult, TimingDetail, SupplyDemandData, NewsItem } from '../src/lib/types.js';

// Per-block defensive wrapper: a single indicator/scoring throw must never
// take down the whole analysis. Logs and falls back so newly-listed tickers
// (e.g. <200 bars → no SMA200) still produce a usable result.
function safe<T>(label: string, fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch (err) {
    console.warn(`[analyze] ${label} failed:`, (err as Error).message);
    return fallback;
  }
}

async function analyzeOne(ticker: string): Promise<AnalysisResult> {
  const fund = await fetchFundamental(ticker);
  const benchEtf = resolveBenchmarkEtf(fund);

  let stockBars: Awaited<ReturnType<typeof fetchPriceHistory>> = [];
  let benchBars: Awaited<ReturnType<typeof fetchPriceHistory>> = [];
  let usdKrwRate: number | null = null;
  try {
    stockBars = await fetchPriceHistory(ticker);
  } catch (err) {
    fund.warnings.push(`stock price history failed: ${(err as Error).message}`);
  }
  try {
    benchBars = await fetchPriceHistory(benchEtf);
  } catch (err) {
    fund.warnings.push(`benchmark (${benchEtf}) price history failed: ${(err as Error).message}`);
  }
  try {
    usdKrwRate = await fetchUsdKrwRate();
  } catch {
    usdKrwRate = null;
  }

  // Price fallback: if Yahoo's quoteSummary failed (e.g. new IPO with
  // "internal-error"), fund.price is null — fill from the latest price bar.
  if (fund.price == null && stockBars.length > 0) {
    fund.price = stockBars[0].close;
  }

  const classification = classify(fund);
  const isKoreanTicker = /\.(KS|KQ)$/i.test(fund.ticker);

  let supplyDemand: SupplyDemandData | null = null;
  if (isKoreanTicker) {
    try {
      supplyDemand = await fetchNaverSupplyDemand(fund.ticker);
    } catch (err) {
      console.warn(`[${fund.ticker}] supplyDemand fetch failed:`, (err as Error).message);
      supplyDemand = null;
    }
  }
  let news: NewsItem[] = [];
  try {
    news = await fetchNews(ticker, fund.name);
  } catch {
    news = [];
  }

  // Has *any* usable price data — individual indicator guards (e.g. SMA50
  // needs 50 bars, SMA200 needs 200) decide what they can compute and return
  // null otherwise. Don't block the whole analysis on a 50-bar minimum since
  // newly-listed tickers (2025+ IPOs) routinely have less history than that.
  const hasPrices = stockBars.length > 0 && benchBars.length >= 20;

  const safetyGuardFallback = {
    triggered: false,
    reasons: ['price history unavailable'],
    sectorContext: null,
    sectorReturn3M: null,
    stockReturn3M: null,
    excessVsSector: null,
  };
  const safetyGuard = hasPrices
    ? safe(
        'safetyGuard',
        () => evaluateSafetyGuard({
          stockBars,
          benchmarkBars: benchBars,
          benchmarkLabel: benchEtf,
        }),
        safetyGuardFallback,
      )
    : safetyGuardFallback;

  const timingFallback = {
    score: 0,
    gains: [],
    deductions: [{ reason: '가격 데이터 없음', delta: 0 }],
    level: 'NEUTRAL' as const,
  };
  const timingScore = hasPrices
    ? safe(
        'timingScore',
        () => computeTiming({
          stockBars,
          benchmarkBars: benchBars,
          absoluteMode: isKoreanTicker,
          primaryType: classification.primary,
          supplyDemand,
        }),
        timingFallback,
      )
    : timingFallback;

  const rs = hasPrices
    ? safe('rs', () => relativeStrength(stockBars, benchBars, { absoluteMode: isKoreanTicker }).rs, null)
    : null;
  const adx = hasPrices ? safe('adx', () => adxOf(stockBars), null) : null;
  const vr = hasPrices ? safe('volumeRatio', () => volumeRatio(stockBars), null) : null;
  const r30 = hasPrices ? safe('return30d', () => return30d(stockBars), null) : null;
  const r90 = hasPrices ? safe('return90d', () => return90d(stockBars), null) : null;
  const r1y = hasPrices ? safe('return1y', () => return1y(stockBars), null) : null;
  const rsiVal = hasPrices ? safe('rsi', () => rsiOf(stockBars, 14), null) : null;
  const ema20 = hasPrices ? safe('ema20', () => ema(stockBars, 20), null) : null;
  // SMA50/SMA200 return null when bars < period — UI renders these as "—".
  const sma50 = hasPrices ? safe('sma50', () => sma(stockBars, 50), null) : null;
  const sma200 = hasPrices ? safe('sma200', () => sma(stockBars, 200), null) : null;

  const indicators = {
    rs,
    adx,
    obvDivergence: hasPrices ? safe('obvDivergence', () => obvBearishDivergence(stockBars), null) : null,
    volumeRatio: vr,
    return30d: r30,
    return90d: r90,
    return1y: r1y,
    subIndustryEtf: benchEtf,
    rsi: rsiVal,
    ema20,
    sma50,
    sma200,
  };

  const canslim = safe(
    'canslim',
    () => computeCanslim({
      fund,
      stockBars,
      benchBars,
      rs,
      adx,
      volumeRatio: vr,
      return90d: r90,
    }),
    { items: [] } as ReturnType<typeof computeCanslim>,
  );
  const fundamentalScore = safe(
    'fundamentalScore',
    () => computeFundamental(canslim, classification, fund),
    {
      score: 50,
      level: 'NEUTRAL' as const,
      topContributors: [],
      bottomContributors: [],
      peakEarningsPenalty: null,
    },
  );

  // Target price gap adjustment
  let targetPriceGap: AnalysisResult['targetPriceGap'] = null;
  if (fund.targetMeanPrice != null && fund.price != null && fund.price > 0) {
    const gapPct = ((fund.targetMeanPrice - fund.price) / fund.price) * 100;
    let delta = 0;
    if (gapPct >= 30) delta = 5;
    else if (gapPct >= 15) delta = 3;
    else if (gapPct >= 0) delta = 0;
    else delta = -5;

    targetPriceGap = {
      targetMeanPrice: fund.targetMeanPrice,
      gapPercent: Math.round(gapPct * 10) / 10,
      delta,
    };

    if (delta !== 0) {
      fundamentalScore.score = Math.max(0, Math.min(100, fundamentalScore.score + delta));
      if (!classification.uncertain) {
        fundamentalScore.level =
          fundamentalScore.score >= 70 ? 'STRONG'
          : fundamentalScore.score >= 50 ? 'WATCH'
          : fundamentalScore.score >= 30 ? 'NEUTRAL'
          : 'AVOID';
      }
    }
  }

  const adjustedTiming = safe(
    'adjustedTiming',
    () => applyCoherenceFloor(timingScore, fundamentalScore.score),
    timingScore,
  );
  const overallScore = safe(
    'overallScore',
    () => computeOverall(fundamentalScore, adjustedTiming, classification.primary),
    { score: fundamentalScore.score, level: fundamentalScore.level },
  );
  const strategyFallback = {
    entry: null,
    stop: null,
    target1: null,
    target2: null,
    riskReward1: null,
    riskReward2: null,
    atr14: null,
    stopRule: '데이터 부족',
    rationale: '가격 데이터가 부족해 전략을 산출할 수 없습니다.',
    exitStrategy: '데이터 부족',
    rrWarning: null,
  };
  const strategy = hasPrices
    ? safe('strategy', () => computeStrategy(stockBars, classification), strategyFallback)
    : strategyFallback;
  const typeInsight = getTypeInsight(classification.primary);
  const riskFactors = safe(
    'riskFactors',
    () => extractRiskFactors({
      fund,
      safety: safetyGuard,
      indicators,
      stockBars,
    }),
    [],
  );
  if (fundamentalScore.peakEarningsPenalty) {
    const pct = fund.epsGrowthYoY != null ? `+${(fund.epsGrowthYoY * 100).toFixed(0)}%` : '';
    riskFactors.push({
      severity: 'medium',
      message: `이익 피크 가능성 (순환 섹터 EPS ${pct})`,
    });
  }

  // Chase warning — two paths:
  //   (A) peak earnings + sharp 30d + light EMA stretch (cyclical top of cycle)
  //   (B) heavy EMA stretch (>+20%) + sharp 30d (>+40%) — pure chase regardless
  //       of fundamentals; pairs with the timing cap in entryScore.ts.
  // Surfaces as a high-severity risk; UI derives the "추격주의" entry grade
  // from the message prefix.
  const has30dSurge = indicators.return30d != null && indicators.return30d > 0.4;
  const emaStretchPct =
    indicators.ema20 != null && fund.price != null && indicators.ema20 > 0
      ? (fund.price - indicators.ema20) / indicators.ema20
      : null;
  const pathA =
    fundamentalScore.peakEarningsPenalty != null &&
    has30dSurge &&
    emaStretchPct != null && emaStretchPct > 0.10;
  const pathB =
    has30dSurge && emaStretchPct != null && emaStretchPct > 0.20;
  if (pathA || pathB) {
    const r30 = (indicators.return30d! * 100).toFixed(0);
    const stretch = (emaStretchPct! * 100).toFixed(0);
    const tag = pathA ? '이익피크 + ' : '';
    riskFactors.unshift({
      severity: 'high',
      message: `🚨 사이클 상단 추격 위험 — ${tag}30일 +${r30}% + EMA20 대비 +${stretch}%`,
    });
  }

  // ---- Timing precision analysis (5 sub-signals) ----
  let timingDetail: TimingDetail | null = null;
  if (hasPrices) {
    const rsiDiv = safe('rsiDivergence', () => rsiDivergenceOf(stockBars), 'none' as const);
    const emaSlopeResult = safe('ema20Slope', () => ema20SlopeOf(stockBars), null);
    const volPattern = safe('volumePattern', () => volumePatternOf(stockBars), null);
    const atrTrendResult = safe('atrTrend', () => atrTrendOf(stockBars), null);
    const clusters = safe('supportResistance', () => supportResistanceClusters(stockBars), []);

    const rsiDivDesc =
      rsiDiv === 'bearish'
        ? '주가 신고가 vs RSI 고점 하락 — 숨은 약세 다이버전스'
        : rsiDiv === 'bullish'
          ? '주가 신저가 vs RSI 저점 상승 — 숨은 강세 다이버전스'
          : 'RSI 다이버전스 없음';

    const emaSlopeDesc = emaSlopeResult
      ? emaSlopeResult.signal === 'strong_up'
        ? `EMA20 기울기 +${emaSlopeResult.slope.toFixed(2)}%/일 — 강한 모멘텀`
        : emaSlopeResult.signal === 'up'
          ? `EMA20 기울기 +${emaSlopeResult.slope.toFixed(2)}%/일 — 상승 모멘텀`
          : emaSlopeResult.signal === 'flat'
            ? `EMA20 기울기 ${emaSlopeResult.slope.toFixed(2)}%/일 — 모멘텀 둔화/평평`
            : emaSlopeResult.signal === 'down'
              ? `EMA20 기울기 ${emaSlopeResult.slope.toFixed(2)}%/일 — 하락 전환`
              : `EMA20 기울기 ${emaSlopeResult.slope.toFixed(2)}%/일 — 강한 하락`
      : null;

    const volPatternDesc = volPattern
      ? volPattern.signal === 'accumulation'
        ? `상승일 거래량/하락일 거래량 = ${volPattern.ratio.toFixed(2)} — 건강한 매집`
        : volPattern.signal === 'distribution'
          ? `상승일 거래량/하락일 거래량 = ${volPattern.ratio.toFixed(2)} — 분배(매도) 진행`
          : `상승일 거래량/하락일 거래량 = ${volPattern.ratio.toFixed(2)} — 중립`
      : null;

    const atrTrendDesc = atrTrendResult
      ? atrTrendResult.signal === 'expanding'
        ? `ATR 변화율 ${atrTrendResult.changeRatio.toFixed(2)}x — 변동성 확대, 큰 움직임 진행`
        : atrTrendResult.signal === 'contracting'
          ? `ATR 변화율 ${atrTrendResult.changeRatio.toFixed(2)}x — 에너지 압축, 돌파 임박`
          : `ATR 변화율 ${atrTrendResult.changeRatio.toFixed(2)}x — 변동성 안정`
      : null;

    const srDesc =
      clusters.length > 0
        ? clusters
            .map(
              (c) =>
                `${c.type === 'support' ? '지지' : '저항'} ${c.price.toFixed(0)} (${c.sources.join('+')} 겹침, ${c.distancePct.toFixed(1)}% 거리)`,
            )
            .join(' | ')
        : '근접 클러스터 없음';

    timingDetail = {
      rsiDivergence: { signal: rsiDiv, description: rsiDivDesc },
      ema20Slope: emaSlopeResult
        ? { slope: emaSlopeResult.slope, signal: emaSlopeResult.signal, description: emaSlopeDesc! }
        : null,
      volumePattern: volPattern
        ? { ratio: volPattern.ratio, signal: volPattern.signal, description: volPatternDesc! }
        : null,
      atrTrend: atrTrendResult
        ? { changeRatio: atrTrendResult.changeRatio, signal: atrTrendResult.signal, description: atrTrendDesc! }
        : null,
      supportResistance: { clusters, description: srDesc },
    };
  }

  // Stage-1 parallel: compute the new Trend Composite alongside legacy
  // timing for log-only comparison. Result is NOT returned to the UI and
  // NOT used by the screener/entry-grade — those still consume
  // `adjustedTiming.score`. Wrapped in `safe` so a failure here never
  // breaks an analysis.
  safe(
    'timingComposite',
    () => {
      if (!hasPrices) return null;
      const comp = computeTimingComposite({
        stockBars,
        benchmarkBars: benchBars,
        absoluteMode: isKoreanTicker,
        primaryType: classification.primary,
        peakEarningsPenalty: fundamentalScore.peakEarningsPenalty != null,
      });
      const legacy = adjustedTiming.score;
      const diff = comp.composite - legacy;
      const sign = diff >= 0 ? '+' : '';
      console.log(
        `[timingComposite ${fund.ticker}] legacy=${legacy} new=${comp.composite} ` +
          `(Δ${sign}${diff.toFixed(1)}) | entryLoc=${comp.entryLocation} ` +
          `trendQ=${comp.trendQuality} vol=${comp.volumeConfirmation} ` +
          `overheat=${comp.overheatControl} market=${comp.marketSupport}`,
      );
      return comp;
    },
    null,
  );

  // Keep ~252 days of bars for the chart (12 months trading days)
  // — required so that SMA200 has enough lookback to render the line.
  const priceBars = stockBars.slice(0, 252);

  return {
    fundamental: fund,
    classification,
    timingScore: adjustedTiming,
    fundamentalScore,
    overallScore,
    canslim,
    strategy,
    typeInsight,
    riskFactors,
    safetyGuard,
    indicators,
    timingDetail,
    priceBars,
    usdKrwRate,
    supplyDemand,
    news,
    targetPriceGap,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ticker =
    (req.query.ticker as string | undefined) ??
    (req.query.symbol as string | undefined);
  if (!ticker) {
    return res.status(400).json({ error: 'missing ?ticker=' });
  }
  try {
    const result = await analyzeOne(ticker);
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json(result);
  } catch (err) {
    return res.status(502).json({
      error: 'analyze_failed',
      message: (err as Error).message,
      ticker,
    });
  }
}

export { analyzeOne };
