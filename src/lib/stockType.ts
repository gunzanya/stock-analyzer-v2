// 7-type stock classifier
// Design: numbers 70% + name 30%. Each type produces a 0–100 score plus reasons.
// Hard rules can disqualify a type (e.g. negative revenue → not a FAST_GROWER).
// Blending is handled in typeWeights.ts.

import type {
  FundamentalData,
  StockType,
  TypeCandidateScore,
} from './types.js';

// ---------- helpers ----------

/** Returns true if any of the last n quarters had EPS < 0. */
function hasLossInLastQuarters(fund: FundamentalData, n: number): boolean {
  return fund.quarterly.slice(0, n).some((q) => q.eps != null && q.eps < 0);
}

/** Returns true if the most recent quarter is profitable (EPS > 0). */
function latestQuarterProfitable(fund: FundamentalData): boolean {
  const q = fund.quarterly[0];
  return q != null && q.eps != null && q.eps > 0;
}

/** Coefficient of variation = stdev / |mean| over an array of numbers. null if <2 values or |mean| ≈ 0. */
function coefficientOfVariation(values: (number | null)[]): number | null {
  const xs = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (xs.length < 2) return null;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  if (Math.abs(mean) < 1e-9) return null;
  const variance = xs.reduce((acc, v) => acc + (v - mean) ** 2, 0) / xs.length;
  return Math.sqrt(variance) / Math.abs(mean);
}

/** Range (max - min) of last n quarter operating margins, as a fraction. */
function operatingMarginRange(fund: FundamentalData): number | null {
  const margins = fund.quarterly
    .slice(0, 4)
    .map((q) =>
      q.operatingIncome != null && q.revenue != null && q.revenue > 0
        ? q.operatingIncome / q.revenue
        : null,
    )
    .filter((v): v is number => v != null);
  if (margins.length < 2) return null;
  return Math.max(...margins) - Math.min(...margins);
}

/** Detects crypto/bitcoin holdings hint in name or industry. */
function hasCryptoHoldingHint(fund: FundamentalData): boolean {
  const haystack = `${fund.name} ${fund.industry ?? ''}`.toLowerCase();
  return /bitcoin|crypto|digital asset|blockchain/.test(haystack);
}

/** Detects holding-company hints in name. Avoids generic "Holdings, Inc."
 *  which is just a US corporate legal suffix (CrowdStrike Holdings,
 *  Robinhood Markets Holdings, etc. are operating companies, not holdcos). */
function hasHoldingsHint(fund: FundamentalData): boolean {
  const n = fund.name.toLowerCase();
  // Specific named holdcos
  if (/berkshire|hathaway|sk square|^square /.test(n)) return true;
  // Korean conglomerate suffixes
  if (/지주|holding co|conglomerate/.test(n)) return true;
  // "X Holdings" only counts if it's clearly a financial holding co
  // (Financial Services sector); otherwise it's just a legal suffix.
  if (/holdings/.test(n) && fund.sector === 'Financial Services') return true;
  return false;
}

/** Detects speculative themes in name/industry. */
function hasSpeculativeTheme(fund: FundamentalData): boolean {
  const haystack = `${fund.name} ${fund.industry ?? ''}`.toLowerCase();
  return /quantum|space|cannabis|blockchain|meme|electric vehicle/.test(haystack);
}

/** Semiconductor subtype detector (for CYCLICAL nuance, per stage 5). */
export function getSemiType(
  fund: FundamentalData,
): 'memory' | 'fabless' | 'equipment' | 'general' | null {
  if (!fund.industry || !/semi/i.test(fund.industry)) return null;
  const name = fund.name.toLowerCase();
  if (/hynix|micron|samsung electronics|nand|dram|memory/.test(name)) return 'memory';
  if (/broadcom|qualcomm|nvidia|amd|marvell|mediatek/.test(name)) return 'fabless';
  if (/asml|applied materials|lam research|klac|tokyo electron/.test(name)) return 'equipment';
  return 'general';
}

// Convenience: gate inputs (avoid double-counting on null)
const isNum = (v: number | null | undefined): v is number =>
  v != null && Number.isFinite(v);

// ---------- per-type scorers ----------

