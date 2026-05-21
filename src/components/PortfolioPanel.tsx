import { useCallback, useEffect, useState } from 'react';
import {
  closePosition,
  loadClosed,
  loadPositions,
  removePosition,
  type ClosedPosition,
  type PortfolioPosition,
} from '../lib/portfolio.js';
import { fetchAnalysis } from '../lib/api.js';

type PriceMap = Record<string, number | null>;

export function PortfolioPanel() {
  const [positions, setPositions] = useState<PortfolioPosition[]>([]);
  const [closed, setClosed] = useState<ClosedPosition[]>([]);
  const [prices, setPrices] = useState<PriceMap>({});
  const [loading, setLoading] = useState(false);
  const [closeModal, setCloseModal] = useState<string | null>(null);
  const [closePrice, setClosePrice] = useState('');
  const [view, setView] = useState<'active' | 'history' | 'stats'>('active');

  const reload = useCallback(() => {
    setPositions(loadPositions());
    setClosed(loadClosed());
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const fetchPrices = useCallback(async () => {
    if (positions.length === 0) return;
    setLoading(true);
    const map: PriceMap = {};
    await Promise.all(
      positions.map(async (p) => {
        try {
          const r = await fetchAnalysis(p.ticker);
          map[p.ticker] = r.fundamental.price;
        } catch {
          map[p.ticker] = null;
        }
      }),
    );
    setPrices(map);
    setLoading(false);
  }, [positions]);

  useEffect(() => { void fetchPrices(); }, [fetchPrices]);

  function handleClose(id: string) {
    const price = parseFloat(closePrice);
    if (!Number.isFinite(price) || price <= 0) return;
    closePosition(id, price);
    setCloseModal(null);
    setClosePrice('');
    reload();
  }

  function handleDelete(id: string) {
    removePosition(id);
    reload();
  }

  const today = new Date();

  function holdingDays(entryDate: string): number {
    return Math.max(1, Math.round((today.getTime() - new Date(entryDate).getTime()) / 86_400_000));
  }

  // Portfolio-level stats
  const activeReturns = positions.map((p) => {
    const cur = prices[p.ticker];
    return cur != null ? (cur - p.entryPrice) / p.entryPrice : null;
  }).filter((r): r is number => r != null);

  const avgActiveReturn = activeReturns.length > 0
    ? activeReturns.reduce((a, b) => a + b, 0) / activeReturns.length
    : null;

  return (
    <div className="space-y-4">
      {/* Sub-tabs */}
      <div className="flex gap-1 border-b border-[#1e293b]">
        <SubTab active={view === 'active'} onClick={() => setView('active')}>
          보유 ({positions.length})
        </SubTab>
        <SubTab active={view === 'history'} onClick={() => setView('history')}>
          청산 기록 ({closed.length})
        </SubTab>
        <SubTab active={view === 'stats'} onClick={() => setView('stats')}>
          성과 분석
        </SubTab>
      </div>

      {view === 'active' && (
        <>
          {positions.length === 0 ? (
            <div className="text-center py-16 text-slate-500">
              <p className="text-3xl mb-3">💼</p>
              <p className="text-sm">포트폴리오가 비어 있습니다.</p>
              <p className="text-xs mt-1">개별 분석에서 "💼 포트폴리오 추가" 버튼을 눌러주세요.</p>
            </div>
          ) : (
            <>
              {avgActiveReturn != null && (
                <div className="flex items-center gap-4 px-4 py-3 rounded-xl bg-[#0f172a] border border-[#1e293b]">
                  <span className="text-xs text-slate-400">전체 수익률</span>
                  <span className={`text-lg font-bold tabular-nums ${avgActiveReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {avgActiveReturn >= 0 ? '+' : ''}{(avgActiveReturn * 100).toFixed(2)}%
                  </span>
                  {loading && <span className="text-[10px] text-slate-600 ml-auto">업데이트 중...</span>}
                </div>
              )}

              <div className="space-y-3">
                {positions.map((p) => {
                  const cur = prices[p.ticker];
                  const ret = cur != null ? (cur - p.entryPrice) / p.entryPrice : null;
                  const pnl = cur != null ? cur - p.entryPrice : null;
                  const days = holdingDays(p.entryDate);
                  const hitStop = p.stopPrice != null && cur != null && cur <= p.stopPrice;
                  const hitTarget = p.targetPrice != null && cur != null && cur >= p.targetPrice;

                  return (
                    <div
                      key={p.id}
                      className={`rounded-xl border p-4 ${
                        hitStop
                          ? 'bg-red-950/30 border-red-800'
                          : hitTarget
                            ? 'bg-emerald-950/30 border-emerald-800'
                            : 'bg-[#0f172a] border-[#1e293b]'
                      }`}
                    >
                      {hitStop && (
                        <div className="mb-2 px-2 py-1 rounded bg-red-900/60 text-red-200 text-xs font-bold inline-block">
                          🔴 손절가 도달 — 손절 필요!
                        </div>
                      )}
                      {hitTarget && (
                        <div className="mb-2 px-2 py-1 rounded bg-emerald-900/60 text-emerald-200 text-xs font-bold inline-block">
                          🟢 목표가 도달 — 익절 검토!
                        </div>
                      )}

                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-baseline gap-2">
                            <span className="font-bold text-slate-100">{p.ticker}</span>
                            <span className="text-xs text-slate-400">{p.name}</span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                              p.strategyTag === 'A'
                                ? 'bg-amber-900/40 text-amber-300'
                                : 'bg-blue-900/40 text-blue-300'
                            }`}>
                              {p.strategyTag === 'A' ? 'A 이른진입' : 'B 확인진입'}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                            <span>진입 {p.entryPrice.toLocaleString()}</span>
                            {p.stopPrice != null && <span>손절 {p.stopPrice.toLocaleString()}</span>}
                            {p.targetPrice != null && <span>목표 {p.targetPrice.toLocaleString()}</span>}
                            <span>{days}일째</span>
                          </div>
                          <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-600">
                            <span>진입시 펀더{p.scores.fundamental}/타이밍{p.scores.timing}/종합{p.scores.overall}</span>
                          </div>
                          {p.memo && (
                            <p className="mt-1 text-[11px] text-slate-500 italic">{p.memo}</p>
                          )}
                        </div>

                        <div className="text-right flex-shrink-0">
                          {cur != null ? (
                            <>
                              <p className="text-lg font-bold tabular-nums text-slate-100">
                                {cur.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                              </p>
                              <p className={`text-sm font-bold tabular-nums ${ret! >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {ret! >= 0 ? '+' : ''}{(ret! * 100).toFixed(2)}%
                              </p>
                              {pnl != null && (
                                <p className={`text-[10px] tabular-nums ${pnl >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                                  {pnl >= 0 ? '+' : ''}{pnl.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                                </p>
                              )}
                            </>
                          ) : (
                            <p className="text-sm text-slate-600">{loading ? '...' : '—'}</p>
                          )}
                        </div>
                      </div>

                      <div className="flex gap-2 mt-3">
                        <button
                          type="button"
                          onClick={() => {
                            setCloseModal(p.id);
                            setClosePrice(cur?.toString() ?? '');
                          }}
                          className="min-h-[32px] px-3 py-1 rounded-lg text-xs font-medium bg-slate-800 border border-[#1e293b] text-slate-300 hover:bg-slate-700 transition-colors"
                        >
                          청산
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(p.id)}
                          className="min-h-[32px] px-3 py-1 rounded-lg text-xs text-slate-600 hover:text-red-400 transition-colors"
                        >
                          삭제
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}

      {view === 'history' && (
        <>
          {closed.length === 0 ? (
            <div className="text-center py-16 text-slate-500">
              <p className="text-sm">청산 기록이 없습니다.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {[...closed].reverse().map((c, i) => (
                <div key={i} className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-[#0f172a] border border-[#1e293b]">
                  <div>
                    <div className="flex items-baseline gap-2">
                      <span className="font-bold text-sm text-slate-100">{c.ticker}</span>
                      <span className="text-xs text-slate-400">{c.name}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                        c.strategyTag === 'A' ? 'bg-amber-900/40 text-amber-300' : 'bg-blue-900/40 text-blue-300'
                      }`}>{c.strategyTag}</span>
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      {c.entryDate} → {c.closeDate} · {c.holdingDays}일 · {c.entryPrice.toLocaleString()} → {c.closePrice.toLocaleString()}
                    </div>
                  </div>
                  <span className={`text-sm font-bold tabular-nums ${c.returnPct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {c.returnPct >= 0 ? '+' : ''}{(c.returnPct * 100).toFixed(2)}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {view === 'stats' && <PerformanceStats closed={closed} />}

      {/* Close position modal */}
      {closeModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
          onClick={(e) => { if (e.target === e.currentTarget) setCloseModal(null); }}
        >
          <div className="w-full max-w-sm rounded-2xl bg-[#0f172a] border border-[#1e293b] p-6 shadow-2xl">
            <h3 className="text-base font-bold text-slate-100 mb-4">청산 기록</h3>
            <label className="block text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1">
              청산가
            </label>
            <input
              type="number"
              step="any"
              value={closePrice}
              onChange={(e) => setClosePrice(e.target.value)}
              className="w-full min-h-[40px] px-3 py-2 rounded-lg border border-[#1e293b] bg-[#0a0f1a] text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              autoFocus
            />
            <div className="flex gap-2 mt-4">
              <button
                type="button"
                onClick={() => handleClose(closeModal)}
                className="flex-1 min-h-[40px] rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm transition-colors"
              >
                청산 확정
              </button>
              <button
                type="button"
                onClick={() => setCloseModal(null)}
                className="min-h-[40px] px-4 rounded-lg border border-[#1e293b] text-slate-400 text-sm transition-colors"
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PerformanceStats({ closed }: { closed: ClosedPosition[] }) {
  if (closed.length === 0) {
    return (
      <div className="text-center py-16 text-slate-500">
        <p className="text-sm">청산 기록이 없어 성과를 분석할 수 없습니다.</p>
      </div>
    );
  }

  const wins = closed.filter((c) => c.returnPct > 0);
  const losses = closed.filter((c) => c.returnPct <= 0);
  const winRate = wins.length / closed.length;
  const avgWin = wins.length > 0 ? wins.reduce((a, c) => a + c.returnPct, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((a, c) => a + c.returnPct, 0) / losses.length : 0;
  const avgReturn = closed.reduce((a, c) => a + c.returnPct, 0) / closed.length;
  const best = closed.reduce((a, c) => (c.returnPct > a.returnPct ? c : a), closed[0]);
  const worst = closed.reduce((a, c) => (c.returnPct < a.returnPct ? c : a), closed[0]);
  const avgDays = Math.round(closed.reduce((a, c) => a + c.holdingDays, 0) / closed.length);

  const tagA = closed.filter((c) => c.strategyTag === 'A');
  const tagB = closed.filter((c) => c.strategyTag === 'B');
  const tagAWinRate = tagA.length > 0 ? tagA.filter((c) => c.returnPct > 0).length / tagA.length : null;
  const tagBWinRate = tagB.length > 0 ? tagB.filter((c) => c.returnPct > 0).length / tagB.length : null;
  const tagAAvg = tagA.length > 0 ? tagA.reduce((a, c) => a + c.returnPct, 0) / tagA.length : null;
  const tagBAvg = tagB.length > 0 ? tagB.reduce((a, c) => a + c.returnPct, 0) / tagB.length : null;

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatBox label="전체 승률" value={`${(winRate * 100).toFixed(0)}%`} sub={`${wins.length}승 ${losses.length}패`} />
        <StatBox label="평균 수익" value={`${avgReturn >= 0 ? '+' : ''}${(avgReturn * 100).toFixed(1)}%`} sub={`${avgDays}일 평균 보유`} positive={avgReturn >= 0} />
        <StatBox label="평균 익절" value={`+${(avgWin * 100).toFixed(1)}%`} sub={`${wins.length}건`} positive />
        <StatBox label="평균 손절" value={`${(avgLoss * 100).toFixed(1)}%`} sub={`${losses.length}건`} positive={false} />
      </div>

      {/* Best / Worst */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-emerald-900 bg-emerald-950/20 p-4">
          <p className="text-[10px] uppercase tracking-wider font-bold text-emerald-500 mb-1">최대 수익</p>
          <p className="text-lg font-bold text-emerald-400 tabular-nums">
            +{(best.returnPct * 100).toFixed(1)}%
          </p>
          <p className="text-xs text-slate-400">{best.ticker} · {best.holdingDays}일</p>
        </div>
        <div className="rounded-xl border border-red-900 bg-red-950/20 p-4">
          <p className="text-[10px] uppercase tracking-wider font-bold text-red-500 mb-1">최대 손실</p>
          <p className="text-lg font-bold text-red-400 tabular-nums">
            {(worst.returnPct * 100).toFixed(1)}%
          </p>
          <p className="text-xs text-slate-400">{worst.ticker} · {worst.holdingDays}일</p>
        </div>
      </div>

      {/* Strategy comparison */}
      {(tagA.length > 0 || tagB.length > 0) && (
        <div className="rounded-xl border border-[#1e293b] bg-[#0f172a] p-4">
          <h4 className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-3">
            전략 비교
          </h4>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-amber-300 font-bold mb-1">A 이른진입 ({tagA.length}건)</p>
              {tagAWinRate != null ? (
                <>
                  <p className="text-xs text-slate-400">승률 {(tagAWinRate * 100).toFixed(0)}%</p>
                  <p className="text-xs text-slate-400">평균 {tagAAvg! >= 0 ? '+' : ''}{(tagAAvg! * 100).toFixed(1)}%</p>
                </>
              ) : (
                <p className="text-xs text-slate-600">기록 없음</p>
              )}
            </div>
            <div>
              <p className="text-blue-300 font-bold mb-1">B 확인진입 ({tagB.length}건)</p>
              {tagBWinRate != null ? (
                <>
                  <p className="text-xs text-slate-400">승률 {(tagBWinRate * 100).toFixed(0)}%</p>
                  <p className="text-xs text-slate-400">평균 {tagBAvg! >= 0 ? '+' : ''}{(tagBAvg! * 100).toFixed(1)}%</p>
                </>
              ) : (
                <p className="text-xs text-slate-600">기록 없음</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SubTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'px-3 py-2 -mb-px text-xs font-medium border-b-2 transition-colors ' +
        (active
          ? 'border-indigo-500 text-indigo-300'
          : 'border-transparent text-slate-400 hover:text-slate-200')
      }
    >
      {children}
    </button>
  );
}

function StatBox({
  label,
  value,
  sub,
  positive,
}: {
  label: string;
  value: string;
  sub: string;
  positive?: boolean;
}) {
  const color = positive === true ? 'text-emerald-400' : positive === false ? 'text-red-400' : 'text-slate-100';
  return (
    <div className="rounded-xl border border-[#1e293b] bg-[#0f172a] p-3">
      <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${color}`}>{value}</p>
      <p className="text-[10px] text-slate-500">{sub}</p>
    </div>
  );
}
