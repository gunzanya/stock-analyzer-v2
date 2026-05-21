// Data model for stock-analyzer-v2

export type StockType =
  | 'FAST_GROWER'
  | 'STALWART'
  | 'SLOW_GROWER'
  | 'CYCLICAL'
  | 'TURNAROUND'
  | 'ASSET_PLAY'
  | 'SPECULATIVE';

export const STOCK_TYPE_LABELS: Record<StockType, { ko: string; emoji: string }> = {
  FAST_GROWER: { ko: '고성장', emoji: '🚀' },
  STALWART: { ko: '대형우량', emoji: '🏛️' },
  SLOW_GROWER: { ko: '저성장/배당', emoji: '💰' },
  CYCLICAL: { ko: '경기순환', emoji: '🔄' },
  TURNAROUND: { ko: '턴어라운드', emoji: '🔃' },
  ASSET_PLAY: { ko: '자산주', emoji: '🏗️' },
  SPECULATIVE: { ko: '투기/테마', emoji: '🎰' },
};

// One quarter of fundamental data
export interface QuarterlyDatum {
  date: string;          // ISO yyyy-mm-dd of period end
  eps: number | null;    // diluted EPS for the quarter
  revenue: number | null;
  operatingIncome: number | null;
  netIncome: number | null;
}

// Annual data point
export interface AnnualDatum {
  date: string;
  eps: number | null;
  revenue: number | null;
  netIncome: number | null;
}

// Raw fundamental snapshot fetched once per ticker
export interface FundamentalData {
  // Identity
  ticker: string;
  name: string;
  exchange: string | null;
  currency: string | null;
  sector: string | null;
  industry: string | null;

  // Valuation
  marketCap: number | null;        // USD-equivalent if available
  price: number | null;
  pbr: number | null;
  per: number | null;
  forwardPER: number | null;
  psr: number | null;
  peg: number | null;
  evToEbitda: number | null;

  // Profitability
  roe: number | null;              // 0–1 (e.g. 0.18 = 18%)
  operatingMargin: number | null;  // 0–1
  netMargin: number | null;        // 0–1
  grossMargin: number | null;      // 0–1

  // Growth
  epsGrowthYoY: number | null;     // 0–1 (e.g. 0.25 = +25%)
  revenueGrowthYoY: number | null; // 0–1
  epsGrowth5y: number | null;      // 0–1 (5-year CAGR if available)

  // Dividend
  dividendYield: number | null;          // 0–1
  payoutRatio: number | null;            // Yahoo-reported, may be null
  dividendGrowthYears: number | null;
  trailingAnnualDividendRate: number | null; // dividend per share, native currency
  trailingEps: number | null;            // TTM diluted EPS, native currency

  // Balance sheet
  totalAssets: number | null;
  totalLiabilities: number | null;
  totalEquity: number | null;
  cashAndShortTerm: number | null;
  investmentAssets: number | null;
  debtToEquity: number | null;
  // newest-first history of (totalLiabilities / totalEquity) — used for D/E
  // trend in TURNAROUND aux section. Empty when data unavailable.
  debtToEquityHistory: { date: string; ratio: number }[];

  // Time series
  quarterly: QuarterlyDatum[];     // most recent first, up to 4
  annual: AnnualDatum[];           // most recent first, up to 5

  // Sentiment / speculation signals
  shortPercentOfFloat: number | null;
  floatShares: number | null;

  // Meta
  fetchedAt: string;               // ISO timestamp
  warnings: string[];              // collected warnings (e.g. "PBR=0, dropped")
}

// Per-type score breakdown for transparency
export interface TypeCandidateScore {
  type: StockType;
  score: number;             // 0–100
  reasons: string[];         // human-readable contributions
  disqualified?: boolean;    // hard rule failed
  disqualifyReason?: string;
}

// Final classification result
export interface ClassificationResult {
  primary: StockType;
  primaryRatio: number;            // 0–100, percentage weight
  secondary: StockType | null;
  secondaryRatio: number;          // 0–100
  confidence: number;              // primary score 0–100
  candidates: TypeCandidateScore[]; // all 7, sorted desc
  display: string;                 // e.g. "🚀 고성장 60% + 🏛️ 대형우량 40%"
  uncertain: boolean;              // true when even the best type < 30
}

// Timing score — displayed in UI as "타이밍". Captures short-term technical
// setup: RS, volume, ADX, RSI, EMA20 proximity, candle pattern, Fib/MACD/BB.
export interface TimingScoreResult {
  score: number;            // 0–90 (capped)
  gains: { reason: string; delta: number }[];
  deductions: { reason: string; delta: number }[];
  level: 'STRONG' | 'WATCH' | 'NEUTRAL' | 'AVOID';
}

// Safety guard with sector context
export interface SafetyGuardResult {
  triggered: boolean;
  reasons: string[];
  sectorContext: string | null;    // 🚨/👀/⚠️ human label
  sectorReturn3M: number | null;
  stockReturn3M: number | null;
  excessVsSector: number | null;
}

// Daily OHLCV bar
export interface PriceBar {
  date: string;          // ISO yyyy-mm-dd
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;         // adjusted close — non-null is the contract
  volume: number | null;
}

