import { useMemo, useState } from 'react';
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { PriceBar } from '../lib/types.js';
import {
  bollingerBands,
  fibonacciLevels,
  macd,
  type FibLevels,
} from '../lib/indicators.js';

interface Props {
  bars: PriceBar[];
}

interface ChartRow {
  date: string;
  close: number;
  ema20: number | null;
  sma50: number | null;
  sma200: number | null;
  bbUpper: number | null;
  bbLower: number | null;
  bbBandFill: [number, number] | null;
  macd: number | null;
  macdSignal: number | null;
  macdHist: number | null;
}

interface ChartData {
  rows: ChartRow[];
  fib: FibLevels | null;
}

function computeChartData(bars: PriceBar[]): ChartData {
  // bars are newest-first; reverse for chronological chart
  const xs = [...bars].reverse();
  const closes = xs.map((b) => b.close);
  const n = xs.length;
  const ema20: (number | null)[] = new Array(n).fill(null);
  const sma50: (number | null)[] = new Array(n).fill(null);
  const sma200: (number | null)[] = new Array(n).fill(null);
  if (n >= 20) {
    const k = 2 / 21;
    let prev = closes.slice(0, 20).reduce((a, b) => a + b, 0) / 20;
    ema20[19] = prev;
    for (let i = 20; i < n; i++) {
      prev = closes[i] * k + prev * (1 - k);
      ema20[i] = prev;
    }
  }
  function smaFill(period: number, target: (number | null)[]) {
    if (n < period) return;
    let sum = closes.slice(0, period).reduce((a, b) => a + b, 0);
    target[period - 1] = sum / period;
    for (let i = period; i < n; i++) {
      sum += closes[i] - closes[i - period];
      target[i] = sum / period;
    }
  }
  smaFill(50, sma50);
  smaFill(200, sma200);

  // Bollinger and MACD are computed on newest-first bars but produce
  // oldest-first arrays — align with `xs` (which is also oldest-first).
  const bb = bollingerBands(bars);
  const md = macd(bars);
  const fib = fibonacciLevels(bars);

  const rows: ChartRow[] = xs.map((b, i) => {
    const upper = bb?.upper[i] ?? null;
    const lower = bb?.lower[i] ?? null;
    return {
      date: b.date.slice(5), // MM-DD
      close: b.close,
      ema20: ema20[i],
      sma50: sma50[i],
      sma200: sma200[i],
      bbUpper: upper,
      bbLower: lower,
      // Area's `dataKey` expects a [low, high] tuple for shaded ranges.
      bbBandFill: upper != null && lower != null ? [lower, upper] : null,
      macd: md?.macd[i] ?? null,
      macdSignal: md?.signal[i] ?? null,
      macdHist: md?.histogram[i] ?? null,
    };
  });

  return { rows, fib };
}

