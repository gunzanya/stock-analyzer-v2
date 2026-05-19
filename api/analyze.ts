import type { VercelRequest, VercelResponse } from '@vercel/node';
import { fetchFundamental, fetchPriceHistory } from './fetchStock.js';
import { classify } from '../src/lib/typeWeights.js';
import {
  adx as adxOf,
  obvBearishDivergence,
  resolveBenchmarkEtf,
  return1y,
  return30d,
  return90d,
  relativeStrength,
  volumeRatio,
} from '../src/lib/indicators.js';
import { evaluateSafetyGuard } from '../src/lib/safetyGuard.js';
import { computeEntryScore } from '../src/lib/entryScore.js';
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

  const indicators = hasPrices
    ? {
        rs: relativeStrength(stockBars, benchBars).rs,
        adx: adxOf(stockBars),
        obvDivergence: obvBearishDivergence(stockBars),
        volumeRatio: volumeRatio(stockBars),
        return30d: return30d(stockBars),
        return90d: return90d(stockBars),
        return1y: return1y(stockBars),
        subIndustryEtf: benchEtf,
      }
    : {
        rs: null,
        adx: null,
        obvDivergence: null,
        volumeRatio: null,
        return30d: null,
        return90d: null,
        return1y: null,
        subIndustryEtf: benchEtf,
      };

  return {
    fundamental: fund,
    classification,
    entryScore,
    safetyGuard,
    indicators,
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
