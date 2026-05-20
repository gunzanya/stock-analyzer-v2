import type { FundamentalData, StockType } from '../lib/types.js';

interface Props {
  type: StockType;
  fund: FundamentalData;
}

const SUPPORTED: StockType[] = [
  'SLOW_GROWER',
  'CYCLICAL',
  'ASSET_PLAY',
  'TURNAROUND',
];

export function TypeAuxCard({ type, fund }: Props) {
  if (!SUPPORTED.includes(type)) return null;

  return (
    <section className="rounded-xl bg-[#0f172a] border border-[#1e293b] p-5">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-base">📊</span>
        <h3 className="text-sm font-semibold text-slate-200">
          유형별 보조 지표
        </h3>
      </div>
      {type === 'SLOW_GROWER' && <SlowGrowerBody fund={fund} />}
      {type === 'CYCLICAL' && <CyclicalBody fund={fund} />}
      {type === 'ASSET_PLAY' && <AssetPlayBody fund={fund} />}
      {type === 'TURNAROUND' && <TurnaroundBody fund={fund} />}
    </section>
  );
}

// ---- SLOW_GROWER ----

function SlowGrowerBody({ fund }: { fund: FundamentalData }) {
  const yieldPct = fund.dividendYield != null ? fund.dividendYield * 100 : null;
  const computedPayout =
    fund.trailingAnnualDividendRate != null &&
    fund.trailingEps != null &&
    fund.trailingEps > 0
      ? fund.trailingAnnualDividendRate / fund.trailingEps
      : null;
  const payout = computedPayout ?? fund.payoutRatio;

  let payoutTone = 'text-slate-300 bg-[#0a0f1a] border-slate-700';
  let payoutLabel = '데이터 부족';
  let payoutComment = '배당성향 데이터가 없어 안정성을 판단하기 어렵습니다.';
  if (payout != null) {
    const pct = payout * 100;
    if (pct <= 80) {
      payoutTone = 'text-emerald-300 bg-emerald-950/40 border-emerald-800';
      payoutLabel = '안전';
      payoutComment =
        '이익 대비 배당 여력이 충분 — 배당 컷 위험 낮음.';
    } else if (pct <= 100) {
      payoutTone = 'text-amber-300 bg-amber-950/40 border-amber-800';
      payoutLabel = '주의';
      payoutComment =
        '배당이 이익 대부분을 소진. 이익 감소 시 배당 컷 가능성 모니터링.';
    } else {
      payoutTone = 'text-red-300 bg-red-950/40 border-red-800';
      payoutLabel = '위험';
      payoutComment =
        '배당이 이익을 초과 — 부채/자본 잠식 또는 곧 컷될 가능성 높음.';
    }
  }

  return (
    <div className="space-y-3 text-xs">
      <div className="grid grid-cols-2 gap-3">
        <Stat
          label="배당수익률"
          value={yieldPct != null ? `${yieldPct.toFixed(2)}%` : '—'}
          highlight
        />
        <Stat
          label="배당성향 (배당/EPS)"
          value={payout != null ? `${(payout * 100).toFixed(0)}%` : '—'}
          tone={payoutTone}
          badge={payoutLabel}
        />
      </div>
      <p className="text-[11px] text-slate-400 leading-relaxed">
        <span className="text-slate-500 mr-1">배당 안정성:</span>
        {payoutComment}
      </p>
    </div>
  );
}

// ---- CYCLICAL ----

