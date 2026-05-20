import type {
  FundamentalScoreResult,
  OverallScoreResult,
  TimingScoreResult,
} from '../lib/types.js';
import { LEVEL_KO, SCORE_COLOR, SCORE_TEXT, scoreLevel } from './scoreColors.js';

interface Props {
  overall: OverallScoreResult;
  fundamental: FundamentalScoreResult;
  timing: TimingScoreResult;
}

// SVG circular gauge.
function Gauge({
  score,
  size,
  stroke,
  label,
  level,
  scoreFontClass = 'text-3xl',
}: {
  score: number;
  size: number;
  stroke: number;
  label: string;
  level: 'STRONG' | 'WATCH' | 'NEUTRAL' | 'AVOID';
  scoreFontClass?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const lvl = scoreLevel(score);
  const dash = (score / 100) * c;
  const color = SCORE_COLOR[lvl];

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke="#1e293b"
            strokeWidth={stroke}
            fill="none"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={`${dash} ${c}`}
            style={{ transition: 'stroke-dasharray .5s ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`font-bold tabular-nums ${scoreFontClass} ${SCORE_TEXT[lvl]}`}>
            {score}
          </span>
          <span className="text-[10px] text-slate-500">/ 100</span>
        </div>
      </div>
      <p className="mt-2 text-xs text-slate-400 font-medium">{label}</p>
      <p className={`text-xs font-semibold ${SCORE_TEXT[lvl]}`}>
        {LEVEL_KO[level]}
      </p>
    </div>
  );
}

export function TotalScoreCard({ overall, fundamental, timing }: Props) {
  // Timing is natively 0–90 — rescale to 0–100 for display consistency.
  const timingPct = Math.round((timing.score / 90) * 100);
  return (
    <section className="rounded-xl bg-[#0f172a] border border-[#1e293b] p-5">
      <h3 className="text-xs font-semibold text-slate-400 mb-4 tracking-wider uppercase">
        종합 점수
      </h3>
      <div className="flex flex-col items-center gap-4">
        <Gauge
          score={overall.score}
          level={overall.level}
          label="종합"
          size={150}
          stroke={11}
          scoreFontClass="text-4xl"
        />
        <div className="flex items-center gap-6 sm:gap-8 pt-2">
          <Gauge
            score={fundamental.score}
            level={fundamental.level}
            label="펀더멘탈"
            size={88}
            stroke={7}
            scoreFontClass="text-2xl"
          />
          <div className="text-slate-700 text-2xl">+</div>
          <Gauge
            score={timingPct}
            level={timing.level}
            label="타이밍"
            size={88}
            stroke={7}
            scoreFontClass="text-2xl"
          />
        </div>
      </div>
      <div className="mt-4 pt-4 border-t border-[#1e293b] grid grid-cols-2 gap-2 text-[11px]">
        <div>
          <p className="text-slate-500 mb-1">상위 기여 ↑ <span className="text-slate-600">(펀더)</span></p>
          <ul className="space-y-0.5">
            {fundamental.topContributors.map((c) => (
              <li key={c.key} className="flex justify-between text-slate-300">
                <span className="truncate">{c.label}</span>
                <span className="text-emerald-400 ml-2">{c.score}×{c.weight}%</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-slate-500 mb-1">하위 기여 ↓ <span className="text-slate-600">(펀더)</span></p>
          <ul className="space-y-0.5">
            {fundamental.bottomContributors.map((c) => (
              <li key={c.key} className="flex justify-between text-slate-300">
                <span className="truncate">{c.label}</span>
                <span className="text-red-400 ml-2">{c.score}×{c.weight}%</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <TimingBreakdown timing={timing} />
    </section>
  );
}

function TimingBreakdown({ timing }: { timing: TimingScoreResult }) {
  const sorted = [
    ...timing.gains.slice().sort((a, b) => b.delta - a.delta),
    ...timing.deductions.slice().sort((a, b) => a.delta - b.delta),
  ];
  if (sorted.length === 0) return null;
  const gainSum = timing.gains.reduce((a, g) => a + g.delta, 0);
  const lossSum = timing.deductions.reduce((a, d) => a + d.delta, 0);

  return (
    <details className="mt-3 pt-3 border-t border-[#1e293b] text-[11px] group">
      <summary className="cursor-pointer list-none flex items-center justify-between text-slate-400 hover:text-slate-200 select-none">
        <span className="flex items-center gap-1.5">
          <span className="text-[9px] transition-transform group-open:rotate-90">▶</span>
          <span>타이밍 점수 상세</span>
        </span>
        <span className="text-[10px] text-slate-500 tabular-nums">
          <span className="text-emerald-400">+{gainSum}</span>
          {' / '}
          <span className="text-red-400">{lossSum}</span>
        </span>
      </summary>
      <ul className="mt-2 space-y-0.5">
        {sorted.map((r, i) => {
          const color =
            r.delta > 0 ? 'text-emerald-400'
              : r.delta < 0 ? 'text-red-400'
              : 'text-slate-500';
          const sign = r.delta > 0 ? '+' : '';
          return (
            <li
              key={i}
              className="flex justify-between gap-2 text-slate-300 leading-tight"
            >
              <span className="break-words flex-1">{r.reason}</span>
              <span className={`${color} font-mono tabular-nums whitespace-nowrap`}>
                {r.delta === 0 ? '·' : `${sign}${r.delta}`}
              </span>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