function scoreFastGrower(fund: FundamentalData): TypeCandidateScore {
  const reasons: string[] = [];
  let score = 0;

  const eps = fund.epsGrowthYoY;
  const rev = fund.revenueGrowthYoY;
  const divY = fund.dividendYield ?? 0;

  // Hard disqualifications
  if (isNum(rev) && rev < 0) {
    return {
      type: 'FAST_GROWER',
      score: 0,
      reasons: [],
      disqualified: true,
      disqualifyReason: `매출 역성장(${(rev * 100).toFixed(1)}%) — 고성장 자격 박탈`,
    };
  }
  if (isNum(rev) && isNum(eps) && rev < 0.05 && eps > 0.5) {
    return {
      type: 'FAST_GROWER',
      score: 0,
      reasons: [],
      disqualified: true,
      disqualifyReason: '매출<5%인데 EPS>50% — 일회성 이익 의심',
    };
  }
  if (divY > 0.03) {
    return {
      type: 'FAST_GROWER',
      score: 0,
      reasons: [],
      disqualified: true,
      disqualifyReason: `배당수익률 ${(divY * 100).toFixed(1)}% — 배당주는 고성장 아님`,
    };
  }

  // Numbers (70%)
  if (isNum(eps) && eps > 0.2) {
    score += 15;
    reasons.push(`EPS YoY +${(eps * 100).toFixed(0)}% → +15`);
  }
  if (isNum(rev) && rev > 0.15) {
    score += 15;
    reasons.push(`매출 YoY +${(rev * 100).toFixed(0)}% → +15`);
  }
  // Both growing → bonus
  if (isNum(eps) && isNum(rev) && eps > 0.15 && rev > 0.1) {
    score += 10;
    reasons.push('EPS+매출 동시 성장 → +10');
  }
  if (isNum(fund.peg) && fund.peg > 0 && fund.peg < 2.0) {
    score += 5;
    reasons.push(`PEG ${fund.peg.toFixed(1)} → +5`);
  }

  // Recent loss-quarter penalty (turnaround masquerading as growth)
  if (hasLossInLastQuarters(fund, 4)) {
    score -= 20;
    reasons.push('최근 4분기 중 적자 분기 존재 → -20 (턴어라운드 의심)');
  }

  // Names (30%) — light boost only
  if (fund.sector === 'Technology' || fund.sector === 'Healthcare') {
    score += 5;
    reasons.push(`섹터 ${fund.sector} → +5`);
  }

  // Strong rev growth with positive earnings — captures fast growers whose
  // EPS YoY is null/messy due to comparison issues (SHOP path).
  if (
    isNum(rev) &&
    rev > 0.3 &&
    fund.quarterly[0]?.eps != null &&
    fund.quarterly[0].eps > 0 &&
    (!isNum(eps) || eps > 0)
  ) {
    score += 15;
    reasons.push(`매출 +${(rev * 100).toFixed(0)}% (>30%) + 흑자 → +15`);
  }

  // Mega-cap defensives are not "fast growers" even when a one-year EPS spike
  // pushes growth metrics. (COST $477B, Consumer Defensive.)
  if (
    isNum(fund.marketCap) &&
    fund.marketCap > 200e9 &&
    (fund.sector === 'Consumer Defensive' || fund.sector === 'Utilities')
  ) {
    score -= 10;
    reasons.push(`메가캡 ${fund.sector} → -10 (구조적 고성장 아님)`);
  }

  // Materials miners — earnings explode when commodity prices spike (gold,
  // silver, copper, steel rallies), but that's a cyclical pattern, not
  // structural growth. Demote so they classify as CYCLICAL (FSM, ARIS, HBM).
  if (
    fund.sector === 'Basic Materials' &&
    fund.industry &&
    /mining|gold|silver|copper|aluminum|steel|metals/i.test(fund.industry)
  ) {
    score -= 15;
    reasons.push(`Materials/Mining (${fund.industry}) → -15 (상품가격 사이클)`);
  }

  // Semiconductors — structurally cyclical (capex waves, inventory cycles).
  // Base penalty -10 with a recovery clause for high-margin growth pattern
  // (NVDA/AVGO: rev>25% + GM>55% + OM>25% → genuine secular grower).
  const semi = getSemiType(fund);
  if (semi != null) {
    score -= 10;
    reasons.push(`반도체 산업 → -10 (구조적 순환)`);
    const gm = fund.grossMargin;
    const om = fund.operatingMargin;
    if (
      isNum(rev) && rev > 0.25 &&
      isNum(gm) && gm > 0.55 &&
      isNum(om) && om > 0.25
    ) {
      score += 20;
      reasons.push(
        `고마진 성장형 (매출+${(rev * 100).toFixed(0)}%, GM ${(gm * 100).toFixed(0)}%, OM ${(om * 100).toFixed(0)}%) → +20 (반도체 성장 회복)`,
      );
    }
  }

  // Caps the score in case of insanely high one-shot EPS (stage 6 defense)
  if (isNum(eps) && eps > 10) {
    score = Math.min(score, 50);
    reasons.push(`EPS YoY ${(eps * 100).toFixed(0)}% 극단치 → 캡 50`);
  }

  return {
    type: 'FAST_GROWER',
    score: Math.min(Math.max(0, score), 100),
    reasons,
  };
}

