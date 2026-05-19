import type { CanslimResult, StockType } from '../lib/types.js';
import { SCORE_BG_SOLID, SCORE_TEXT, scoreLevel } from './scoreColors.js';

interface Props {
  canslim: CanslimResult;
  primaryType: StockType;
}

export function CanslimBars({ canslim, primaryType }: Props) {
  return (
    <section className="rounded-xl bg-[#0f172a] border border-[#1e293b] p-5">
      <div className="flex items-baseline justify-between mb-4">
        <h3 className="text-xs font-semibold text-slate-400 tracking-wider uppercase">
          CANSLIM 12 항목
        </h3>
        <span className="text-[10px] text-slate-500">⭐ 유형별 핵심</span>
      </div>
      <ul className="space-y-2.5">
        {canslim.items.map((item) => {
          const lvl = scoreLevel(item.score);
          const starred = item.starredForTypes.includes(primaryType);
          return (
            <li key={item.key} className="text-xs">
              <div className="flex items-center justify-between gap-2 mb-1">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="inline-flex items-center justify-center w-6 h-6 text-[11px] font-bold rounded bg-[#1e293b] text-slate-300 flex-shrink-0">
                    {item.key}
                  </span>
                  <span
                    className={`font-medium truncate ${starred ? 'text-amber-300' : 'text-slate-200'}`}
                  >
                    {item.label}
                    {starred && <span className="ml-1">⭐</span>}
                  </span>
                </div>
                <span className={`tabular-nums font-semibold ${SCORE_TEXT[lvl]} flex-shrink-0`}>
                  {item.score}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-[#1e293b] overflow-hidden">
                <div
                  className={`h-full ${SCORE_BG_SOLID[lvl]} rounded-full`}
                  style={{ width: `${item.score}%`, transition: 'width .4s' }}
                />
              </div>
              <p className="mt-1 text-[10px] text-slate-500 ml-8 leading-tight">
                {item.description}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
