import type { EntryScoreResult, TotalScoreResult } from '../lib/types.js';
import { LEVEL_KO, SCORE_COLOR, SCORE_TEXT, scoreLevel } from './scoreColors.js';

interface Props {
  total: TotalScoreResult;
  entry: EntryScoreResult;
}

// SVG circular gauge
function Gauge({
  score,
  size = 110,
  label,
  level,
}: {
  score: number;
  size?: number;
  label: string;
  level: TotalScoreResult['level'];
}) {
  const stroke = 9;
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
          <span className={`text-3xl font-bold tabular-nums ${SCORE_TEXT[lvl]}`}>
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

export function TotalScoreCard({ total, entry }: Props) {
  return (
    <section className="rounded-xl bg-[#0f172a] border border-[#1e293b] p-5">
      <h3 className="text-xs font-semibold text-slate-400 mb-4 tracking-wider uppercase">
        종합 점수
      </h3>
      <div className="flex justify-around items-center gap-3">
        <Gauge score={total.score} level={total.level} label="TotalScore" />
        <div className="text-slate-700">|</div>
        <Gauge
          score={Math.round((entry.score / 90) * 100)}
          level={entry.level}
          label="EntryScore"
        />
      </div>
      <div className="mt-4 pt-4 border-t border-[#1e293b] grid grid-cols-2 gap-2 text-[11px]">
        <div>
          <p className="text-slate-500 mb-1">상위 기여 ↑</p>
          <ul className="space-y-0.5">
            {total.topContributors.map((c) => (
              <li key={c.key} className="flex justify-between text-slate-300">
                <span className="truncate">{c.label}</span>
                <span className="text-emerald-400 ml-2">{c.score}×{c.weight}%</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-slate-500 mb-1">하위 기여 ↓</p>
          <ul className="space-y-0.5">
            {total.bottomContributors.map((c) => (
              <li key={c.key} className="flex justify-between text-slate-300">
                <span className="truncate">{c.label}</span>
                <span className="text-red-400 ml-2">{c.score}×{c.weight}%</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
