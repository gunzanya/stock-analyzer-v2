import type { VercelRequest, VercelResponse } from '@vercel/node';
import { fetchFundamental, fetchPriceHistory } from './fetchStock.js';
import { classify } from '../src/lib/typeWeights.js';
import {
  adx as adxOf,
  ema,
  obvBearishDivergence,
  resolveBenchmarkEtf,
  return1y,
  return30d,
  return90d,
  relativeStrength,
  sma,
  volumeRatio,
} from '../src/lib/indicators.js';
import { evaluateSafetyGuard } from '../src/lib/safetyGuard.js';
import { applyCoherenceFloor, computeEntryScore } from '../src/lib/entryScore.js';
import { computeCanslim } from '../src/lib/canslim.js';
import { computeTotalScore } from '../src/lib/totalScore.js';
import { computeStrategy } from '../src/lib/strategy.js';
import { getTypeInsight } from '../src/lib/typeInsights.js';
import { extractRiskFactors } from '../src/lib/riskFactors.js';
import type { AnalysisResult } from '../src/lib/types.js';

async function analyzeOne(ticker: string): Promise<AnalysisResult> {
  const fund = await fetchFundamental(ticker);
  const benchEtf = resolveBenchmarkEtf(fund);

  let stockBars: Awaited<ReturnType<typeof fetchPriceHistory>> = [];
  let benchBars: Awaited<ReturnType<typeof fetchPriceHistory>> = [];
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

  const classification = classify(fund);
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

  const entryScore = hasPrices
    ? computeEntryScore({ stockBars, benchmarkBars: benchBars })
    : {
        score: 0,
        gains: [],
        deductions: [{ reason: '가격 데이터 없음', delta: 0 }],
        level: 'NEUTRAL' as const,
      };

  const rs = hasPrices ? relativeStrength(stockBars, benchBars).rs : null;
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
  const totalScore = computeTotalScore(canslim, classification);
  const adjustedEntry = applyCoherenceFloor(entryScore, totalScore.score);
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
      };
  const typeInsight = getTypeInsight(classification.primary);
  const riskFactors = extractRiskFactors({ fund, safety: safetyGuard, indicators });

  // Keep ~252 days of bars for the chart (12 months trading days)
  // — required so that SMA200 has enough lookback to render the line.
  const priceBars = stockBars.slice(0, 252);

  return {
    fundamental: fund,
    classification,
    entryScore: adjustedEntry,
    totalScore,
    canslim,
    strategy,
    typeInsight,
    riskFactors,
    safetyGuard,
    indicators,
    priceBars,
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
