import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { PriceBar } from '../lib/types.js';

interface Props {
  bars: PriceBar[];
  ema20?: number | null;
  sma50?: number | null;
  sma200?: number | null;
}

interface ChartRow {
  date: string;
  close: number;
  ema20: number | null;
  sma50: number | null;
  sma200: number | null;
}

function computeOverlays(bars: PriceBar[]): ChartRow[] {
  // bars are newest-first; reverse for chronological chart
  const xs = [...bars].reverse();
  const closes = xs.map((b) => b.close);
  const ema20: (number | null)[] = new Array(xs.length).fill(null);
  const sma50: (number | null)[] = new Array(xs.length).fill(null);
  const sma200: (number | null)[] = new Array(xs.length).fill(null);
  // EMA 20
  if (closes.length >= 20) {
    const k = 2 / 21;
    let prev = closes.slice(0, 20).reduce((a, b) => a + b, 0) / 20;
    ema20[19] = prev;
    for (let i = 20; i < closes.length; i++) {
      prev = closes[i] * k + prev * (1 - k);
      ema20[i] = prev;
    }
  }
  // SMA helper
  function sma(period: number, target: (number | null)[]) {
    if (closes.length < period) return;
    let sum = closes.slice(0, period).reduce((a, b) => a + b, 0);
    target[period - 1] = sum / period;
    for (let i = period; i < closes.length; i++) {
      sum += closes[i] - closes[i - period];
      target[i] = sum / period;
    }
  }
  sma(50, sma50);
  sma(200, sma200);
  return xs.map((b, i) => ({
    date: b.date.slice(5), // MM-DD
    close: b.close,
    ema20: ema20[i],
    sma50: sma50[i],
    sma200: sma200[i],
  }));
}

export function PriceChart({ bars }: Props) {
  if (bars.length < 20) {
    return (
      <section className="rounded-xl bg-[#0f172a] border border-[#1e293b] p-5">
        <h3 className="text-xs font-semibold text-slate-400 mb-4 tracking-wider uppercase">
          주가 차트
        </h3>
        <p className="text-xs text-slate-500">데이터 부족 (20 거래일 미만)</p>
      </section>
    );
  }
  const data = computeOverlays(bars);
  const closes = data.map((d) => d.close);
  const allValues = [
    ...closes,
    ...data.flatMap((d) => [d.ema20, d.sma50, d.sma200].filter((v): v is number => v != null)),
  ];
  const dataMin = Math.min(...allValues);
  const dataMax = Math.max(...allValues);
  const padding = (dataMax - dataMin) * 0.05;

  return (
    <section className="rounded-xl bg-[#0f172a] border border-[#1e293b] p-5">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-xs font-semibold text-slate-400 tracking-wider uppercase">
          주가 (최근 12개월)
        </h3>
        <div className="flex gap-3 text-[10px]">
          <Legend color="#94a3b8" label="종가" />
          <Legend color="#3b82f6" label="EMA20" />
          <Legend color="#f59e0b" label="MA50" />
          <Legend color="#a855f7" label="MA200" />
        </div>
      </div>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 5, right: 8, bottom: 5, left: 8 }}>
            <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              stroke="#475569"
              tick={{ fontSize: 10 }}
              interval={Math.floor(data.length / 6)}
            />
            <YAxis
              stroke="#475569"
              tick={{ fontSize: 10 }}
              domain={[dataMin - padding, dataMax + padding]}
              width={50}
            />
            <Tooltip
              contentStyle={{
                background: '#0a0f1a',
                border: '1px solid #1e293b',
                borderRadius: 6,
                fontSize: 11,
              }}
              labelStyle={{ color: '#cbd5e1' }}
            />
            <Line
              type="monotone"
              dataKey="close"
              stroke="#94a3b8"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
              name="종가"
            />
            <Line
              type="monotone"
              dataKey="ema20"
              stroke="#3b82f6"
              strokeWidth={1.2}
              dot={false}
              isAnimationActive={false}
              name="EMA20"
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="sma50"
              stroke="#f59e0b"
              strokeWidth={1.2}
              dot={false}
              isAnimationActive={false}
              name="MA50"
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="sma200"
              stroke="#a855f7"
              strokeWidth={1.2}
              strokeDasharray="3 3"
              dot={false}
              isAnimationActive={false}
              name="MA200"
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1 text-slate-400">
      <span
        className="inline-block w-2.5 h-0.5 rounded"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}
