import type { SupplyDemandData } from '../lib/types.js';

function fmt(v: number): string {
  const abs = Math.abs(v);
  const sign = v > 0 ? '+' : v < 0 ? '-' : '';
  return `${sign}${abs.toLocaleString()}`;
}

function barColor(v: number): string {
  if (v > 0) return 'bg-red-500/80';
  if (v < 0) return 'bg-blue-500/80';
  return 'bg-slate-600';
}

function textColor(v: number): string {
  if (v > 0) return 'text-red-400';
  if (v < 0) return 'text-blue-400';
  return 'text-slate-400';
}

function BarRow({ label, value5d, value20d }: {
  label: string;
  value5d: number;
  value20d: number;
}) {
  const max = Math.max(
    Math.abs(value5d),
    Math.abs(value20d),
    1,
  );
  const pct5 = Math.min((Math.abs(value5d) / max) * 100, 100);
  const pct20 = Math.min((Math.abs(value20d) / max) * 100, 100);

  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-semibold text-slate-300">{label}</p>
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-slate-500 w-8 shrink-0">5일</span>
        <div className="flex-1 h-4 rounded bg-[#1e293b] overflow-hidden flex items-center">
          <div
            className={`h-full rounded ${barColor(value5d)} transition-all`}
            style={{ width: `${Math.max(pct5, 2)}%` }}
          />
        </div>
        <span className={`text-xs font-mono tabular-nums w-20 text-right shrink-0 ${textColor(value5d)}`}>
          {fmt(value5d)}억
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-slate-500 w-8 shrink-0">20일</span>
        <div className="flex-1 h-4 rounded bg-[#1e293b] overflow-hidden flex items-center">
          <div
            className={`h-full rounded ${barColor(value20d)} transition-all`}
            style={{ width: `${Math.max(pct20, 2)}%` }}
          />
        </div>
        <span className={`text-xs font-mono tabular-nums w-20 text-right shrink-0 ${textColor(value20d)}`}>
          {fmt(value20d)}억
        </span>
      </div>
    </div>
  );
}

interface Props {
  data: SupplyDemandData;
}

export function SupplyDemandCard({ data }: Props) {
  const bothBuy =
    data.consecutiveForeignBuy >= 5 && data.consecutiveInstBuy >= 5;
  const bothSell =
    data.consecutiveForeignBuy <= -5 && data.consecutiveInstBuy <= -5;

  return (
    <section className="rounded-xl border border-[#1e293b] bg-[#0a0f1a] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[10px] uppercase tracking-wider font-bold text-slate-500">
          수급 (외인·기관)
        </h3>
        {bothBuy && (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-500/15 border border-red-700/50 text-red-300">
            스마트머니 유입
          </span>
        )}
        {bothSell && (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-500/15 border border-blue-700/50 text-blue-300">
            스마트머니 이탈
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <BarRow
          label="외국인"
          value5d={data.foreign5d}
          value20d={data.foreign20d}
        />
        <BarRow
          label="기관"
          value5d={data.institution5d}
          value20d={data.institution20d}
        />
      </div>

      <div className="flex flex-wrap gap-3 text-[11px] text-slate-400 pt-1 border-t border-[#1e293b]">
        <span>
          외인 연속{' '}
          <span className={data.consecutiveForeignBuy > 0 ? 'text-red-400' : data.consecutiveForeignBuy < 0 ? 'text-blue-400' : 'text-slate-500'}>
            {data.consecutiveForeignBuy > 0
              ? `순매수 ${data.consecutiveForeignBuy}일`
              : data.consecutiveForeignBuy < 0
                ? `순매도 ${Math.abs(data.consecutiveForeignBuy)}일`
                : '—'}
          </span>
        </span>
        <span>
          기관 연속{' '}
          <span className={data.consecutiveInstBuy > 0 ? 'text-red-400' : data.consecutiveInstBuy < 0 ? 'text-blue-400' : 'text-slate-500'}>
            {data.consecutiveInstBuy > 0
              ? `순매수 ${data.consecutiveInstBuy}일`
              : data.consecutiveInstBuy < 0
                ? `순매도 ${Math.abs(data.consecutiveInstBuy)}일`
                : '—'}
          </span>
        </span>
        <span className="text-slate-600">
          ({data.dailyRows}일 데이터)
        </span>
      </div>
    </section>
  );
}