function scoreStalwart(fund: FundamentalData): TypeCandidateScore {
  const reasons: string[] = [];
  let score = 0;

  const mcap = fund.marketCap;
  if (isNum(mcap)) {
    if (mcap > 50e9) {
      score += 15;
      reasons.push(`시총 $${(mcap / 1e9).toFixed(0)}B (>50B) → +15`);
    } else if (mcap > 10e9) {
      score += 10;
      reasons.push(`시총 $${(mcap / 1e9).toFixed(0)}B (10B-50B) → +10`);
    }
  }

  const eps = fund.epsGrowthYoY;
  if (isNum(eps) && eps >= 0.08 && eps <= 0.25) {
    score += 15;
    reasons.push(`EPS YoY ${(eps * 100).toFixed(0)}% (8-25% 안정 구간) → +15`);
  }
  if (isNum(eps) && eps > 0.5) {
    score -= 10;
    reasons.push(`EPS YoY ${(eps * 100).toFixed(0)}% 과도 → -10 (우량보다 고성장)`);
  }

  if (isNum(fund.roe) && fund.roe > 0.15) {
    score += 10;
    reasons.push(`ROE ${(fund.roe * 100).toFixed(0)}% → +10`);
  }
  if (isNum(fund.operatingMargin) && fund.operatingMargin > 0.15) {
    score += 10;
    reasons.push(`영업이익률 ${(fund.operatingMargin * 100).toFixed(0)}% → +10`);
  }

  // Loss-quarter penalty
  if (hasLossInLastQuarters(fund, 4)) {
    score -= 20;
    reasons.push('적자 분기 존재 → -20 (우량주 아님)');
  }

  // Holdings/conglomerate name → not a stalwart, leave it for ASSET_PLAY.
  if (hasHoldingsHint(fund)) {
    score -= 20;
    reasons.push('지주사/Holdings 이름 패턴 → -20 (우량주 아님)');
  }

  // Recent annual loss → profit flip → not yet a stalwart (still a turnaround).
  // Requires several years of consistent profit before earning STALWART status.
  if (fund.annual.length >= 2) {
    const thisYr = fund.annual[0];
    const priorYears = fund.annual.slice(1, 4);
    if (
      thisYr.netIncome != null &&
      thisYr.netIncome > 0 &&
      priorYears.some((y) => y.netIncome != null && y.netIncome < 0)
    ) {
      score -= 15;
      reasons.push('최근 3년 내 적자→흑자 전환 이력 → -15 (아직 우량주 아님)');
    }
  }

  // Sector boost
  if (
    fund.sector === 'Consumer Defensive' ||
    fund.sector === 'Healthcare' ||
    fund.sector === 'Financial Services'
  ) {
    if (isNum(mcap) && mcap > 50e9) {
      score += 10;
      reasons.push(`대형 ${fund.sector} → +10`);
    }
  }
  // Mega-bank bonus — JPM/BAC/WFC ≥$100B are the most stalwart of stalwarts
  // (diversified, regulated, dividend-paying). Stacks with the sector bonus
  // above. Smaller/regional banks behave more cyclically — handled in CYCLICAL.
  if (
    fund.sector === 'Financial Services' &&
    fund.industry &&
    /bank/i.test(fund.industry) &&
    isNum(mcap) && mcap >= 100e9
  ) {
    score += 10;
    reasons.push(`메가뱅크 ($${(mcap / 1e9).toFixed(0)}B ≥ $100B) → +10`);
  }

  // Mega-cap floor: enormous companies retain stalwart characteristics
  // regardless of growth speed or recent earnings noise. AMZN at $2.79T
  // shouldn't score 0 just because EPS YoY is 75% (above the 8-25% band).
  if (isNum(mcap)) {
    let floor = 0;
    if (mcap >= 1e12) floor = 25;
    else if (mcap >= 500e9) floor = 20;
    else if (mcap >= 200e9) floor = 15;
    if (floor > 0 && score < floor) {
      const before = Math.max(0, score);
      score = floor;
      reasons.push(
        `메가캡 floor: 시총 $${(mcap / 1e9).toFixed(0)}B → ${before}→${floor}`,
      );
    }
  }

  return { type: 'STALWART', score: Math.min(Math.max(0, score), 100), reasons };
}

