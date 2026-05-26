import { useMemo, useState } from 'react';
import type { StockType } from '../lib/types.js';
import type { StrategyTag, StrategySource } from '../lib/portfolio.js';
import {
  addPosition,
  addPositionToPortfolio,
  genId,
  getSelectedPortfolioId,
  listPortfolios,
} from '../lib/portfolio.js';
import { suggestStrategyForEntry } from '../lib/strategy.js';

const FX_FALLBACK = 1380;

function isKR(ticker: string): boolean {
  return /\.(KS|KQ)$/i.test(ticker);
}

function fmtCurrency(v: number, kr: boolean): string {
  return kr
    ? `₩${Math.round(v).toLocaleString()}`
    : `$${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function fmtConvert(v: number, kr: boolean, rate: number): string {
  if (kr) return `≈$${Math.round(v / rate).toLocaleString()}`;
  return `≈₩${Math.round(v * rate).toLocaleString()}`;
}

interface Props {
  ticker: string;
  name: string;
  currentPrice: number | null;
  stopPrice: number | null;
  targetPrice: number | null;
  target2Price?: number | null;
  atr14?: number | null;
  strategyType?: StockType | null;
  scores: { fundamental: number; timing: number; overall: number };
  fxRate?: number | null;
  onClose: () => void;
  onAdded: () => void;
}

export function AddToPortfolioModal({
  ticker,
  name,
  currentPrice,
  stopPrice,
  targetPrice,
  target2Price,
  atr14,
  strategyType,
  scores,
  fxRate: fxRateProp,
  onClose,
  onAdded,
}: Props) {
  const rate = fxRateProp ?? FX_FALLBACK;
  const kr = isKR(ticker);
  const portfolios = listPortfolios();
  const currentPortfolioId = getSelectedPortfolioId();
  const [targetPortfolioId, setTargetPortfolioId] = useState<string>(currentPortfolioId);
  const [inputMode, setInputMode] = useState<'qty' | 'amount'>('qty');
  const [qty, setQty] = useState('100');
  const [amount, setAmount] = useState('');
  const [entry, setEntry] = useState(currentPrice?.toString() ?? '');
  const [stop, setStop] = useState(stopPrice?.toString() ?? '');
  const [target1, setTarget1] = useState(targetPrice?.toString() ?? '');
  const [target2, setTarget2] = useState(target2Price?.toString() ?? '');
  const [tag, setTag] = useState<StrategyTag>('A');
  const [memo, setMemo] = useState('');
  // When `dirty` is true the user has hand-edited at least one of stop /
  // target1 / target2, so we stop auto-replacing those inputs as the entry
  // price changes. The "다시 계산" button clears it.
  const [dirty, setDirty] = useState(false);

  const entryPrice = parseFloat(entry);
  const validEntry = Number.isFinite(entryPrice) && entryPrice > 0;

  // Auto-suggestion recomputes whenever entry / ATR / type changes. Stays
  // computed even when `dirty` is true, so the user can compare against it.
  const suggestion = useMemo(() => {
    if (!validEntry || atr14 == null || atr14 <= 0 || !strategyType) return null;
    return suggestStrategyForEntry(entryPrice, atr14, strategyType);
  }, [validEntry, entryPrice, atr14, strategyType]);

  // Adjust the editable inputs while rendering when the suggestion changes
  // (React's recommended pattern over a useEffect+setState). The fingerprint
  // guards the conditional setState so we don't loop.
  const fingerprint = suggestion
    ? `${suggestion.stop}/${suggestion.target1}/${suggestion.target2}`
    : null;
  const [appliedFingerprint, setAppliedFingerprint] = useState<string | null>(null);
  if (!dirty && fingerprint != null && fingerprint !== appliedFingerprint) {
    setAppliedFingerprint(fingerprint);
    setStop(String(suggestion!.stop));
    setTarget1(String(suggestion!.target1));
    setTarget2(String(suggestion!.target2));
  }

  function handleManualEdit(setter: (v: string) => void) {
    return (v: string) => {
      setter(v);
      setDirty(true);
    };
  }

  function recomputeFromSuggestion() {
    if (!suggestion) return;
    setStop(String(suggestion.stop));
    setTarget1(String(suggestion.target1));
    setTarget2(String(suggestion.target2));
    setAppliedFingerprint(fingerprint);
    setDirty(false);
  }

  const computedQty = inputMode === 'qty'
    ? parseInt(qty, 10)
    : validEntry ? Math.floor(parseFloat(amount) / entryPrice) : 0;
  const computedTotal = validEntry && computedQty > 0 ? computedQty * entryPrice : null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validEntry) return;
    const quantity = computedQty;
    if (!Number.isFinite(quantity) || quantity <= 0) return;

    const stopVal = parseFloat(stop);
    const t1Val = parseFloat(target1);
    const t2Val = parseFloat(target2);

    const matchesAuto =
      suggestion != null &&
      !dirty &&
      Number.isFinite(stopVal) && stopVal === suggestion.stop &&
      Number.isFinite(t1Val) && t1Val === suggestion.target1 &&
      Number.isFinite(t2Val) && t2Val === suggestion.target2;
    const source: StrategySource = matchesAuto ? 'auto' : 'manual';

    const risk = validEntry && Number.isFinite(stopVal) ? entryPrice - stopVal : null;
    const rr1 =
      risk != null && risk > 0 && Number.isFinite(t1Val)
        ? Math.round(((t1Val - entryPrice) / risk) * 10) / 10
        : null;
    const rr2 =
      risk != null && risk > 0 && Number.isFinite(t2Val)
        ? Math.round(((t2Val - entryPrice) / risk) * 10) / 10
        : null;

    const newPos = {
      id: genId(),
      ticker,
      name,
      quantity,
      entryPrice,
      stopPrice: Number.isFinite(stopVal) ? stopVal : null,
      targetPrice: Number.isFinite(t1Val) ? t1Val : null,
      target2Price: Number.isFinite(t2Val) ? t2Val : null,
      strategyType: strategyType ?? null,
      riskReward1: rr1,
      riskReward2: rr2,
      strategySource: source,
      entryDate: new Date().toISOString().slice(0, 10),
      scores,
      strategyTag: tag,
      memo,
    };
    if (targetPortfolioId === currentPortfolioId) {
      addPosition(newPos);
    } else {
      addPositionToPortfolio(targetPortfolioId, newPos);
    }
    onAdded();
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 overflow-y-auto py-6"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-2xl bg-[#0f172a] border border-[#1e293b] p-6 shadow-2xl my-auto"
      >
        <h3 className="text-base font-bold text-slate-100 mb-1">
          💼 포트폴리오 추가
        </h3>
        <p className="text-sm text-slate-400 mb-4">
          {ticker} · {name}
        </p>

        <div className="space-y-3">
          {portfolios.length > 1 && (
            <div>
              <label className="block text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1">
                포트폴리오
              </label>
              <select
                value={targetPortfolioId}
                onChange={(e) => setTargetPortfolioId(e.target.value)}
                className="w-full min-h-[40px] px-3 py-2 rounded-lg border border-[#1e293b] bg-[#0a0f1a] text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {portfolios.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}{p.id === currentPortfolioId ? ' (현재)' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          <Field label="진입가" value={entry} onChange={setEntry} required />

          {suggestion && (
            <div className="rounded-lg border border-indigo-900/60 bg-indigo-950/20 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[10px] uppercase tracking-wider font-bold text-indigo-300">
                  전략값 자동 제안
                </p>
                <button
                  type="button"
                  onClick={recomputeFromSuggestion}
                  className="text-[10px] px-2 py-0.5 rounded border border-indigo-700/50 text-indigo-300 hover:bg-indigo-900/30 transition-colors"
                  title="현재 진입가/ATR로 다시 계산"
                >
                  ↻ 다시 계산
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2 text-[11px] tabular-nums">
                <SuggestionLine label="손절가" value={suggestion.stop} kr={kr} />
                <SuggestionLine label="1차 목표" value={suggestion.target1} kr={kr} />
                <SuggestionLine label="2차 목표" value={suggestion.target2} kr={kr} />
              </div>
              <p className="text-[10px] text-indigo-200/80">
                R:R{' '}
                <span className="font-semibold">
                  {suggestion.riskReward1 != null ? suggestion.riskReward1.toFixed(1) : '—'}
                </span>
                {' / '}
                <span className="font-semibold">
                  {suggestion.riskReward2 != null ? suggestion.riskReward2.toFixed(1) : '—'}
                </span>
                {' · 기준: '}
                <span className="font-mono">{suggestion.rationale}</span>
                {suggestion.fellBack && (
                  <span className="text-amber-300"> (fallback)</span>
                )}
              </p>
              <p className="text-[10px] text-slate-500 leading-snug">
                과거 보유분 추가 시 현재 ATR 기준으로 계산되므로 실제 진입 당시 전략값과 다를 수 있습니다. 아래 손절가/목표가를 직접 수정할 수 있어요.
              </p>
            </div>
          )}

          {/* Quantity / Amount toggle */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] uppercase tracking-wider font-bold text-slate-500">
                {inputMode === 'qty' ? '수량' : '금액'}
              </label>
              <div className="flex rounded-md overflow-hidden border border-[#1e293b]">
                <button type="button" onClick={() => setInputMode('qty')}
                  className={`px-2.5 py-1 text-[10px] font-bold transition-colors ${inputMode === 'qty' ? 'bg-indigo-600 text-white' : 'bg-[#0a0f1a] text-slate-500 hover:text-slate-300'}`}
                >수량</button>
                <button type="button" onClick={() => setInputMode('amount')}
                  className={`px-2.5 py-1 text-[10px] font-bold transition-colors ${inputMode === 'amount' ? 'bg-indigo-600 text-white' : 'bg-[#0a0f1a] text-slate-500 hover:text-slate-300'}`}
                >금액</button>
              </div>
            </div>
            {inputMode === 'qty' ? (
              <input type="number" step="1" min="1" value={qty}
                onChange={(e) => setQty(e.target.value)} required placeholder="주 수"
                className="w-full min-h-[40px] px-3 py-2 rounded-lg border border-[#1e293b] bg-[#0a0f1a] text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            ) : (
              <input type="number" step="any" min="0" value={amount}
                onChange={(e) => setAmount(e.target.value)} required placeholder="투자 금액"
                className="w-full min-h-[40px] px-3 py-2 rounded-lg border border-[#1e293b] bg-[#0a0f1a] text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            )}
          </div>

          {/* Computed summary */}
          {computedTotal != null && computedQty > 0 && (
            <div className="px-3 py-2 rounded-lg bg-indigo-950/30 border border-indigo-800/30 text-sm text-indigo-200 tabular-nums">
              {computedQty}주 × {fmtCurrency(entryPrice, kr)} = <span className="font-bold">{fmtCurrency(computedTotal, kr)}</span>
              <span className="text-indigo-400 ml-1">({fmtConvert(computedTotal, kr, rate)})</span>
            </div>
          )}

          <Field label="손절가" value={stop} onChange={handleManualEdit(setStop)} />
          <Field label="1차 목표가" value={target1} onChange={handleManualEdit(setTarget1)} />
          <Field label="2차 목표가" value={target2} onChange={handleManualEdit(setTarget2)} />

          <div>
            <label className="block text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1">
              전략 태그
            </label>
            <div className="flex gap-2">
              <TagButton label="A 이른진입" active={tag === 'A'} onClick={() => setTag('A')} />
              <TagButton label="B 확인진입" active={tag === 'B'} onClick={() => setTag('B')} />
            </div>
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1">
              메모
            </label>
            <textarea
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 rounded-lg border border-[#1e293b] bg-[#0a0f1a] text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="진입 근거, 모니터링 포인트 등"
            />
          </div>

          <div className="text-[11px] text-slate-500 bg-[#0a0f1a] rounded-lg px-3 py-2">
            진입 시점 — 펀더 {scores.fundamental} / 타이밍 {scores.timing} / 종합 {scores.overall}
          </div>
        </div>

        <div className="flex gap-2 mt-5">
          <button
            type="submit"
            className="flex-1 min-h-[44px] rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm active:bg-indigo-700 transition-colors"
          >
            추가
          </button>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] px-4 rounded-lg border border-[#1e293b] text-slate-400 hover:text-slate-200 text-sm transition-colors"
          >
            취소
          </button>
        </div>
      </form>
    </div>
  );
}

function SuggestionLine({ label, value, kr }: { label: string; value: number; kr: boolean }) {
  return (
    <div className="flex flex-col">
      <span className="text-[9px] uppercase tracking-wider text-indigo-400">{label}</span>
      <span className="text-indigo-100 font-semibold">{fmtCurrency(value, kr)}</span>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1">
        {label}
      </label>
      <input
        type="number"
        step="any"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className="w-full min-h-[40px] px-3 py-2 rounded-lg border border-[#1e293b] bg-[#0a0f1a] text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
    </div>
  );
}

function TagButton({
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
      className={`min-h-[36px] px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
        active
          ? 'bg-indigo-600 text-white'
          : 'border border-[#1e293b] text-slate-400 hover:text-slate-200'
      }`}
    >
      {label}
    </button>
  );
}
