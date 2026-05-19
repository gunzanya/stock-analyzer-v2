import type { RiskFactor } from '../lib/types.js';

interface Props {
  risks: RiskFactor[];
}

const SEVERITY_STYLE: Record<RiskFactor['severity'], { dot: string; text: string }> = {
  high: { dot: 'bg-red-500', text: 'text-red-300' },
  medium: { dot: 'bg-amber-500', text: 'text-amber-300' },
  low: { dot: 'bg-slate-500', text: 'text-slate-400' },
};
const SEVERITY_KO: Record<RiskFactor['severity'], string> = {
  high: '높음',
  medium: '중간',
  low: '낮음',
};

export function RiskFactorsCard({ risks }: Props) {
  if (risks.length === 0) {
    return (
      <section className="rounded-xl bg-emerald-950/30 border border-emerald-900 p-5">
        <h3 className="text-xs font-semibold text-emerald-400 tracking-wider uppercase mb-2">
          ⚠️ 리스크 요인
        </h3>
        <p className="text-sm text-emerald-300">감지된 리스크 없음</p>
      </section>
    );
  }
  const sorted = [...risks].sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return order[a.severity] - order[b.severity];
  });
  return (
    <section className="rounded-xl bg-gradient-to-br from-red-950/40 to-red-950/20 border border-red-900/60 p-5">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-xs font-semibold text-red-300 tracking-wider uppercase">
          ⚠️ 리스크 요인
        </h3>
        <span className="text-[10px] text-red-400">{risks.length}개 감지</span>
      </div>
      <ul className="space-y-2">
        {sorted.map((r, i) => {
          const s = SEVERITY_STYLE[r.severity];
          return (
            <li key={i} className="flex items-start gap-2.5">
              <span
                className={`flex-shrink-0 w-2 h-2 rounded-full ${s.dot} mt-1.5`}
                aria-hidden
              />
              <div className="flex-1 min-w-0">
                <p className={`text-xs font-medium leading-relaxed ${s.text}`}>
                  {r.message}
                </p>
                <p className="text-[10px] text-slate-500 mt-0.5">
                  심각도 {SEVERITY_KO[r.severity]}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
