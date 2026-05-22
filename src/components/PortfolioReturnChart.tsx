import { useMemo } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts';
import type { PortfolioSnapshot, PortfolioEvent } from '../lib/portfolio.js';

interface Props {
  snapshots: PortfolioSnapshot[];
  events: PortfolioEvent[];
}

interface ChartPoint {
  date: string;
  returnPct: number;
  events?: PortfolioEvent[];
}

function formatDate(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${parseInt(m)}/${parseInt(d)}`;
}

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload as ChartPoint;
  const color = d.returnPct >= 0 ? '#34d399' : '#f87171';
  return (
    <div className="rounded-lg bg-[#0f172a] border border-[#1e293b] px-3 py-2 shadow-xl text-xs">
      <p className="text-slate-400 mb-1">{d.date}</p>
      <p className="font-bold tabular-nums" style={{ color }}>
        {d.returnPct >= 0 ? '+' : ''}{d.returnPct.toFixed(2)}%
      </p>
      {d.events?.map((e, i) => (
        <p key={i} className="mt-1 text-[10px] text-slate-300">
          {e.type === 'buy' ? '▲ 매수' : '▼ 청산'} {e.ticker}
        </p>
      ))}
    </div>
  );
}

function EventDot({ cx, cy, payload }: any) {
  const p = payload as ChartPoint;
  if (!p.events?.length || cx == null || cy == null) return null;
  const hasBuy = p.events.some((e) => e.type === 'buy');
  const hasClose = p.events.some((e) => e.type === 'close');
  return (
    <g>
      {hasBuy && (
        <text x={cx} y={cy - 10} textAnchor="middle" fill="#34d399" fontSize={11} fontWeight="bold">
          ▲
        </text>
      )}
      {hasClose && (
        <text x={cx} y={cy + 16} textAnchor="middle" fill="#f87171" fontSize={11} fontWeight="bold">
          ▼
        </text>
      )}
    </g>
  );
}

export function PortfolioReturnChart({ snapshots, events }: Props) {
  const data = useMemo<ChartPoint[]>(() => {
    if (snapshots.length === 0) return [];
    const eventsByDate = new Map<string, PortfolioEvent[]>();
    for (const e of events) {
      const arr = eventsByDate.get(e.date) ?? [];
      arr.push(e);
      eventsByDate.set(e.date, arr);
    }
    const sorted = [...snapshots].sort((a, b) => a.date.localeCompare(b.date));
    return sorted.map((s) => ({
      date: s.date,
      returnPct: +(s.returnPct * 100).toFixed(2),
      events: eventsByDate.get(s.date),
    }));
  }, [snapshots, events]);

  if (data.length < 2) {
    return (
      <section className="rounded-xl border border-[#1e293b] bg-[#0f172a] p-4">
        <h3 className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-2">
          수익 곡선
        </h3>
        <p className="text-xs text-slate-500 py-8 text-center">
          2일 이상의 데이터가 쌓이면 차트가 표시됩니다.
        </p>
      </section>
    );
  }

  const minR = Math.min(...data.map((d) => d.returnPct));
  const maxR = Math.max(...data.map((d) => d.returnPct));
  const pad = Math.max(1, (maxR - minR) * 0.15);
  const yMin = Math.floor(minR - pad);
  const yMax = Math.ceil(maxR + pad);

  const gradientId = 'returnGrad';

  const zeroRatio = maxR !== minR
    ? Math.max(0, Math.min(1, (maxR - 0) / (maxR - minR)))
    : 0.5;

  return (
    <section className="rounded-xl border border-[#1e293b] bg-[#0f172a] p-4">
      <h3 className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-3">
        수익 곡선
      </h3>
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={data} margin={{ top: 15, right: 10, left: -15, bottom: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#34d399" stopOpacity={0.3} />
              <stop offset={`${zeroRatio * 100}%`} stopColor="#34d399" stopOpacity={0.05} />
              <stop offset={`${zeroRatio * 100}%`} stopColor="#f87171" stopOpacity={0.05} />
              <stop offset="100%" stopColor="#f87171" stopOpacity={0.3} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="date"
            tickFormatter={formatDate}
            tick={{ fill: '#475569', fontSize: 10 }}
            axisLine={{ stroke: '#1e293b' }}
            tickLine={false}
            minTickGap={40}
          />
          <YAxis
            domain={[yMin, yMax]}
            tickFormatter={(v: number) => `${v}%`}
            tick={{ fill: '#475569', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CustomTooltip />} />
          <ReferenceLine y={0} stroke="#334155" strokeDasharray="4 4" />
          <Area
            type="monotone"
            dataKey="returnPct"
            stroke="#818cf8"
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            dot={<EventDot />}
            activeDot={{ r: 4, fill: '#818cf8', stroke: '#0f172a', strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </section>
  );
}