export function PriceChart({ bars }: Props) {
  const [showFib, setShowFib] = useState(true);
  const [showBB, setShowBB] = useState(false);
  const [showMACD, setShowMACD] = useState(false);

  const data = useMemo(() => computeChartData(bars), [bars]);

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

  const closes = data.rows.map((d) => d.close);
  const overlayVals = data.rows.flatMap((d) =>
    [d.ema20, d.sma50, d.sma200].filter((v): v is number => v != null),
  );
  const bbVals = showBB
    ? data.rows.flatMap((d) =>
        [d.bbUpper, d.bbLower].filter((v): v is number => v != null),
      )
    : [];
  const fibVals = showFib && data.fib
    ? [data.fib.level382, data.fib.level500, data.fib.level618]
    : [];
  const allValues = [...closes, ...overlayVals, ...bbVals, ...fibVals];
  const dataMin = Math.min(...allValues);
  const dataMax = Math.max(...allValues);
  const padding = (dataMax - dataMin) * 0.05;

  const syncId = 'pricechart';

  return (
    <section className="rounded-xl bg-[#0f172a] border border-[#1e293b] p-5">
      <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
        <h3 className="text-xs font-semibold text-slate-400 tracking-wider uppercase">
          주가 (최근 12개월)
        </h3>
        <div className="flex flex-wrap gap-3 text-[10px] items-center">
          <Legend color="#94a3b8" label="종가" />
          <Legend color="#3b82f6" label="EMA20" />
          <Legend color="#f59e0b" label="MA50" />
          <Legend color="#a855f7" label="MA200" />
          <span className="text-slate-700">|</span>
          <Toggle label="피보나치" active={showFib} onClick={() => setShowFib((v) => !v)} />
          <Toggle label="볼린저" active={showBB} onClick={() => setShowBB((v) => !v)} />
          <Toggle label="MACD" active={showMACD} onClick={() => setShowMACD((v) => !v)} />
        </div>
      </div>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data.rows}
            margin={{ top: 5, right: 8, bottom: 5, left: 8 }}
            syncId={syncId}
          >
            <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              stroke="#475569"
              tick={{ fontSize: 10 }}
              interval={Math.floor(data.rows.length / 6)}
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
            {showBB && (
              <Area
                type="monotone"
                dataKey="bbBandFill"
                stroke="none"
                fill="#22d3ee"
                fillOpacity={0.08}
                isAnimationActive={false}
                name="볼린저 밴드"
                connectNulls
              />
            )}
            {showBB && (
              <Line
                type="monotone"
                dataKey="bbUpper"
                stroke="#22d3ee"
                strokeWidth={1}
                strokeDasharray="2 3"
                dot={false}
                isAnimationActive={false}
                name="BB 상단"
                connectNulls
              />
            )}
            {showBB && (
              <Line
                type="monotone"
                dataKey="bbLower"
                stroke="#22d3ee"
                strokeWidth={1}
                strokeDasharray="2 3"
                dot={false}
                isAnimationActive={false}
                name="BB 하단"
                connectNulls
              />
            )}
            {showFib && data.fib && (
              <>
                <ReferenceLine
                  y={data.fib.level382}
                  stroke="#fb923c"
                  strokeDasharray="4 2"
                  strokeOpacity={0.7}
                  label={{ value: 'Fib 38.2%', position: 'right', fill: '#fb923c', fontSize: 9 }}
                />
                <ReferenceLine
                  y={data.fib.level500}
                  stroke="#fb923c"
                  strokeDasharray="4 2"
                  strokeOpacity={0.7}
                  label={{ value: 'Fib 50%', position: 'right', fill: '#fb923c', fontSize: 9 }}
                />
                <ReferenceLine
                  y={data.fib.level618}
                  stroke="#fb923c"
                  strokeDasharray="4 2"
                  strokeOpacity={0.7}
                  label={{ value: 'Fib 61.8%', position: 'right', fill: '#fb923c', fontSize: 9 }}
                />
              </>
            )}
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
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {showMACD && (
        <div className="h-24 mt-2">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={data.rows}
              margin={{ top: 5, right: 8, bottom: 5, left: 8 }}
              syncId={syncId}
            >
              <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
              <XAxis dataKey="date" hide />
              <YAxis stroke="#475569" tick={{ fontSize: 9 }} width={50} />
              <Tooltip
                contentStyle={{
                  background: '#0a0f1a',
                  border: '1px solid #1e293b',
                  borderRadius: 6,
                  fontSize: 11,
                }}
                labelStyle={{ color: '#cbd5e1' }}
              />
              <ReferenceLine y={0} stroke="#475569" strokeWidth={1} />
              <Bar dataKey="macdHist" fill="#64748b" isAnimationActive={false} name="히스토그램" />
              <Line
                type="monotone"
                dataKey="macd"
                stroke="#3b82f6"
                strokeWidth={1.2}
                dot={false}
                isAnimationActive={false}
                name="MACD"
                connectNulls
              />
              <Line
                type="monotone"
                dataKey="macdSignal"
                stroke="#f59e0b"
                strokeWidth={1.2}
                dot={false}
                isAnimationActive={false}
                name="시그널"
                connectNulls
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
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

function Toggle({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'px-1.5 py-0.5 rounded text-[10px] border transition-colors ' +
        (active
          ? 'border-indigo-500 bg-indigo-500/15 text-indigo-200'
          : 'border-[#1e293b] text-slate-500 hover:text-slate-300')
      }
    >
      {label}
    </button>
  );
}
