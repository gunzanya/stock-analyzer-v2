import type { TypeInsight } from '../lib/types.js';
import { STOCK_TYPE_LABELS } from '../lib/types.js';

interface Props {
  insight: TypeInsight;
}

export function TypeInsightCard({ insight }: Props) {
  const { emoji, ko } = STOCK_TYPE_LABELS[insight.type];
  return (
    <section className="rounded-xl bg-[#0f172a] border border-[#1e293b] p-5">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xl">{emoji}</span>
        <h3 className="text-sm font-semibold text-slate-200">
          {ko} 유형 인사이트
        </h3>
      </div>

      <div className="space-y-4 text-xs">
        <div>
          <h4 className="text-[10px] uppercase tracking-wider font-bold text-indigo-400 mb-2">
            ❓ 핵심 질문
          </h4>
          <ul className="space-y-1.5 text-slate-300">
            {insight.coreQuestions.map((q, i) => (
              <li key={i} className="leading-relaxed pl-3 border-l-2 border-indigo-700">
                {q}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h4 className="text-[10px] uppercase tracking-wider font-bold text-emerald-400 mb-2">
            💡 투자 논리
          </h4>
          <p className="text-slate-300 leading-relaxed">{insight.thesis}</p>
        </div>

        <div>
          <h4 className="text-[10px] uppercase tracking-wider font-bold text-red-400 mb-2">
            🚪 매도 신호
          </h4>
          <ul className="space-y-1 text-slate-300">
            {insight.sellSignals.map((s, i) => (
              <li key={i} className="flex gap-2 leading-relaxed">
                <span className="text-red-500 flex-shrink-0">▸</span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
