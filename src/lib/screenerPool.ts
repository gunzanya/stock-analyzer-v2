import { SP500 } from './sp500.js';
import { RUSSELL_EXTRA } from './russell1000.js';

// Combined US large/mid-cap pool — S&P 500 + Russell 1000 extras
export const SCREENER_POOL: readonly string[] = [...SP500, ...RUSSELL_EXTRA];

/** Pick `n` distinct tickers from the pool, uniform at random. */
export function pickRandom(n: number, seed?: () => number): string[] {
  const rng = seed ?? Math.random;
  const copy = [...SCREENER_POOL];
  const k = Math.min(n, copy.length);
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(rng() * (copy.length - i));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, k);
}