// ---- CANSLIM (extended to 12 items) ----

export type CanslimKey =
  | 'C'  // Current quarterly earnings
  | 'A'  // Annual earnings increases
  | 'N'  // New highs / new products
  | 'S'  // Supply & demand (volume, float)
  | 'L'  // Leader (sector RS)
  | 'I'  // Institutional sponsorship
  | 'M'  // Market direction
  | 'Q'  // Quality (ROE, margins)
  | 'V'  // Valuation (PER, PEG)
  | 'B'  // Balance sheet (debt)
  | 'G'  // Revenue growth
  | 'T'; // Trend (ADX, MA alignment)

export interface CanslimItem {
  key: CanslimKey;
  label: string;        // Korean label
  description: string;  // one-line explanation
  score: number;        // 0-100
  starredForTypes: StockType[]; // types where this is a core item
}

export interface CanslimResult {
  items: CanslimItem[]; // length 12, in fixed order
}

// ---- Fundamental score (CANSLIM weighted by stock type) ----
// Displayed in UI as "펀더멘탈".

export interface FundamentalScoreResult {
  score: number;        // 0-100 weighted average across CANSLIM
  level: 'STRONG' | 'WATCH' | 'NEUTRAL' | 'AVOID';
  topContributors: { key: CanslimKey; label: string; score: number; weight: number }[];
  bottomContributors: { key: CanslimKey; label: string; score: number; weight: number }[];
}

// ---- Overall score (weighted blend of fundamental + timing) ----
// Displayed in UI as "종합".

export interface OverallScoreResult {
  score: number;  // 0-100, = fundamental.score * 0.55 + (timing.score/90*100) * 0.45
  level: 'STRONG' | 'WATCH' | 'NEUTRAL' | 'AVOID';
}

// ---- Trading strategy ----

export interface StrategyResult {
  entry: number | null;        // suggested entry price
  stop: number | null;         // stop loss
  target1: number | null;      // first profit target (ATR-based, reference only)
  target2: number | null;      // second target (ATR-based, reference only)
  riskReward1: number | null;  // R:R for target1
  riskReward2: number | null;  // R:R for target2
  atr14: number | null;        // ATR used
  stopRule: string;            // human-readable
  rationale: string;           // short paragraph
  exitStrategy: string;        // core exit rule (EMA20 trailing)
  rrWarning: string | null;    // warning when R:R is poor
}

// ---- Type insights (per stock type) ----

export interface TypeInsight {
  type: StockType;
  coreQuestions: string[];   // 1-2 key questions to monitor
  thesis: string;            // investment logic summary
  sellSignals: string[];     // 3-5 conditions to exit
}

// ---- Risk factors ----

export interface RiskFactor {
  severity: 'high' | 'medium' | 'low';
  message: string;
}

// ---- Supply & demand (Korean stocks only — Naver 수급) ----

export interface SupplyDemandData {
  foreign5d: number;       // 외국인 5일 순매매 (억원)
  foreign20d: number;      // 외국인 20일 순매매 (억원)
  institution5d: number;   // 기관 5일 순매매 (억원)
  institution20d: number;  // 기관 20일 순매매 (억원)
  consecutiveForeignBuy: number;   // 외국인 연속 순매수 일수 (음수=연속 순매도)
  consecutiveInstBuy: number;      // 기관 연속 순매수 일수
  dailyRows: number;       // 사용된 일수
}

// Final analyzer output per ticker
export interface AnalysisResult {
  fundamental: FundamentalData;
  classification: ClassificationResult;
  timingScore: TimingScoreResult;
  fundamentalScore: FundamentalScoreResult;
  overallScore: OverallScoreResult;
  canslim: CanslimResult;
  strategy: StrategyResult;
  typeInsight: TypeInsight;
  riskFactors: RiskFactor[];
  safetyGuard: SafetyGuardResult;
  indicators: {
    rs: number | null;
    adx: number | null;
    obvDivergence: boolean | null;
    volumeRatio: number | null;
    return30d: number | null;
    return90d: number | null;
    return1y: number | null;
    subIndustryEtf: string | null;
    ema20: number | null;
    sma50: number | null;
    sma200: number | null;
  };
  timingDetail: TimingDetail | null;
  priceBars: PriceBar[]; // for chart (last ~130 days)
  usdKrwRate: number | null; // USD/KRW spot, null on fetch failure
  supplyDemand: SupplyDemandData | null; // Korean stocks only
}

// ---- Timing precision analysis (5 sub-signals) ----

export interface TimingDetail {
  rsiDivergence: {
    signal: 'bearish' | 'bullish' | 'none';
    description: string;
  };
  ema20Slope: {
    slope: number;
    signal: 'strong_up' | 'up' | 'flat' | 'down' | 'strong_down';
    description: string;
  } | null;
  volumePattern: {
    ratio: number;
    signal: 'accumulation' | 'distribution' | 'neutral';
    description: string;
  } | null;
  atrTrend: {
    changeRatio: number;
    signal: 'expanding' | 'contracting' | 'stable';
    description: string;
  } | null;
  supportResistance: {
    clusters: Array<{
      price: number;
      sources: string[];
      distancePct: number;
      type: 'support' | 'resistance';
    }>;
    description: string;
  };
}