function scoreSlowGrower(fund: FundamentalData): TypeCandidateScore {
  const reasons: string[] = [];
  let score = 0;
  const divY = fund.dividendYield ?? 0;

  // Hard disqualify: no/low dividend (per spec: 카카오/GME 보호)
  if (divY < 0.005) {
    return {
      type: 'SLOW_GROWER',
      score: 0,
      reasons: [],
      disqualified: true,
      disqualifyReason: `배당수익률 ${(divY * 100).toFixed(2)}% — 배당주 아님`,
    };
  }

  if (divY > 0.03) {
    score += 20;
    reasons.push(`배당수익률 ${(divY * 100).toFixed(1)}% (>3%) → +20`);
  }
  if (divY > 0.05) {
    score += 10;
    reasons.push(`배당수익률 ${(divY * 100).toFixed(1)}% (>5%) → +10`);
  }

  // Growth-rate bonuses gated on real dividend (>=4%); otherwise any stable
  // large-cap with mild dividend would land here (XOM 2.57%, GM 0.98%).
  const incomeStock = divY >= 0.04;
  const rev = fund.revenueGrowthYoY;
  if (incomeStock && isNum(rev) && rev < 0.1) {
    score += 15;
    reasons.push(`매출 YoY ${(rev * 100).toFixed(0)}% (<10%) + 배당주 → +15`);
  }
  const eps = fund.epsGrowthYoY;
  if (incomeStock && isNum(eps) && eps < 0.15) {
    score += 10;
    reasons.push(`EPS YoY ${(eps * 100).toFixed(0)}% (<15%) + 배당주 → +10`);
  }
  if (incomeStock && isNum(fund.marketCap) && fund.marketCap > 10e9) {
    score += 5;
    reasons.push(`시총 $${(fund.marketCap / 1e9).toFixed(0)}B + 배당주 → +5`);
  }

  // Name/sector (30%)
  const sec = fund.sector ?? '';
  const ind = fund.industry ?? '';
  if (sec === 'Utilities' || sec === 'Consumer Defensive' || sec === 'Real Estate') {
    score += 15;
    reasons.push(`섹터 ${sec} → +15`);
  }
  if (/REIT/i.test(ind)) {
    score += 10;
    reasons.push(`산업 REIT → +10`);
  }
  if (/tobacco|BDC|asset management|MLP/i.test(ind)) {
    score += 10;
    reasons.push(`산업 ${ind} → +10`);
  }
  // Energy midstream (pipelines/MLPs) — fee-based revenue, structurally
  // income-stock, not commodity-cyclical. Push toward SLOW_GROWER hard so
  // EPD/ET/KMI/MPLX don't get misclassified as cyclical.
  if (sec === 'Energy' && /midstream|pipeline/i.test(ind)) {
    score += 20;
    reasons.push(`Energy Midstream (수수료 기반 파이프라인) → +20 (배당형)`);
  }

  return { type: 'SLOW_GROWER', score: Math.min(Math.max(0, score), 100), reasons };
}

