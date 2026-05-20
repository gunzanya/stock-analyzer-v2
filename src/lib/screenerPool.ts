// Hardcoded pool of US large/mid-cap tickers used by the random screener.
// Deduplicated (the user-provided list had GS/ABBV/RIVN duplicates) and
// SQ → XYZ (Block renamed in 2024).

export const SCREENER_POOL: readonly string[] = [
  // Mega-cap tech
  'AAPL', 'MSFT', 'GOOG', 'AMZN', 'NVDA', 'META', 'TSLA',
  // Mega-cap conglomerate / payments
  'BRK-B', 'V', 'MA', 'AXP', 'PYPL', 'XYZ',
  // Healthcare / pharma
  'JNJ', 'ABBV', 'MRK', 'LLY', 'PFE', 'UNH', 'TMO', 'ABT', 'DHR', 'BMY',
  'GILD', 'AMGN', 'ISRG', 'ELV', 'CI', 'HUM',
  // Consumer staples / defensive
  'WMT', 'PG', 'COST', 'PEP', 'KO', 'MO', 'PM', 'CL', 'EL',
  // Consumer discretionary
  'HD', 'MCD', 'NKE', 'LOW', 'TJX', 'ROST', 'TGT', 'SBUX', 'CMG', 'YUM',
  // Communication / media
  'NFLX', 'DIS', 'TMUS', 'T', 'VZ', 'SPOT',
  // Semis
  'AVGO', 'AMD', 'INTC', 'MU', 'TSM', 'QCOM', 'TXN', 'AMAT', 'LRCX',
  // Industrials / aerospace
  'BA', 'CAT',
  // Software / SaaS / cybersecurity
  'CRM', 'CSCO', 'DDOG', 'NET', 'SNOW', 'PANW', 'CRWD', 'ZS',
  // Energy
  'XOM', 'CVX', 'COP', 'SLB',
  // Financials
  'GS', 'MS', 'JPM', 'BAC', 'WFC', 'C', 'BLK', 'SCHW',
  // Utilities
  'NEE', 'SO', 'DUK',
  // Autos
  'F', 'GM',
  // High-beta / speculative / new economy
  'UBER', 'ABNB', 'SHOP', 'COIN', 'PLTR', 'RIVN', 'GME', 'IONQ',
  'MSTR', 'HOOD',
];

/** Pick `n` distinct tickers from the pool, uniform at random. */
export function pickRandom(n: number, seed?: () => number): string[] {
  const rng = seed ?? Math.random;
  const copy = [...SCREENER_POOL];
  // Fisher–Yates, only the prefix of length n is needed.
  const k = Math.min(n, copy.length);
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(rng() * (copy.length - i));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, k);
}
