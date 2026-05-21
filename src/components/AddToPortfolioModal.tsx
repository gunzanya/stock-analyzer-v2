import { useState } from 'react';
import type { StrategyTag } from '../lib/portfolio.js';
import { addPosition, genId } from '../lib/portfolio.js';

interface Props {
  ticker: string;
  name: string;
  currentPrice: number | null;
  stopPrice: number | null;
  targetPrice: number | null;
  scores: { fundamental: number; timing: number; overall: number };
  onClose: () => void;
  onAdded: () => void;
}

export function AddToPortfolioModal({
  ticker,
  name,
  currentPrice,
  stopPrice,
  targetPrice,
  scores,
  onClose,
  onAdded,
}: Props) {
  const [entry, setEntry] = useState(currentPrice?.toString() ?? '');
  const [stop, setStop] = useState(stopPrice?.toString() ?? '');
  const [target, setTarget] = useState(targetPrice?.toString() ?? '');
  const [tag, setTag] = useState<StrategyTag>('A');
  const [memo, setMemo] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const entryPrice = parseFloat(entry);
    if (!Number.isFinite(entryPrice) || entryPrice <= 0) return;

    addPosition({
      id: genId(),
      ticker,
      name,
      entryPrice,
      stopPrice: parseFloat(stop) || null,
      targetPrice: parseFloat(target) || null,
      entryDate: new Date().toISOString().slice(0, 10),
      scores,
      strategyTag: tag,
      memo,
    });
    onAdded();
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-2xl bg-[#0f172a] border border-[#1e293b] p-6 shadow-2xl"
      >
        <h3 className="text-base font-bold text-slate-100 mb-1">
          💼 포트폴리오 추가
        </h3>
        <p className="text-sm text-slate-400 mb-4">
          {ticker} · {name}
        </p>

        <div className="space-y-3">
          <Field label="진입가" value={entry} onChange={setEntry} required />
          <Field label="손절가" value={stop} onChange={setStop} />
          <Field label="목표가" value={target} onChange={setTarget} />

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