function scoreCyclical(fund: FundamentalData): TypeCandidateScore {
  const reasons: string[] = [];
  let score = 0;

  const epsCoV = coefficientOfVariation(fund.quarterly.slice(0, 4).map((q) => q.eps));
  const revCoV = coefficientOfVariation(fund.quarterly.slice(0, 4).map((q) => q.revenue));
  const rev = fund.revenueGrowthYoY;
  const eps = fund.epsGrowthYoY;

  // Numbers (70%)
  // EPS volatile AND revenue also moves → genuine cyclical (META protect: rev stable)
  if (epsCoV != null && epsCoV > 0.5 && revCoV != null && revCoV > 0.3) {
    score += 15;
    reasons.push(
      `EPS CoV ${epsCoV.toFixed(2)} + 매출 CoV ${revCoV.toFixed(2)} → +15 (변동성↑)`,
    );
  }
  // Commodity-recovery pattern: rev shrinking but EPS jumping
  if (isNum(rev) && rev < 0 && isNum(eps) && eps > 0.5) {
    score += 20;
    reasons.push(
      `매출 역성장(${(rev * 100).toFixed(0)}%)+EPS 급등(${(eps * 100).toFixed(0)}%) → +20 (원자재 회복)`,
    );
  }
  const opRange = operatingMarginRange(fund);
  if (opRange != null && opRange > 0.1) {
    score += 10;
    reasons.push(`영업이익률 변동폭 ${(opRange * 100).toFixed(0)}pp → +10`);
  }

  // Names (30%)
  const sec = fund.sector ?? '';
  const ind = fund.industry ?? '';
  if (sec === 'Energy' || sec === 'Basic Materials' || sec === 'Industrials') {
    score += 20;
    reasons.push(`섹터 ${sec} → +20`);
  } else if (sec === 'Consumer Cyclical') {
    score += 10;
    reasons.push(`섹터 Consumer Cyclical → +10`);
  }
  if (/auto|steel|chemical|airline|shipping|construction|aluminum|copper|oil|gas|petroleum|mining|metals|gold|silver|capital markets/i.test(ind)) {
    score += 15;
    reasons.push(`산업 ${ind} → +15`);
  }
  // Down-phase: revenue + EPS both contracting → cyclical trough signal
  if (isNum(rev) && rev < 0 && isNum(eps) && eps < 0) {
    score += 10;
    reasons.push(`매출+EPS 동시 역성장 → +10 (순환 하강)`);
  }
  // Semiconductor nuance (stage 5)
  const semi = getSemiType(fund);
  if (semi === 'memory') {
    score += 10;
    reasons.push('메모리 반도체 → +10');
  } else if (semi === 'equipment') {
    score += 15;
    reasons.push('반도체 장비 → +15');
  } else if (semi === 'fabless') {
    score += 5;
    reasons.push('팹리스 반도체 → +5 (약한 순환)');
  } else if (semi === 'general') {
    score += 10;
    reasons.push('반도체 → +10');
  }
  // Memory-pattern kicker: any semi exhibiting high EPS or margin volatility
  // behaves like MU/하이닉스 (deep cycles), regardless of declared subtype.
  if (semi != null) {
    const epsHighVol = epsCoV != null && epsCoV > 0.7;
    const marginVol = opRange != null && opRange > 0.15;
    if (epsHighVol || marginVol) {
      score += 10;
      const parts: string[] = [];
      if (epsHighVol) parts.push(`EPS CoV ${epsCoV!.toFixed(2)}`);
      if (marginVol) parts.push(`마진 변동 ${(opRange! * 100).toFixed(0)}pp`);
      reasons.push(`반도체 변동성 (${parts.join(', ')}) → +10 (메모리형 사이클)`);
    }
  }

  // Communication/Technology + stable revenue → NOT cyclical (META protect)
  if (
    (sec === 'Communication Services' || sec === 'Technology') &&
    revCoV != null &&
    revCoV < 0.15 &&
    semi == null
  ) {
    score = Math.max(0, score - 15);
    reasons.push('Tech/Comm + 매출 안정 → -15 (순환 패턴 아님)');
  }

  // Energy midstream — pipelines collect tolls, not exposed to oil price
  // swings the way upstream E&P is. Strip the Energy-sector +20 bonus.
  if (sec === 'Energy' && /midstream|pipeline/i.test(ind)) {
    score = Math.max(0, score - 15);
    reasons.push('Midstream (수수료 기반) → -15 (원유가 사이클 약함)');
  }

  // Small/regional banks behave cyclically (credit cycle, NIM swings, CRE
  // exposure). Mega-banks (≥$100B) get the STALWART treatment instead.
  if (
    sec === 'Financial Services' &&
    /bank/i.test(ind) &&
    (!isNum(fund.marketCap) || fund.marketCap < 100e9)
  ) {
    score += 10;
    reasons.push('중소형 은행 (<$100B) → +10 (대출 사이클)');
  }

  return { type: 'CYCLICAL', score: Math.min(Math.max(0, score), 100), reasons };
}

