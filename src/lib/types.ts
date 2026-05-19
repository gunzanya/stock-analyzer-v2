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
  dividendYield: number | null;    // 0–1
  payoutRatio: number | null;
  dividendGrowthYears: number | null;

  // Balance sheet
  totalAssets: number | null;
  totalLiabilities: number | null;
  totalEquity: number | null;
  cashAndShortTerm: number | null;
  investmentAssets: number | null;
  debtToEquity: number | null;

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
}

// Entry score
export interface EntryScoreResult {
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

// Final analyzer output per ticker
export interface AnalysisResult {
  fundamental: FundamentalData;
  classification: ClassificationResult;
  entryScore: EntryScoreResult;
  safetyGuard: SafetyGuardResult;
  indicators: {
    rs: number | null;            // relative strength 0–100
    adx: number | null;
    obvDivergence: boolean | null;
    volumeRatio: number | null;
    return30d: number | null;
    return90d: number | null;
    return1y: number | null;
    subIndustryEtf: string | null;
  };
}