function CyclicalBody({ fund }: { fund: FundamentalData }) {
  const per = fund.per;
  const fwd = fund.forwardPER;
  let direction: { label: string; tone: string; comment: string } | null = null;
  if (per != null && fwd != null && per > 0 && fwd > 0) {
    if (per < fwd) {
      direction = {
        label: '이익 감소 예상',
        tone: 'text-red-300 bg-red-950/40 border-red-800',
        comment:
          '현재 PER이 Forward PER보다 낮음 — 시장은 향후 EPS가 줄어들 것으로 예상 (사이클 하강 가능성).',
      };
    } else if (per > fwd) {
      direction = {
        label: '이익 증가 예상',
        tone: 'text-emerald-300 bg-emerald-950/40 border-emerald-800',
        comment:
          '현재 PER이 Forward PER보다 높음 — 시장은 향후 EPS 증가를 예상 (사이클 상승 가능성).',
      };
    } else {
      direction = {
        label: '비슷한 수준',
        tone: 'text-slate-300 bg-[#0a0f1a] border-slate-700',
        comment: '현재 PER ≈ Forward PER. 사이클 방향성 신호 약함.',
      };
    }
  }
  return (
    <div className="space-y-3 text-xs">
      <div className="grid grid-cols-2 gap-3">
        <Stat label="현재 PER" value={per != null ? per.toFixed(1) : '—'} highlight />
        <Stat label="Forward PER" value={fwd != null ? fwd.toFixed(1) : '—'} />
      </div>
      {direction ? (
        <div
          className={`rounded-lg border px-3 py-2 ${direction.tone}`}
        >
          <p className="font-semibold mb-0.5">{direction.label}</p>
          <p className="text-[11px] leading-relaxed opacity-90">
            {direction.comment}
          </p>
        </div>
      ) : (
        <p className="text-[11px] text-slate-500 leading-relaxed">
          PER 또는 Forward PER 데이터 부족 — 사이클 방향 판단 불가.
        </p>
      )}
      <p className="text-[11px] text-amber-300/90 leading-relaxed border-l-2 border-amber-700 pl-3">
        ⚠️ 순환주는 저PER = 이익 피크일 수 있음. 정점에서 PER이 가장 낮아 보이고,
        바닥에서 PER이 높아 보이는 역설을 기억하세요.
      </p>
    </div>
  );
}

// ---- ASSET_PLAY ----

function AssetPlayBody({ fund }: { fund: FundamentalData }) {
  const pbr = fund.pbr;
  let pbrTone = 'text-slate-300 bg-[#0a0f1a] border-slate-700';
  let pbrComment = 'PBR 데이터 없음.';
  if (pbr != null) {
    if (pbr < 1.0) {
      pbrTone = 'text-emerald-300 bg-emerald-950/40 border-emerald-800';
      pbrComment =
        '자산 대비 저평가 — 시장이 보유 자산(부동산·현금·자회사) 가치를 충분히 반영하지 않을 가능성.';
    } else if (pbr < 1.5) {
      pbrTone = 'text-slate-300 bg-[#0a0f1a] border-slate-700';
      pbrComment =
        '자산 가치 부근 — 자산주 논리가 약함. 다른 유형 후보를 확인하세요.';
    } else {
      pbrTone = 'text-amber-300 bg-amber-950/40 border-amber-800';
      pbrComment =
        'PBR 1.5 이상 — 자산주로 보기 어렵습니다. 분류를 재검토하세요.';
    }
  }
  return (
    <div className="space-y-3 text-xs">
      <div
        className={`rounded-lg border px-3 py-2 ${pbrTone}`}
      >
        <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">
          PBR
        </p>
        <p className="text-2xl font-bold tabular-nums mb-1">
          {pbr != null ? pbr.toFixed(2) : '—'}
        </p>
        <p className="text-[11px] leading-relaxed opacity-90">{pbrComment}</p>
      </div>
      <div className="rounded-lg border border-slate-700 bg-[#0a0f1a] px-3 py-2 text-[11px] text-slate-400 leading-relaxed">
        <p className="text-slate-300 font-medium mb-1">
          💡 NAV 할인율은 API로 계산 불가
        </p>
        <p>
          자회사 시가총액 합산 vs 지주사 시총을 수동 비교하세요. 주요 자회사
          목록·지분율은 사업보고서 또는 Yahoo의 holdings 페이지에서 직접 확인.
        </p>
      </div>
    </div>
  );
}

// ---- TURNAROUND ----

