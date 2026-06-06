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

// Entry grade — derived from the Composite timing score (0–100 scale, same
// units the gauge and breakdown sum use). Thresholds align with the
// compositeLevel mapping (75/60/45) so the entry label never contradicts
// the level shown under the gauge. chaseWarning overrides to "추격주의"
// regardless of how high timing scores (fires when overheatControl < 30
// or when the legacy pathA/pathB chase heuristics hit).
export type EntryGradeLevel = 'ready' | 'wait' | 'avoid' | 'danger' | 'chase';

export function entryGrade(
  timingScore: number,
  chaseWarning = false,
): { label: string; level: EntryGradeLevel; textClass: string } {
  if (chaseWarning) {
    return { label: '추격주의', level: 'chase', textClass: 'text-orange-400' };
  }
  if (timingScore >= 75) {
    return { label: '진입 적기', level: 'ready', textClass: 'text-emerald-400' };
  }
  if (timingScore >= 60) {
    return { label: '관심/대기', level: 'wait', textClass: 'text-amber-400' };
  }
  if (timingScore >= 45) {
    return { label: '회피', level: 'avoid', textClass: 'text-slate-400' };
  }
  return { label: '위험', level: 'danger', textClass: 'text-red-400' };
}