function scoreTurnaround(fund: FundamentalData): TypeCandidateScore {
  const reasons: string[] = [];
  let score = 0;

  const hadLoss = hasLossInLastQuarters(fund, 4);
  const recoveredNow = latestQuarterProfitable(fund);
  const ttmEpsSum = fund.quarterly
    .slice(0, 4)
    .reduce((acc, q) => acc + (q.eps ?? 0), 0);
  const ttmPositive = ttmEpsSum > 0;

  // Annual-flip path: any of the last 3 fiscal years had a net loss AND
  // the current fiscal year is profitable. Captures HOOD/Kakao-style
  // recoveries where the loss happened 1–3 years ago.
  let annualFlip = false;
  if (fund.annual.length >= 2) {
    // annual[] is newest-first
    const thisYr = fund.annual[0];
    if (thisYr.netIncome != null && thisYr.netIncome > 0) {
      const priorYears = fund.annual.slice(1, 4);
      if (priorYears.some((y) => y.netIncome != null && y.netIncome < 0)) {
        annualFlip = true;
      }
    }
  }

  // Disqualify only if no loss history at all (neither quarterly nor annual)
  if (!hadLoss && !annualFlip) {
    return {
      type: 'TURNAROUND',
      score: 0,
      reasons: [],
      disqualified: true,
      disqualifyReason: '적자 이력 없음 (4분기·연간 모두) — 턴어라운드 아님',
    };
  }
  // Disqualify: persistently losing (latest negative AND TTM negative AND no annual flip)
  if (!recoveredNow && !ttmPositive && !annualFlip) {
    return {
      type: 'TURNAROUND',
      score: 0,
      reasons: [],
      disqualified: true,
      disqualifyReason: '최근 분기 적자 + TTM EPS 적자 — 회복 미완',
    };
  }

  if (hadLoss) {
    score += 25;
    reasons.push('최근 4분기 중 적자 분기 존재 → +25');
  }
  if (recoveredNow) {
    score += 15;
    reasons.push('최근 분기 흑자전환 → +15');
  } else if (ttmPositive && hadLoss) {
    score += 10;
    reasons.push('TTM EPS 흑자 (변동성 큰 회복 중) → +10');
  }
  if (annualFlip) {
    score += 20;
    reasons.push('전년 순손실 → 올해 순이익 → +20');
  }

  // Operating income QoQ flipped positive
  const qs = fund.quarterly.slice(0, 2);
  if (
    qs.length === 2 &&
    qs[0].operatingIncome != null &&
    qs[1].operatingIncome != null &&
    qs[0].operatingIncome > 0 &&
    qs[1].operatingIncome <= 0
  ) {
    score += 15;
    reasons.push('영업이익 QoQ 흑자전환 → +15');
  }

  return { type: 'TURNAROUND', score: Math.min(Math.max(0, score), 100), reasons };
}