function TurnaroundBody({ fund }: { fund: FundamentalData }) {
  const latestQ = fund.quarterly[0];
  const latestEps = latestQ?.eps ?? null;
  const profitable = latestEps != null && latestEps > 0;

  let trend: { label: string; tone: string; detail: string } | null = null;
  const hist = fund.debtToEquityHistory;
  if (hist.length >= 2) {
    const newest = hist[0].ratio;
    const oldest = hist[hist.length - 1].ratio;
    const diff = newest - oldest;
    const pct = oldest > 0 ? (diff / oldest) * 100 : 0;
    if (Math.abs(pct) < 5) {
      trend = {
        label: '안정',
        tone: 'text-slate-300 bg-[#0a0f1a] border-slate-700',
        detail: `${(oldest * 100).toFixed(0)}% → ${(newest * 100).toFixed(0)}%`,
      };
    } else if (diff < 0) {
      trend = {
        label: '감소 중',
        tone: 'text-emerald-300 bg-emerald-950/40 border-emerald-800',
        detail: `${(oldest * 100).toFixed(0)}% → ${(newest * 100).toFixed(0)}% (${pct.toFixed(0)}%)`,
      };
    } else {
      trend = {
        label: '증가 중',
        tone: 'text-red-300 bg-red-950/40 border-red-800',
        detail: `${(oldest * 100).toFixed(0)}% → ${(newest * 100).toFixed(0)}% (+${pct.toFixed(0)}%)`,
      };
    }
  }

  return (
    <div className="space-y-3 text-xs">
      <div className="grid grid-cols-2 gap-3">
        <div
          className={`rounded-lg border px-3 py-2 ${
            profitable
              ? 'text-emerald-300 bg-emerald-950/40 border-emerald-800'
              : 'text-red-300 bg-red-950/40 border-red-800'
          }`}
        >
          <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">
            흑자 전환 상태
          </p>
          <p className="font-semibold">
            {latestEps == null
              ? '데이터 없음'
              : profitable
                ? `✅ 흑자 (분기 EPS ${latestEps.toFixed(2)})`
                : `❌ 적자 (분기 EPS ${latestEps.toFixed(2)})`}
          </p>
          <p className="text-[10px] text-slate-500 mt-0.5">
            {latestQ?.date ? `기준 ${latestQ.date}` : ''}
          </p>
        </div>
        {trend ? (
          <div className={`rounded-lg border px-3 py-2 ${trend.tone}`}>
            <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">
              부채비율 추이
            </p>
            <p className="font-semibold">{trend.label}</p>
            <p className="text-[10px] text-slate-500 mt-0.5">{trend.detail}</p>
          </div>
        ) : (
          <div className="rounded-lg border border-slate-700 bg-[#0a0f1a] px-3 py-2">
            <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">
              부채비율 추이
            </p>
            <p className="text-slate-400">데이터 부족</p>
            <p className="text-[10px] text-slate-500 mt-0.5">
              {fund.debtToEquity != null
                ? `현재 D/E ${(fund.debtToEquity > 5 ? fund.debtToEquity / 100 : fund.debtToEquity).toFixed(2)}`
                : '—'}
            </p>
          </div>
        )}
      </div>
      <p className="text-[11px] text-slate-400 leading-relaxed border-l-2 border-indigo-700 pl-3">
        🔮 회복 지속 시 예상 유형: <span className="text-indigo-300 font-medium">고성장</span>{' '}
        (매출·이익 동반 성장 시) 또는{' '}
        <span className="text-indigo-300 font-medium">대형우량</span> (현금흐름 안정화 시).
      </p>
    </div>
  );
}

// ---- shared atoms ----

function Stat({
  label,
  value,
  highlight = false,
  tone,
  badge,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  tone?: string;
  badge?: string;
}) {
  const className =
    tone ??
    (highlight
      ? 'text-indigo-300 bg-indigo-950/30 border-indigo-800'
      : 'text-slate-200 bg-[#0a0f1a] border-slate-700');
  return (
    <div className={`rounded-lg border px-3 py-2 ${className}`}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[10px] uppercase tracking-wider text-slate-500">
          {label}
        </p>
        {badge && (
          <span className="text-[10px] font-semibold opacity-90">{badge}</span>
        )}
      </div>
      <p className="text-lg font-bold tabular-nums mt-0.5">{value}</p>
    </div>
  );
}
