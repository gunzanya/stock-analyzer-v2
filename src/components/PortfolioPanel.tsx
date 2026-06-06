import { useCallback, useEffect, useRef, useState } from 'react';
import {
  closePosition,
  createPortfolio,
  deletePortfolio,
  getSelectedPortfolioId,
  listPortfolios,
  loadClosed,
  loadPositions,
  loadSnapshots,
  loadEvents,
  onPortfolioChange,
  recordSnapshot,
  removePosition,
  renamePortfolio,
  selectPortfolio,
  updatePosition,
  type ClosedPosition,
  type PortfolioMeta,
  type PortfolioPosition,
  type StrategyTag,
} from '../lib/portfolio.js';
import { fetchAnalysis } from '../lib/api.js';
import { onSyncStatus } from '../lib/sync.js';
import { PortfolioReturnChart } from './PortfolioReturnChart.js';

type PriceMap = Record<string, number | null>;

const FX_FALLBACK = 1380;

function isKR(ticker: string): boolean {
  return /\.(KS|KQ)$/i.test(ticker);
}

function fmtN(v: number, digits = 2): string {
  return v.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function fmtCcy(v: number, kr: boolean): string {
  return kr
    ? `₩${Math.round(v).toLocaleString()}`
    : `$${fmtN(v, 0)}`;
}

function fmtAlt(v: number, kr: boolean, rate: number): string {
  if (kr) return `≈$${Math.round(v / rate).toLocaleString()}`;
  return `≈₩${Math.round(v * rate).toLocaleString()}`;
}

// Single source of truth for strategy tag presentation. New tags can be
// added by extending the maps; call sites read these instead of branching
// inline on strategyTag.
const TAG_ORDER: StrategyTag[] = ['A', 'B', 'C'];
const TAG_LABEL: Record<StrategyTag, string> = {
  A: 'A 이른진입',
  B: 'B 확인진입',
  C: 'C 적층식매수',
};
const TAG_BADGE_CLASS: Record<StrategyTag, string> = {
  A: 'bg-amber-900/40 text-amber-300',
  B: 'bg-blue-900/40 text-blue-300',
  C: 'bg-purple-900/40 text-purple-300',
};
const TAG_ACTIVE_BTN_CLASS: Record<StrategyTag, string> = {
  A: 'bg-amber-900/60 text-amber-200 border border-amber-700',
  B: 'bg-blue-900/60 text-blue-200 border border-blue-700',
  C: 'bg-purple-900/60 text-purple-200 border border-purple-700',
};
const TAG_HEADING_CLASS: Record<StrategyTag, string> = {
  A: 'text-amber-300',
  B: 'text-blue-300',
  C: 'text-purple-300',
};

function toKRW(v: number, kr: boolean, rate: number): number {
  return kr ? v : v * rate;
}

type PosView = 'compact' | 'detail';
const POS_VIEW_KEY = 'portfolio_pos_view';

function loadPosView(): PosView {
  return (localStorage.getItem(POS_VIEW_KEY) as PosView) || 'compact';
}

export function PortfolioPanel({ onPickTicker }: { onPickTicker: (ticker: string) => void }) {
  const [portfolios, setPortfolios] = useState<PortfolioMeta[]>(() => listPortfolios());
  const [selectedId, setSelectedId] = useState<string>(() => getSelectedPortfolioId());
  const [positions, setPositions] = useState<PortfolioPosition[]>([]);
  const [closed, setClosed] = useState<ClosedPosition[]>([]);
  const [prices, setPrices] = useState<PriceMap>({});
  const [fxRate, setFxRate] = useState(FX_FALLBACK);
  const [loading, setLoading] = useState(false);
  const [closeModal, setCloseModal] = useState<{ id: string; pct: number } | null>(null);
  const [closePrice, setClosePrice] = useState('');
  const [editTarget, setEditTarget] = useState<PortfolioPosition | null>(null);
  const [view, setView] = useState<'active' | 'history' | 'stats'>('active');
  const [posView, setPosView] = useState<PosView>(loadPosView);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle');
  const [snapshots, setSnapshots] = useState(loadSnapshots);
  const [events, setEvents] = useState(loadEvents);

  function changePosView(v: PosView) {
    setPosView(v);
    localStorage.setItem(POS_VIEW_KEY, v);
  }

  const reload = useCallback(() => {
    setPortfolios(listPortfolios());
    setSelectedId(getSelectedPortfolioId());
    setPositions(loadPositions());
    setClosed(loadClosed());
    setSnapshots(loadSnapshots());
    setEvents(loadEvents());
  }, []);

  useEffect(() => { reload(); }, [reload]);

  // Listen for portfolio list/selection changes (eg. after sync or programmatic
  // create/delete) so every view reflects the same active portfolio.
  useEffect(() => onPortfolioChange(reload), [reload]);

  useEffect(() => onSyncStatus(setSyncStatus), []);

  const fetchPrices = useCallback(async () => {
    if (positions.length === 0) return;
    setLoading(true);
    const map: PriceMap = {};
    let gotRate: number | null = null;
    await Promise.all(
      positions.map(async (p) => {
        try {
          const r = await fetchAnalysis(p.ticker);
          map[p.ticker] = r.fundamental.price;
          if (gotRate == null && r.usdKrwRate != null) gotRate = r.usdKrwRate;
        } catch {
          map[p.ticker] = null;
        }
      }),
    );
    setPrices(map);
    if (gotRate != null) setFxRate(gotRate);
    setLoading(false);

    const rate = gotRate ?? FX_FALLBACK;
    let inv = 0;
    let val = 0;
    for (const p of positions) {
      const kr = isKR(p.ticker);
      inv += toKRW(p.entryPrice * p.quantity, kr, rate);
      val += toKRW((map[p.ticker] ?? p.entryPrice) * p.quantity, kr, rate);
    }
    if (inv > 0) {
      recordSnapshot({ totalInvestedKRW: inv, totalValueKRW: val, returnPct: (val - inv) / inv });
      setSnapshots(loadSnapshots());
    }
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

  // Portfolio totals (normalize to KRW for cross-currency aggregation)
  let totalInvestedKRW = 0;
  let totalValueKRW = 0;
  let totalDays = 0;
  for (const p of positions) {
    const cur = prices[p.ticker];
    const kr = isKR(p.ticker);
    totalInvestedKRW += toKRW(p.entryPrice * p.quantity, kr, fxRate);
    totalValueKRW += toKRW((cur ?? p.entryPrice) * p.quantity, kr, fxRate);
    totalDays += holdingDays(p.entryDate);
  }
  const totalReturn = totalInvestedKRW > 0 ? (totalValueKRW - totalInvestedKRW) / totalInvestedKRW : 0;
  const avgDays = positions.length > 0 ? Math.round(totalDays / positions.length) : 0;
  const totalPnlKRW = totalValueKRW - totalInvestedKRW;

  return (
    <div className="space-y-4">
      <PortfolioSelector
        portfolios={portfolios}
        selectedId={selectedId}
        onSelect={(id) => selectPortfolio(id)}
        onCreate={(name) => createPortfolio(name)}
        onRename={(id, name) => renamePortfolio(id, name)}
        onDelete={(id) => deletePortfolio(id)}
      />

      <div className="flex items-center gap-1 border-b border-[#1e293b]">
        <SubTab active={view === 'active'} onClick={() => setView('active')}>
          보유 ({positions.length})
        </SubTab>
        <SubTab active={view === 'history'} onClick={() => setView('history')}>
          청산 기록 ({closed.length})
        </SubTab>
        <SubTab active={view === 'stats'} onClick={() => setView('stats')}>
          성과 분석
        </SubTab>
        <span className="ml-auto text-[10px] text-slate-500 pr-1">
          {syncStatus === 'syncing' && '⏳ 동기화 중'}
          {syncStatus === 'synced' && '☁️ 동기화됨'}
          {syncStatus === 'error' && '⚠️ 동기화 실패'}
        </span>
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
                <SummaryBox
                  label="총 투자금"
                  value={`₩${Math.round(totalInvestedKRW).toLocaleString()}`}
                  sub={`≈$${Math.round(totalInvestedKRW / fxRate).toLocaleString()}`}
                />
                <SummaryBox
                  label="총 평가금"
                  value={`₩${Math.round(totalValueKRW).toLocaleString()}`}
                  sub={`${totalReturn >= 0 ? '+' : ''}${(totalReturn * 100).toFixed(2)}%`}
                  positive={totalReturn >= 0}
                />
                <SummaryBox
                  label="총 손익"
                  value={`${totalPnlKRW >= 0 ? '+' : ''}₩${Math.round(Math.abs(totalPnlKRW)).toLocaleString()}`}
                  sub={`${totalPnlKRW >= 0 ? '+' : ''}$${Math.round(Math.abs(totalPnlKRW) / fxRate).toLocaleString()}`}
                  positive={totalPnlKRW >= 0}
                />
                <SummaryBox label="보유 종목" value={`${positions.length}개`} sub={`평균 ${avgDays}일 · 환율 ${Math.round(fxRate).toLocaleString()}`} />
              </div>

              <PortfolioReturnChart snapshots={snapshots} events={events} />

              <div className="flex items-center justify-between">
                {loading && (
                  <p className="text-[10px] text-slate-600">현재가 업데이트 중...</p>
                )}
                <div className="flex gap-1 ml-auto">
                  <ViewToggle active={posView === 'compact'} onClick={() => changePosView('compact')}>간략</ViewToggle>
                  <ViewToggle active={posView === 'detail'} onClick={() => changePosView('detail')}>자세히</ViewToggle>
                </div>
              </div>

              {posView === 'compact' ? (
                <CompactTable
                  positions={positions}
                  prices={prices}
                  holdingDays={holdingDays}
                  onPickTicker={onPickTicker}
                />
              ) : (
                <div className="space-y-3">
                  {positions.map((p) => (
                    <PositionCard
                      key={p.id}
                      pos={p}
                      currentPrice={prices[p.ticker] ?? null}
                      days={holdingDays(p.entryDate)}
                      fxRate={fxRate}
                      onPartialClose={(pct) => openCloseModal(p.id, pct)}
                      onEdit={() => setEditTarget({ ...p })}
                      onDelete={() => { removePosition(p.id); reload(); }}
                    />
                  ))}
                </div>
              )}
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
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${TAG_BADGE_CLASS[c.strategyTag]}`}>{c.strategyTag}</span>
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      {c.closedQuantity}주 · {c.entryDate} → {c.closeDate} · {c.holdingDays}일 · {fmtCcy(c.entryPrice, isKR(c.ticker))} → {fmtCcy(c.closePrice, isKR(c.ticker))}
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

      {/* Edit modal */}
      {editTarget && (
        <EditPositionModal
          pos={editTarget}
          onChange={setEditTarget}
          onSave={() => {
            updatePosition(editTarget.id, {
              quantity: editTarget.quantity,
              entryPrice: editTarget.entryPrice,
              stopPrice: editTarget.stopPrice,
              targetPrice: editTarget.targetPrice,
              memo: editTarget.memo,
              strategyTag: editTarget.strategyTag,
            });
            setEditTarget(null);
            reload();
          }}
          onCancel={() => setEditTarget(null)}
        />
      )}
    </div>
  );
}

/* ── Edit Position Modal ── */

function EditPositionModal({
  pos,
  onChange,
  onSave,
  onCancel,
}: {
  pos: PortfolioPosition;
  onChange: (p: PortfolioPosition) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const set = (patch: Partial<PortfolioPosition>) => onChange({ ...pos, ...patch });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="w-full max-w-sm rounded-2xl bg-[#0f172a] border border-[#1e293b] p-6 shadow-2xl space-y-4">
        <h3 className="text-base font-bold text-slate-100">
          {pos.ticker} <span className="text-xs font-normal text-slate-400">{pos.name}</span>
        </h3>

        <div className="grid grid-cols-2 gap-3">
          <EditField label="수량" type="number" value={pos.quantity} onChange={(v) => set({ quantity: Math.max(1, Number(v)) })} />
          <EditField label="진입가" type="number" value={pos.entryPrice} onChange={(v) => set({ entryPrice: Math.max(0, Number(v)) })} />
          <EditField label="손절가" type="number" value={pos.stopPrice ?? ''} onChange={(v) => set({ stopPrice: v === '' ? null : Math.max(0, Number(v)) })} />
          <EditField label="목표가" type="number" value={pos.targetPrice ?? ''} onChange={(v) => set({ targetPrice: v === '' ? null : Math.max(0, Number(v)) })} />
        </div>

        <div>
          <label className="block text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1">전략</label>
          <div className="flex gap-2 flex-wrap">
            {TAG_ORDER.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => set({ strategyTag: tag })}
                className={`flex-1 min-w-[88px] min-h-[36px] rounded-lg text-xs font-bold transition-colors ${
                  pos.strategyTag === tag
                    ? TAG_ACTIVE_BTN_CLASS[tag]
                    : 'bg-slate-800 text-slate-500 border border-[#1e293b]'
                }`}
              >
                {TAG_LABEL[tag]}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1">메모</label>
          <textarea
            value={pos.memo}
            onChange={(e) => set({ memo: e.target.value })}
            rows={2}
            className="w-full px-3 py-2 rounded-lg border border-[#1e293b] bg-[#0a0f1a] text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
          />
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onSave}
            className="flex-1 min-h-[40px] rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm transition-colors"
          >
            저장
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="min-h-[40px] px-4 rounded-lg border border-[#1e293b] text-slate-400 text-sm transition-colors"
          >
            취소
          </button>
        </div>
      </div>
    </div>
  );
}

function EditField({ label, type, value, onChange }: { label: string; type: string; value: string | number; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1">{label}</label>
      <input
        type={type}
        step="any"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full min-h-[36px] px-3 py-1.5 rounded-lg border border-[#1e293b] bg-[#0a0f1a] text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
    </div>
  );
}

/* ── Position Card ── */

function PositionCard({
  pos,
  currentPrice,
  days,
  fxRate,
  onPartialClose,
  onEdit,
  onDelete,
}: {
  pos: PortfolioPosition;
  currentPrice: number | null;
  days: number;
  fxRate: number;
  onPartialClose: (pct: number) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const kr = isKR(pos.ticker);
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
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold flex-shrink-0 ${TAG_BADGE_CLASS[pos.strategyTag]}`}>
            {TAG_LABEL[pos.strategyTag]}
          </span>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {hitStop && (
            <span className="px-2 py-0.5 rounded bg-red-900/60 text-red-200 text-[10px] font-bold">
              🔴 손절 필요!
            </span>
          )}
          {hitTarget && (
            <span className="px-2 py-0.5 rounded bg-emerald-900/60 text-emerald-200 text-[10px] font-bold">
              🟢 익절 검토!
            </span>
          )}
          <button
            type="button"
            onClick={onEdit}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition-colors text-sm"
            aria-label="수정"
          >
            ✏️
          </button>
        </div>
      </div>

      {/* Row 2: quantity & investment */}
      <div className="text-xs text-slate-400">
        {pos.quantity}주 × {fmtCcy(pos.entryPrice, kr)} = <span className="text-slate-200 font-medium">{fmtCcy(invested, kr)}</span>
        <span className="text-slate-600 ml-1">({fmtAlt(invested, kr, fxRate)})</span>
      </div>

      {/* Row 3: current price & return */}
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-xs text-slate-500">현재가</span>
          <span className="text-lg font-bold tabular-nums text-slate-100">
            {cur != null ? fmtCcy(cur, kr) : '—'}
          </span>
          {ret != null && (
            <span className={`text-sm font-bold tabular-nums ${ret >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              ({ret >= 0 ? '+' : ''}{(ret * 100).toFixed(2)}%)
            </span>
          )}
        </div>
        {pnl != null && (
          <div className="text-right">
            <span className={`text-sm font-bold tabular-nums ${pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {pnl >= 0 ? '+' : ''}{fmtCcy(Math.abs(pnl), kr)}
            </span>
            <span className={`block text-[10px] tabular-nums ${pnl >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
              {fmtAlt(Math.abs(pnl), kr, fxRate)}
            </span>
          </div>
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

  // Per-tag aggregate: count, win rate, avg return. Reduces duplication and
  // makes adding new tags (e.g. C 적층식매수) a one-line change.
  const tagStats: { tag: StrategyTag; count: number; winRate: number | null; avg: number | null }[] =
    TAG_ORDER.map((tag) => {
      const rows = closed.filter((c) => c.strategyTag === tag);
      const count = rows.length;
      const winRate = count > 0 ? rows.filter((r) => r.returnPct > 0).length / count : null;
      const avg = count > 0 ? rows.reduce((a, r) => a + r.returnPct, 0) / count : null;
      return { tag, count, winRate, avg };
    });
  const anyTagged = tagStats.some((s) => s.count > 0);

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

      {anyTagged && (
        <div className="rounded-xl border border-[#1e293b] bg-[#0f172a] p-4">
          <h4 className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-3">전략 비교</h4>
          <div className="grid grid-cols-3 gap-4 text-sm">
            {tagStats.map((s) => (
              <div key={s.tag}>
                <p className={`${TAG_HEADING_CLASS[s.tag]} font-bold mb-1`}>
                  {TAG_LABEL[s.tag]} ({s.count}건)
                </p>
                {s.winRate != null && s.avg != null ? (
                  <>
                    <p className="text-xs text-slate-400">승률 {(s.winRate * 100).toFixed(0)}%</p>
                    <p className="text-xs text-slate-400">평균 {s.avg >= 0 ? '+' : ''}{(s.avg * 100).toFixed(1)}%</p>
                  </>
                ) : <p className="text-xs text-slate-600">기록 없음</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Compact Table ── */

function CompactTable({
  positions,
  prices,
  holdingDays,
  onPickTicker,
}: {
  positions: PortfolioPosition[];
  prices: PriceMap;
  holdingDays: (d: string) => number;
  onPickTicker: (ticker: string) => void;
}) {
  return (
    <div className="rounded-xl border border-[#1e293b] overflow-hidden">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-[#0f172a] text-slate-500 text-[10px] uppercase tracking-wider">
            <th className="text-left px-3 py-2 font-bold">종목</th>
            <th className="text-right px-3 py-2 font-bold">수익률</th>
            <th className="text-right px-3 py-2 font-bold hidden sm:table-cell">손익</th>
            <th className="text-right px-3 py-2 font-bold">보유일</th>
            <th className="text-center px-2 py-2 font-bold">상태</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => {
            const kr = isKR(p.ticker);
            const cur = prices[p.ticker] ?? null;
            const ret = cur != null ? (cur - p.entryPrice) / p.entryPrice : null;
            const pnl = cur != null ? (cur - p.entryPrice) * p.quantity : null;
            const days = holdingDays(p.entryDate);
            const hitStop = p.stopPrice != null && cur != null && cur <= p.stopPrice;
            const hitTarget = p.targetPrice != null && cur != null && cur >= p.targetPrice;
            const status = hitStop ? '🔴' : hitTarget ? '🟢' : '⚪';

            return (
              <tr
                key={p.id}
                onClick={() => onPickTicker(p.ticker)}
                className="border-t border-[#1e293b] hover:bg-slate-800/50 cursor-pointer transition-colors"
              >
                <td className="px-3 py-2.5">
                  <span className="font-bold text-slate-100">{p.ticker}</span>
                  <span className="text-slate-500 ml-1.5 hidden sm:inline">{p.name}</span>
                </td>
                <td className={`px-3 py-2.5 text-right font-bold tabular-nums ${
                  ret == null ? 'text-slate-500' : ret >= 0 ? 'text-emerald-400' : 'text-red-400'
                }`}>
                  {ret != null ? `${ret >= 0 ? '+' : ''}${(ret * 100).toFixed(2)}%` : '—'}
                </td>
                <td className={`px-3 py-2.5 text-right tabular-nums hidden sm:table-cell ${
                  pnl == null ? 'text-slate-500' : pnl >= 0 ? 'text-emerald-400' : 'text-red-400'
                }`}>
                  {pnl != null ? `${pnl >= 0 ? '+' : ''}${fmtCcy(Math.abs(pnl), kr)}` : '—'}
                </td>
                <td className="px-3 py-2.5 text-right text-slate-400 tabular-nums">{days}일</td>
                <td className="px-2 py-2.5 text-center">{status}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ── Shared UI ── */

function ViewToggle({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1 rounded-md text-[10px] font-bold transition-colors ${
        active ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-500 hover:text-slate-300'
      }`}
    >
      {children}
    </button>
  );
}

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

/* ── Portfolio Selector ── */

function PortfolioSelector({
  portfolios,
  selectedId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: {
  portfolios: PortfolioMeta[];
  selectedId: string;
  onSelect: (id: string) => void;
  onCreate: (name: string) => string;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [renameName, setRenameName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<PortfolioMeta | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const current = portfolios.find((p) => p.id === selectedId) ?? portfolios[0];
  const canDelete = portfolios.length > 1;

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
        setNewName('');
      }
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    onCreate(name);
    setCreating(false);
    setNewName('');
    setOpen(false);
  }

  function handleRenameSave() {
    if (!current) return;
    const name = renameName.trim();
    if (!name || name === current.name) {
      setRenaming(false);
      return;
    }
    onRename(current.id, name);
    setRenaming(false);
  }

  return (
    <div className="rounded-2xl border border-[#1e293b] bg-[#0f172a] p-3 flex items-center gap-2">
      <span className="text-[10px] uppercase tracking-wider font-bold text-slate-500">
        포트폴리오
      </span>
      <div ref={ref} className="relative flex-1 min-w-0">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center justify-between gap-2 min-h-[36px] px-3 py-1.5 rounded-lg border border-[#1e293b] bg-[#0a0f1a] text-sm text-slate-100 hover:border-indigo-700 transition-colors"
        >
          <span className="truncate font-semibold">
            {current?.name ?? '—'}
          </span>
          <span className="text-slate-500 text-xs">▾</span>
        </button>
        {open && (
          <div className="absolute left-0 right-0 mt-2 rounded-lg border border-[#1e293b] bg-[#0f172a] shadow-xl shadow-black/40 z-30 overflow-hidden">
            <ul className="max-h-72 overflow-y-auto py-1">
              {portfolios.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => { onSelect(p.id); setOpen(false); }}
                    className={
                      'w-full text-left px-3 py-2 text-sm transition-colors ' +
                      (p.id === selectedId
                        ? 'bg-indigo-900/40 text-indigo-200'
                        : 'text-slate-300 hover:bg-slate-800')
                    }
                  >
                    {p.id === selectedId ? '✓ ' : ''}{p.name}
                  </button>
                </li>
              ))}
            </ul>
            <div className="border-t border-[#1e293b] px-2 py-2">
              {creating ? (
                <div className="flex gap-1">
                  <input
                    autoFocus
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCreate();
                      else if (e.key === 'Escape') { setCreating(false); setNewName(''); }
                    }}
                    placeholder="포트폴리오 이름"
                    className="flex-1 min-h-[32px] px-2 py-1 rounded border border-[#1e293b] bg-[#0a0f1a] text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                  <button
                    type="button"
                    onClick={handleCreate}
                    className="px-2 min-h-[32px] rounded bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold"
                  >
                    추가
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setCreating(true)}
                  className="w-full text-left px-2 py-1.5 rounded text-xs text-indigo-300 hover:bg-indigo-900/30 transition-colors"
                >
                  ➕ 새 포트폴리오
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {renaming ? (
        <div className="flex gap-1">
          <input
            autoFocus
            type="text"
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRenameSave();
              else if (e.key === 'Escape') setRenaming(false);
            }}
            className="w-32 min-h-[32px] px-2 py-1 rounded border border-[#1e293b] bg-[#0a0f1a] text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <button
            type="button"
            onClick={handleRenameSave}
            className="min-h-[32px] px-2 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold"
          >
            저장
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            if (!current) return;
            setRenameName(current.name);
            setRenaming(true);
          }}
          className="min-h-[36px] w-9 flex items-center justify-center rounded-lg border border-[#1e293b] text-slate-500 hover:text-slate-200 hover:border-slate-600 transition-colors text-sm"
          aria-label="이름 수정"
          title="이름 수정"
        >
          ✏️
        </button>
      )}

      <button
        type="button"
        onClick={() => { if (current && canDelete) setConfirmDelete(current); }}
        disabled={!canDelete}
        className="min-h-[36px] w-9 flex items-center justify-center rounded-lg border border-[#1e293b] text-slate-500 hover:text-red-400 hover:border-red-900 transition-colors text-sm disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-slate-500 disabled:hover:border-[#1e293b]"
        aria-label="포트폴리오 삭제"
        title={canDelete ? '포트폴리오 삭제' : '마지막 포트폴리오는 삭제할 수 없습니다'}
      >
        🗑️
      </button>

      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
          onClick={(e) => { if (e.target === e.currentTarget) setConfirmDelete(null); }}
        >
          <div className="w-full max-w-sm rounded-2xl bg-[#0f172a] border border-[#1e293b] p-6 shadow-2xl">
            <h3 className="text-base font-bold text-slate-100 mb-2">포트폴리오 삭제</h3>
            <p className="text-xs text-slate-400 mb-4">
              <span className="text-slate-100 font-semibold">"{confirmDelete.name}"</span>
              <span> 포트폴리오의 보유 종목, 청산 기록, 성과 데이터가 모두 삭제됩니다. 되돌릴 수 없습니다.</span>
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { onDelete(confirmDelete.id); setConfirmDelete(null); }}
                className="flex-1 min-h-[40px] rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold text-sm transition-colors"
              >
                삭제
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
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
