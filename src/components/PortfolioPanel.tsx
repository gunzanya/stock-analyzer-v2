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

function fmtN(v: number, digits = 2): string {
  return v.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export function PortfolioPanel() {
  const [positions, setPositions] = useState<PortfolioPosition[]>([]);
  const [closed, setClosed] = useState<ClosedPosition[]>([]);
  const [prices, setPrices] = useState<PriceMap>({});
  const [loading, setLoading] = useState(false);
  const [closeModal, setCloseModal] = useState<{ id: string; pct: number } | null>(null);
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

  function handleClose() {
    if (!closeModal) return;
    const price = parseFloat(closePrice);
    if (!Number.isFinite(price) || price <= 0) return;
    closePosition(closeModal.id, price, closeModal.pct);
    setCloseModal(null);
    setClosePrice('');
    reload();
  }

  function openCloseModal(id: string, pct: number) {
    const cur = prices[positions.find((p) => p.id === id)?.ticker ?? ''];
    setCloseModal({ id, pct });
    setClosePrice(cur?.toString() ?? '');
  }

  const today = new Date();
  function holdingDays(entryDate: string): number {
    return Math.max(1, Math.round((today.getTime() - new Date(entryDate).getTime()) / 86_400_000));
  }

  // Portfolio totals
  let totalInvested = 0;
  let totalValue = 0;
  let totalDays = 0;
  for (const p of positions) {
    const cur = prices[p.ticker];
    totalInvested += p.entryPrice * p.quantity;
    totalValue += (cur ?? p.entryPrice) * p.quantity;
    totalDays += holdingDays(p.entryDate);
  }
  const totalReturn = totalInvested > 0 ? (totalValue - totalInvested) / totalInvested : 0;
  const avgDays = positions.length > 0 ? Math.round(totalDays / positions.length) : 0;

  return (
    <div className="space-y-4">
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
              <p className="text-xs mt-1">개별 분석에서 💼 버튼을 눌러주세요.</p>
            </div>
          ) : (
            <>
              {/* Summary header */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <SummaryBox label="총 투자금" value={fmtN(totalInvested, 0)} />
                <SummaryBox
                  label="총 평가금"
                  value={fmtN(totalValue, 0)}
                  sub={`${totalReturn >= 0 ? '+' : ''}${(totalReturn * 100).toFixed(2)}%`}
                  positive={totalReturn >= 0}
                />
                <SummaryBox
                  label="총 손익"
                  value={`${totalValue - totalInvested >= 0 ? '+' : ''}${fmtN(totalValue - totalInvested, 0)}`}
                  positive={totalValue - totalInvested >= 0}
                />
                <SummaryBox label="보유 종목" value={`${positions.length}개`} sub={`평균 ${avgDays}일`} />
              </div>

              {loading && (
                <p className="text-[10px] text-slate-600 text-center">현재가 업데이트 중...</p>
              )}

              <div className="space-y-3">
                {positions.map((p) => (
                  <PositionCard
                    key={p.id}
                    pos={p}
                    currentPrice={prices[p.ticker] ?? null}
                    days={holdingDays(p.entryDate)}
                    onPartialClose={(pct) => openCloseModal(p.id, pct)}
                    onDelete={() => { removePosition(p.id); reload(); }}
                  />
                ))}
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
                      {c.closedQuantity}주 · {c.entryDate} → {c.closeDate} · {c.holdingDays}일 · {fmtN(c.entryPrice)} → {fmtN(c.closePrice)}
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

      {/* Close modal */}
      {closeModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
          onClick={(e) => { if (e.target === e.currentTarget) setCloseModal(null); }}
        >
          <div className="w-full max-w-sm rounded-2xl bg-[#0f172a] border border-[#1e293b] p-6 shadow-2xl">
            <h3 className="text-base font-bold text-slate-100 mb-1">
              {closeModal.pct < 1 ? `${Math.round(closeModal.pct * 100)}% 부분 청산` : '전량 청산'}
            </h3>
            {(() => {
              const pos = positions.find((p) => p.id === closeModal.id);
              if (pos) {
                const qty = Math.round(pos.quantity * closeModal.pct);
                return <p className="text-xs text-slate-400 mb-3">{pos.ticker} · {qty}주 / {pos.quantity}주</p>;
              }
              return null;
            })()}
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
                onClick={handleClose}
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

/* ── Position Card ── */

function PositionCard({
  pos,
  currentPrice,
  days,
  onPartialClose,
  onDelete,
}: {
  pos: PortfolioPosition;
  currentPrice: number | null;
  days: number;
  onPartialClose: (pct: number) => void;
  onDelete: () => void;
}) {
  const cur = currentPrice;
  const ret = cur != null ? (cur - pos.entryPrice) / pos.entryPrice : null;
  const invested = pos.entryPrice * pos.quantity;
  const valued = cur != null ? cur * pos.quantity : null;
  const pnl = valued != null ? valued - invested : null;
  const hitStop = pos.stopPrice != null && cur != null && cur <= pos.stopPrice;
  const hitTarget = pos.targetPrice != null && cur != null && cur >= pos.targetPrice;

  return (
    <div className={`rounded-xl border p-4 space-y-3 ${
      hitStop ? 'bg-red-950/30 border-red-800'
        : hitTarget ? 'bg-emerald-950/30 border-emerald-800'
        : 'bg-[#0f172a] border-[#1e293b]'
    }`}>
      {/* Row 1: header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="font-bold text-slate-100">{pos.ticker}</span>
          <span className="text-xs text-slate-400 truncate">{pos.name}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold flex-shrink-0 ${
            pos.strategyTag === 'A' ? 'bg-amber-900/40 text-amber-300' : 'bg-blue-900/40 text-blue-300'
          }`}>
            {pos.strategyTag === 'A' ? 'A 이른진입' : 'B 확인진입'}
          </span>
        </div>
        {hitStop && (
          <span className="px-2 py-0.5 rounded bg-red-900/60 text-red-200 text-[10px] font-bold flex-shrink-0">
            🔴 손절 필요!
          </span>
        )}
        {hitTarget && (
          <span className="px-2 py-0.5 rounded bg-emerald-900/60 text-emerald-200 text-[10px] font-bold flex-shrink-0">
            🟢 익절 검토!
          </span>
        )}
      </div>

      {/* Row 2: quantity & investment */}
      <div className="text-xs text-slate-400">
        {pos.quantity}주 × {fmtN(pos.entryPrice)} = <span className="text-slate-200 font-medium">{fmtN(invested, 0)}</span>
      </div>

      {/* Row 3: current price & return */}
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="text-xs text-slate-500">현재가</span>
          <span className="text-lg font-bold tabular-nums text-slate-100">
            {cur != null ? fmtN(cur) : '—'}
          </span>
          {ret != null && (
            <span className={`text-sm font-bold tabular-nums ${ret >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              ({ret >= 0 ? '+' : ''}{(ret * 100).toFixed(2)}%)
            </span>
          )}
        </div>
        {pnl != null && (
          <span className={`text-sm font-bold tabular-nums ${pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {pnl >= 0 ? '+' : ''}{fmtN(pnl, 0)}
          </span>
        )}
      </div>

      {/* Row 4: progress bar stop → current → target */}
      {pos.stopPrice != null && pos.targetPrice != null && cur != null && (
        <PriceProgress stop={pos.stopPrice} entry={pos.entryPrice} target={pos.targetPrice} current={cur} />
      )}

      {/* Row 5: scores & days */}
      <div className="flex items-center justify-between text-[10px] text-slate-600">
        <span>진입시 펀더{pos.scores.fundamental}/타이밍{pos.scores.timing}/종합{pos.scores.overall}</span>
        <span>{days}일째</span>
      </div>

      {pos.memo && (
        <p className="text-[11px] text-slate-500 italic">{pos.memo}</p>
      )}

      {/* Row 6: action buttons */}
      <div className="flex gap-2 flex-wrap">
        {[0.25, 0.5, 0.75].map((pct) => (
          <button
            key={pct}
            type="button"
            onClick={() => onPartialClose(pct)}
            className="min-h-[32px] px-3 py-1 rounded-lg text-xs font-medium bg-slate-800 border border-[#1e293b] text-slate-300 hover:bg-slate-700 transition-colors"
          >
            {Math.round(pct * 100)}% 청산
          </button>
        ))}
        <button
          type="button"
          onClick={() => onPartialClose(1)}
          className="min-h-[32px] px-3 py-1 rounded-lg text-xs font-medium bg-slate-800 border border-[#1e293b] text-slate-300 hover:bg-slate-700 transition-colors"
        >
          전량 청산
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="min-h-[32px] px-3 py-1 rounded-lg text-xs text-slate-600 hover:text-red-400 transition-colors ml-auto"
        >
          삭제
        </button>
      </div>
    </div>
  );
}

/* ── Stop → Target progress bar ── */

function PriceProgress({
  stop,
  entry,
  target,
  current,
}: {
  stop: number;
  entry: number;
  target: number;
  current: number;
}) {
  const range = target - stop;
  if (range <= 0) return null;
  const pct = Math.max(0, Math.min(1, (current - stop) / range));
  const entryPct = Math.max(0, Math.min(1, (entry - stop) / range));

  const barColor =
    pct < 0.2 ? 'bg-red-500'
      : pct > 0.8 ? 'bg-emerald-500'
      : 'bg-indigo-500';

  return (
    <div className="space-y-1">
      <div className="relative h-2 rounded-full bg-[#1e293b] overflow-hidden">
        <div className={`absolute inset-y-0 left-0 rounded-full ${barColor} transition-all`} style={{ width: `${pct * 100}%` }} />
        {/* Entry marker */}
        <div
          className="absolute top-0 h-full w-0.5 bg-slate-400"
          style={{ left: `${entryPct * 100}%` }}
          title={`진입 ${fmtN(entry)}`}
        />
      </div>
      <div className="flex justify-between text-[10px] tabular-nums">
        <span className="text-red-400">{fmtN(stop)}</span>
        <span className="text-slate-500">{fmtN(entry)}</span>
        <span className="text-emerald-400">{fmtN(target)}</span>
      </div>
    </div>
  );
}

/* ── Performance Stats ── */

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
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatBox label="전체 승률" value={`${(winRate * 100).toFixed(0)}%`} sub={`${wins.length}승 ${losses.length}패`} />
        <StatBox label="평균 수익" value={`${avgReturn >= 0 ? '+' : ''}${(avgReturn * 100).toFixed(1)}%`} sub={`${avgDays}일 평균 보유`} positive={avgReturn >= 0} />
        <StatBox label="평균 익절" value={`+${(avgWin * 100).toFixed(1)}%`} sub={`${wins.length}건`} positive />
        <StatBox label="평균 손절" value={`${(avgLoss * 100).toFixed(1)}%`} sub={`${losses.length}건`} positive={false} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-emerald-900 bg-emerald-950/20 p-4">
          <p className="text-[10px] uppercase tracking-wider font-bold text-emerald-500 mb-1">최대 수익</p>
          <p className="text-lg font-bold text-emerald-400 tabular-nums">+{(best.returnPct * 100).toFixed(1)}%</p>
          <p className="text-xs text-slate-400">{best.ticker} · {best.holdingDays}일</p>
        </div>
        <div className="rounded-xl border border-red-900 bg-red-950/20 p-4">
          <p className="text-[10px] uppercase tracking-wider font-bold text-red-500 mb-1">최대 손실</p>
          <p className="text-lg font-bold text-red-400 tabular-nums">{(worst.returnPct * 100).toFixed(1)}%</p>
          <p className="text-xs text-slate-400">{worst.ticker} · {worst.holdingDays}일</p>
        </div>
      </div>

      {(tagA.length > 0 || tagB.length > 0) && (
        <div className="rounded-xl border border-[#1e293b] bg-[#0f172a] p-4">
          <h4 className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-3">전략 비교</h4>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-amber-300 font-bold mb-1">A 이른진입 ({tagA.length}건)</p>
              {tagAWinRate != null ? (
                <>
                  <p className="text-xs text-slate-400">승률 {(tagAWinRate * 100).toFixed(0)}%</p>
                  <p className="text-xs text-slate-400">평균 {tagAAvg! >= 0 ? '+' : ''}{(tagAAvg! * 100).toFixed(1)}%</p>
                </>
              ) : <p className="text-xs text-slate-600">기록 없음</p>}
            </div>
            <div>
              <p className="text-blue-300 font-bold mb-1">B 확인진입 ({tagB.length}건)</p>
              {tagBWinRate != null ? (
                <>
                  <p className="text-xs text-slate-400">승률 {(tagBWinRate * 100).toFixed(0)}%</p>
                  <p className="text-xs text-slate-400">평균 {tagBAvg! >= 0 ? '+' : ''}{(tagBAvg! * 100).toFixed(1)}%</p>
                </>
              ) : <p className="text-xs text-slate-600">기록 없음</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Shared UI ── */

function SubTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'px-3 py-2 -mb-px text-xs font-medium border-b-2 transition-colors ' +
        (active ? 'border-indigo-500 text-indigo-300' : 'border-transparent text-slate-400 hover:text-slate-200')
      }
    >
      {children}
    </button>
  );
}

function SummaryBox({ label, value, sub, positive }: { label: string; value: string; sub?: string; positive?: boolean }) {
  const color = positive === true ? 'text-emerald-400' : positive === false ? 'text-red-400' : 'text-slate-100';
  return (
    <div className="rounded-xl border border-[#1e293b] bg-[#0f172a] p-3">
      <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${color}`}>{value}</p>
      {sub && <p className={`text-[10px] tabular-nums ${positive === true ? 'text-emerald-500' : positive === false ? 'text-red-500' : 'text-slate-500'}`}>{sub}</p>}
    </div>
  );
}

function StatBox({ label, value, sub, positive }: { label: string; value: string; sub: string; positive?: boolean }) {
  const color = positive === true ? 'text-emerald-400' : positive === false ? 'text-red-400' : 'text-slate-100';
  return (
    <div className="rounded-xl border border-[#1e293b] bg-[#0f172a] p-3">
      <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${color}`}>{value}</p>
      <p className="text-[10px] text-slate-500">{sub}</p>
    </div>
  );
}