function scoreAssetPlay(fund: FundamentalData): TypeCandidateScore {
  const reasons: string[] = [];
  let score = 0;

  const pbr = fund.pbr;
  // PBR null → skip (stage 6 — BRK-B bug)
  if (isNum(pbr) && pbr > 0) {
    if (pbr < 0.8) {
      score += 20;
      reasons.push(`PBR ${pbr.toFixed(2)} (<0.8) → +20`);
    } else if (pbr < 1.0) {
      score += 15;
      reasons.push(`PBR ${pbr.toFixed(2)} (<1.0) → +15`);
    }
  }

  // Revenue / assets ratio — low means asset-heavy / holding company
  const revRecent = fund.quarterly[0]?.revenue;
  if (isNum(fund.totalAssets) && fund.totalAssets > 0 && isNum(revRecent)) {
    const annualizedRev = revRecent * 4;
    const ratio = annualizedRev / fund.totalAssets;
    if (ratio < 0.1) {
      score += 20;
      reasons.push(`매출/총자산 ${ratio.toFixed(3)} → +20 (자산 많음)`);
    }
  }

  // Investment-asset heavy
  if (
    isNum(fund.investmentAssets) &&
    isNum(fund.totalAssets) &&
    fund.totalAssets > 0 &&
    fund.investmentAssets / fund.totalAssets > 0.5
  ) {
    score += 15;
    reasons.push(
      `투자자산/총자산 ${(fund.investmentAssets / fund.totalAssets).toFixed(2)} → +15`,
    );
  }

  // Operating income / total assets — low → asset-play characteristic
  const opIncomeTTM = fund.quarterly
    .slice(0, 4)
    .map((q) => q.operatingIncome ?? 0)
    .reduce((a, b) => a + b, 0);
  if (isNum(fund.totalAssets) && fund.totalAssets > 0 && opIncomeTTM > 0) {
    const opAssets = opIncomeTTM / fund.totalAssets;
    if (opAssets < 0.03) {
      score += 10;
      reasons.push(`영업이익/총자산 ${(opAssets * 100).toFixed(1)}% → +10`);
    }
  }

  // Cash + investments > 50% of market cap
  if (isNum(fund.cashAndShortTerm) && isNum(fund.marketCap) && fund.marketCap > 0) {
    const cashRatio =
      (fund.cashAndShortTerm + (fund.investmentAssets ?? 0)) / fund.marketCap;
    if (cashRatio > 0.5) {
      score += 10;
      reasons.push(`(현금+투자)/시총 ${(cashRatio * 100).toFixed(0)}% → +10`);
    }
  }

  // Names (30%)
  if (hasHoldingsHint(fund)) {
    score += 25;
    reasons.push('지주사/Holdings/Berkshire → +25');
  }
  if (hasCryptoHoldingHint(fund)) {
    score += 20;
    reasons.push('크립토 자산 보유 힌트 → +20');
  }

  return { type: 'ASSET_PLAY', score: Math.min(Math.max(0, score), 100), reasons };
}

