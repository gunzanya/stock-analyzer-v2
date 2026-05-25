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

// Entry grade — independent of fundamental level. Derived from timingPct
// (0-100). When chaseWarning fires (peak earnings + 30d spike + EMA20 stretch),
// override to "추격주의" regardless of how high timing scores.
export type EntryGradeLevel = 'ready' | 'wait' | 'avoid' | 'danger' | 'chase';

export function entryGrade(
  timingPct: number,
  chaseWarning = false,
): { label: string; level: EntryGradeLevel; textClass: string } {
  if (chaseWarning) {
    return { label: '추격주의', level: 'chase', textClass: 'text-orange-400' };
  }
  if (timingPct >= 70) {
    return { label: '진입 적기', level: 'ready', textClass: 'text-emerald-400' };
  }
  if (timingPct >= 55) {
    return { label: '관심/대기', level: 'wait', textClass: 'text-amber-400' };
  }
  if (timingPct >= 40) {
    return { label: '회피', level: 'avoid', textClass: 'text-slate-400' };
  }
  return { label: '위험', level: 'danger', textClass: 'text-red-400' };
}
