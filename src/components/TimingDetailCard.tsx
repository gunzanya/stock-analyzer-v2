import type { TimingDetail } from '../lib/types.js';

interface Props {
  detail: TimingDetail;
}

const SIGNAL_BADGE: Record<string, { label: string; color: string }> = {
  bearish: { label: '약세', color: 'text-red-300 bg-red-900/30' },
  bullish: { label: '강세', color: 'text-green-300 bg-green-900/30' },
  none: { label: '중립', color: 'text-slate-400 bg-slate-700/30' },
  strong_up: { label: '강한 상승', color: 'text-green-300 bg-green-900/30' },
  up: { label: '상승', color: 'text-green-300 bg-green-900/30' },
  flat: { label: '평평', color: 'text-yellow-300 bg-yellow-900/30' },
  down: { label: '하락', color: 'text-red-300 bg-red-900/30' },
  strong_down: { label: '급락', color: 'text-red-300 bg-red-900/30' },
  accumulation: { label: '매집', color: 'text-green-300 bg-green-900/30' },
  distribution: { label: '분배', color: 'text-red-300 bg-red-900/30' },
  neutral: { label: '중립', color: 'text-slate-400 bg-slate-700/30' },
  expanding: { label: '확대', color: 'text-yellow-300 bg-yellow-900/30' },
  contracting: { label: '압축', color: 'text-cyan-300 bg-cyan-900/30' },
  stable: { label: '안정', color: 'text-slate-400 bg-slate-700/30' },
};

function Badge({ signal }: { signal: string }) {
  const cfg = SIGNAL_BADGE[signal] ?? { label: signal, color: 'text-slate-400 bg-slate-700/30' };
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${cfg.color}`}>
      {cfg.label}
    </span>
  );
}

export function TimingDetailCard({ detail }: Props) {
  return (
    <div className="rounded-xl border border-[#1e293b] bg-[#0f172a] p-4">
      <h3 className="text-xs font-bold text-slate-300 mb-3 uppercase tracking-wider">
        타이밍 정밀 분석
      </h3>
      <div className="space-y-2.5 text-[11px]">
        {/* RSI Divergence */}
        <Row
          icon="📊"
          title="RSI 다이버전스"
          signal={detail.rsiDivergence.signal}
          desc={detail.rsiDivergence.description}
        />

        {/* EMA20 Slope */}
        {detail.ema20Slope && (
          <Row
            icon="📐"
            title="EMA20 기울기"
            signal={detail.ema20Slope.signal}
            desc={detail.ema20Slope.description}
          />
        )}

        {/* Volume Pattern */}
        {detail.volumePattern && (
          <Row
            icon="📦"
            title="거래량 패턴"
            signal={detail.volumePattern.signal}
            desc={detail.volumePattern.description}
          />
        )}

        {/* ATR Trend */}
        {detail.atrTrend && (
          <Row
            icon="🌊"
            title="ATR 추이"
            signal={detail.atrTrend.signal}
            desc={detail.atrTrend.description}
          />
        )}

        {/* Support/Resistance */}
        <div className="flex items-start gap-2">
          <span className="text-sm leading-none mt-0.5">🧱</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-slate-200 font-medium">지지/저항 클러스터</span>
            </div>
            {detail.supportResistance.clusters.length > 0 ? (
              <div className="mt-1 space-y-1">
                {detail.supportResistance.clusters.map((c, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-slate-400">
                    <span
                      className={
                        c.type === 'support'
                          ? 'text-green-400'
                          : 'text-red-400'
                      }
                    >
                      {c.type === 'support' ? '▼' : '▲'}
                    </span>
                    <span className="font-mono">{c.price.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                    <span className="text-slate-500">({c.sources.join(' + ')})</span>
                    <span className="text-slate-500">{c.distancePct.toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-slate-500 mt-0.5">근접 클러스터 없음</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({
  icon,
  title,
  signal,
  desc,
}: {
  icon: string;
  title: string;
  signal: string;
  desc: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-sm leading-none mt-0.5">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-slate-200 font-medium">{title}</span>
          <Badge signal={signal} />
        </div>
        <p className="text-slate-500 mt-0.5 leading-relaxed">{desc}</p>
      </div>
    </div>
  );
}