function scoreSpeculative(fund: FundamentalData): TypeCandidateScore {
  const reasons: string[] = [];
  let score = 0;

  // Last 2 quarters consecutive loss + PSR > 20 (IONQ-type)
  const consec2Loss =
    fund.quarterly[0]?.eps != null &&
    fund.quarterly[0].eps < 0 &&
    fund.quarterly[1]?.eps != null &&
    fund.quarterly[1].eps < 0;
  if (consec2Loss && isNum(fund.psr) && fund.psr > 20) {
    score += 30;
    reasons.push(`2분기 연속 적자 + PSR ${fund.psr.toFixed(0)} → +30`);
  }
  // 4 consecutive negative quarters AND deeply negative op margin —
  // persistent burn (RIVN), not just a cyclical down year (CLF, op margin -6%).
  const recent4 = fund.quarterly.slice(0, 4);
  const allFourLoss =
    recent4.length === 4 && recent4.every((q) => q.eps != null && q.eps < 0);
  if (allFourLoss) {
    const opMargins = recent4
      .map((q) =>
        q.operatingIncome != null && q.revenue != null && q.revenue > 0
          ? q.operatingIncome / q.revenue
          : null,
      )
      .filter((v): v is number => v != null);
    if (opMargins.length > 0) {
      const avgOpMargin = opMargins.reduce((a, b) => a + b, 0) / opMargins.length;
      if (avgOpMargin < -0.1) {
        score += 25;
        reasons.push(
          `4분기 연속 적자 + 영업이익률 평균 ${(avgOpMargin * 100).toFixed(0)}% → +25 (burn rate)`,
        );
      }
    }
  }

  // Independent path: persistent op-income loss + nosebleed PSR (IONQ).
  // Catches companies that report positive net-EPS via non-operating gains
  // while the operating business is deeply unprofitable.
  const allFourOpLoss =
    recent4.length === 4 &&
    recent4.every((q) => q.operatingIncome != null && q.operatingIncome < 0);
  if (allFourOpLoss && isNum(fund.psr) && fund.psr > 20) {
    score += 30;
    reasons.push(`4분기 연속 영업적자 + PSR ${fund.psr.toFixed(0)} → +30 (operating burn)`);
  }

  // EPS<0 + revenue<$500M + mcap>$5B
  const revTTM = fund.quarterly
    .slice(0, 4)
    .map((q) => q.revenue ?? 0)
    .reduce((a, b) => a + b, 0);
  const eps = fund.epsGrowthYoY;
  if (
    fund.quarterly[0]?.eps != null &&
    fund.quarterly[0].eps < 0 &&
    revTTM > 0 &&
    revTTM < 500e6 &&
    isNum(fund.marketCap) &&
    fund.marketCap > 5e9
  ) {
    score += 25;
    reasons.push(
      `적자+매출 $${(revTTM / 1e6).toFixed(0)}M+시총 $${(fund.marketCap / 1e9).toFixed(0)}B → +25`,
    );
  }

  // Revenue < $100M but market cap > $1B (extreme bubble)
  if (revTTM > 0 && revTTM < 100e6 && isNum(fund.marketCap) && fund.marketCap > 1e9) {
    score += 30;
    reasons.push(
      `매출 $${(revTTM / 1e6).toFixed(0)}M < $100M 인데 시총 $${(fund.marketCap / 1e9).toFixed(1)}B → +30 (거품)`,
    );
  }

  // No dividend + loss + high or negative PER
  const divY = fund.dividendYield ?? 0;
  if (
    divY < 0.001 &&
    fund.quarterly[0]?.eps != null &&
    fund.quarterly[0].eps < 0 &&
    (fund.per == null || fund.per < 0 || fund.per > 100)
  ) {
    score += 15;
    reasons.push('배당0+적자+극단 PER → +15');
  }

  // PSR > 30 (independent — even if revenue exists)
  if (isNum(fund.psr) && fund.psr > 30 && score < 50) {
    score += 15;
    reasons.push(`PSR ${fund.psr.toFixed(0)} > 30 → +15`);
  }

  // Names (30%)
  if (fund.industry && /biotechnology/i.test(fund.industry)) {
    score += 15;
    reasons.push(`산업 ${fund.industry} → +15`);
  }
  if (hasSpeculativeTheme(fund)) {
    score += 10;
    reasons.push('테마(quantum/space/cannabis/blockchain/meme) → +10');
  }

  // High short interest
  if (isNum(fund.shortPercentOfFloat) && fund.shortPercentOfFloat > 0.2) {
    score += 10;
    reasons.push(`공매도 비율 ${(fund.shortPercentOfFloat * 100).toFixed(0)}% → +10`);
  }
  // Well-known meme tickers — these trade on social dynamics, not fundamentals
  if (/^(GME|AMC|BBBY|HKD|BB)$/.test(fund.ticker)) {
    score += 30;
    reasons.push('알려진 밈주식 → +30');
  }

  // EPS YoY > 0 silenced — speculation isn't gated on growth; some lose & speculate
  void eps;
  return { type: 'SPECULATIVE', score: Math.min(Math.max(0, score), 100), reasons };
}

// ---------- public API ----------

const TYPES: StockType[] = [
  'FAST_GROWER',
  'STALWART',
  'SLOW_GROWER',
  'CYCLICAL',
  'TURNAROUND',
  'ASSET_PLAY',
  'SPECULATIVE',
];

const SCORERS: Record<StockType, (f: FundamentalData) => TypeCandidateScore> = {
  FAST_GROWER: scoreFastGrower,
  STALWART: scoreStalwart,
  SLOW_GROWER: scoreSlowGrower,
  CYCLICAL: scoreCyclical,
  TURNAROUND: scoreTurnaround,
  ASSET_PLAY: scoreAssetPlay,
  SPECULATIVE: scoreSpeculative,
};

/** Run all 7 scorers, return candidates sorted desc by score (disqualified at the bottom). */
export function scoreAllTypes(fund: FundamentalData): TypeCandidateScore[] {
  const cands = TYPES.map((t) => SCORERS[t](fund));
  return cands.sort((a, b) => {
    if (a.disqualified && !b.disqualified) return 1;
    if (!a.disqualified && b.disqualified) return -1;
    return b.score - a.score;
  });
}
