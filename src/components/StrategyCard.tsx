import type { StrategyResult } from '../lib/types.js';

interface Props {
  strategy: StrategyResult;
  currency?: string | null;
}

function fmt(v: number | null, currency: string): string {
  if (v == null) return '—';
  if (currency === 'KRW' || currency === 'JPY') {
    return v.toLocaleString();
  }
  return `$${v.toFixed(2)}`;
}

export function StrategyCard({ strategy, currency }: Props) {
  const c = currency ?? 'USD';
  return (
    <section className="rounded-xl bg-[#0f172a] border border-[#1e293b] p-5">
      <h3 className="text-xs font-semibold text-slate-400 mb-4 tracking-wider uppercase">
        매매 전략
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Bucket label="진입가" value={fmt(strategy.entry, c)} tone="neutral" />
        <Bucket label="손절가" value={fmt(strategy.stop, c)} tone="red" />
        <Bucket
          label="1차 목표"
          value={fmt(strategy.target1, c)}
          extra={strategy.riskReward1 != null ? `R:R ${strategy.riskReward1}` : null}
          tone="green-soft"
        />
        <Bucket
          label="2차 목표"
          value={fmt(strategy.target2, c)}
          extra={strategy.riskReward2 != null ? `R:R ${strategy.riskReward2}` : null}
          tone="green"
        />
      </div>
      <div className="mt-4 pt-3 border-t border-[#1e293b] text-[11px] text-slate-400 space-y-1">
        <p>
          <span className="text-slate-500 mr-1">손절 기준:</span>
          {strategy.stopRule}
        </p>
        <p>
          <span className="text-slate-500 mr-1">근거:</span>
          {strategy.rationale}
        </p>
      </div>
    </section>
  );
}

function Bucket({
  label,
  value,
  extra,
  tone,
}: {
  label: string;
  value: string;
  extra?: string | null;
  tone: 'neutral' | 'red' | 'green' | 'green-soft';
}) {
  const toneStyle = {
    neutral: 'border-slate-700 bg-[#0a0f1a]',
    red: 'border-red-800 bg-red-950/40',
    green: 'border-emerald-800 bg-emerald-950/40',
    'green-soft': 'border-emerald-900 bg-emerald-950/20',
  }[tone];
  const textStyle = {
    neutral: 'text-slate-100',
    red: 'text-red-300',
    green: 'text-emerald-300',
    'green-soft': 'text-emerald-400',
  }[tone];
  return (
    <div className={`rounded-lg border ${toneStyle} p-3`}>
      <p className="text-[10px] font-medium text-slate-500 tracking-wider uppercase mb-1">
        {label}
      </p>
      <p className={`text-lg font-bold tabular-nums ${textStyle}`}>{value}</p>
      {extra && <p className="text-[10px] text-slate-500 mt-0.5">{extra}</p>}
    </div>
  );
}
