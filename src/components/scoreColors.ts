// Score → color/level mapping shared across components.
// Per spec: 70+ green, 40-69 amber, <40 red.

export function scoreLevel(score: number): 'high' | 'mid' | 'low' {
  if (score >= 70) return 'high';
  if (score >= 40) return 'mid';
  return 'low';
}

export const SCORE_COLOR: Record<'high' | 'mid' | 'low', string> = {
  high: '#10b981', // emerald-500
  mid: '#f59e0b',  // amber-500
  low: '#ef4444',  // red-500
};

export const SCORE_TEXT: Record<'high' | 'mid' | 'low', string> = {
  high: 'text-emerald-400',
  mid: 'text-amber-400',
  low: 'text-red-400',
};

export const SCORE_BG: Record<'high' | 'mid' | 'low', string> = {
  high: 'bg-emerald-500/20',
  mid: 'bg-amber-500/20',
  low: 'bg-red-500/20',
};

export const SCORE_BG_SOLID: Record<'high' | 'mid' | 'low', string> = {
  high: 'bg-emerald-500',
  mid: 'bg-amber-500',
  low: 'bg-red-500',
};

export const LEVEL_KO: Record<'STRONG' | 'WATCH' | 'NEUTRAL' | 'AVOID', string> = {
  STRONG: '강력 매수',
  WATCH: '관심',
  NEUTRAL: '중립',
  AVOID: '회피',
};
