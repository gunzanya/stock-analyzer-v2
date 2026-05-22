import type { VercelRequest, VercelResponse } from '@vercel/node';
import Anthropic from '@anthropic-ai/sdk';
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
  rsiDivergence as rsiDivergenceOf,
  sma,
  supportResistanceClusters,
  volumePattern as volumePatternOf,
  volumeRatio,
} from '../src/lib/indicators.js';
import { evaluateSafetyGuard } from '../src/lib/safetyGuard.js';
import { applyCoherenceFloor, computeTiming } from '../src/lib/entryScore.js';
import { computeCanslim } from '../src/lib/canslim.js';
import { computeFundamental } from '../src/lib/totalScore.js';
import { computeOverall } from '../src/lib/overallScore.js';
import { computeStrategy } from '../src/lib/strategy.js';
import { getTypeInsight } from '../src/lib/typeInsights.js';
import { extractRiskFactors } from '../src/lib/riskFactors.js';
import type { AnalysisResult, TimingDetail, SupplyDemandData, NewsItem } from '../src/lib/types.js';

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
    news = await fetchNews(ticker);
  } catch {
    news = [];
  }
  if (news.length > 0 && !isKoreanTicker) {
    try {
      const anthropic = new Anthropic();
      const titles = news.map((n) => n.title);
      const msg = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 512,
        messages: [{
          role: 'user',
          content: `다음 영문 뉴스 헤드라인을 자연스러운 한국어로 번역해줘. JSON 배열로 반환. 원문의 뉘앙스 유지. 반드시 JSON 배열만 출력하고 다른 텍스트는 쓰지 마.\n\n${JSON.stringify(titles)}`,
        }],
      });
      const text = msg.content[0].type === 'text' ? msg.content[0].text : '';
      const match = text.match(/\[[\s\S]*\]/);
      if (match) {
        const translated: string[] = JSON.parse(match[0]);
        for (let i = 0; i < news.length && i < translated.length; i++) {
          if (translated[i]) news[i].titleKo = translated[i];
        }
      }
    } catch (err) {
      console.warn(`[${ticker}] news translation failed:`, (err as Error).message);
    }
  }

  const hasPrices = stockBars.length >= 50 && benchBars.length >= 50;

  const safetyGuard = hasPrices
    ? evaluateSafetyGuard({
        stockBars,
        benchmarkBars: benchBars,
        benchmarkLabel: benchEtf,
      })
    : {
        triggered: false,
        reasons: ['price history unavailable'],
        sectorContext: null,
        sectorReturn3M: null,
        stockReturn3M: null,
        excessVsSector: null,
      };

  const timingScore = hasPrices
    ? computeTiming({
        stockBars,
        benchmarkBars: benchBars,
        absoluteMode: isKoreanTicker,
        primaryType: classification.primary,
        supplyDemand,
      })
    : {
        score: 0,
        gains: [],
        deductions: [{ reason: '가격 데이터 없음', delta: 0 }],
        level: 'NEUTRAL' as const,
      };

  const rs = hasPrices
    ? relativeStrength(stockBars, benchBars, { absoluteMode: isKoreanTicker }).rs
    : null;
  const adx = hasPrices ? adxOf(stockBars) : null;
  const vr = hasPrices ? volumeRatio(stockBars) : null;
  const r30 = hasPrices ? return30d(stockBars) : null;
  const r90 = hasPrices ? return90d(stockBars) : null;
  const r1y = hasPrices ? return1y(stockBars) : null;
  const ema20 = hasPrices ? ema(stockBars, 20) : null;
  const sma50 = hasPrices ? sma(stockBars, 50) : null;
  const sma200 = hasPrices ? sma(stockBars, 200) : null;

  const indicators = {
    rs,
    adx,
    obvDivergence: hasPrices ? obvBearishDivergence(stockBars) : null,
    volumeRatio: vr,
    return30d: r30,
    return90d: r90,
    return1y: r1y,
    subIndustryEtf: benchEtf,
    ema20,
    sma50,
    sma200,
  };

  const canslim = computeCanslim({
    fund,
    stockBars,
    benchBars,
    rs,
    adx,
    volumeRatio: vr,
    return90d: r90,
  });
  const fundamentalScore = computeFundamental(canslim, classification, fund);
  const adjustedTiming = applyCoherenceFloor(timingScore, fundamentalScore.score);
  const overallScore = computeOverall(fundamentalScore, adjustedTiming, classification.primary);
  const strategy = hasPrices
    ? computeStrategy(stockBars, classification)
    : {
        entry: null,
        stop: null,
        target1: null,
        target2: null,
        riskReward1: null,
        riskReward2: null,
        atr14: null,
        stopRule: '데이터 부족',
        rationale: '가격 데이터가 없어 전략을 산출할 수 없습니다.',
        exitStrategy: '데이터 부족',
        rrWarning: null,
      };
  const typeInsight = getTypeInsight(classification.primary);
  const riskFactors = extractRiskFactors({
    fund,
    safety: safetyGuard,
    indicators,
    stockBars,
  });
  if (fundamentalScore.peakEarningsPenalty) {
    const pct = fund.epsGrowthYoY != null ? `+${(fund.epsGrowthYoY * 100).toFixed(0)}%` : '';
    riskFactors.push({
      severity: 'medium',
      message: `이익 피크 가능성 (순환 섹터 EPS ${pct})`,
    });
  }

  // ---- Timing precision analysis (5 sub-signals) ----
  let timingDetail: TimingDetail | null = null;
  if (hasPrices) {
    const rsiDiv = rsiDivergenceOf(stockBars);
    const emaSlopeResult = ema20SlopeOf(stockBars);
    const volPattern = volumePatternOf(stockBars);
    const atrTrendResult = atrTrendOf(stockBars);
    const clusters = supportResistanceClusters(stockBars);

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
