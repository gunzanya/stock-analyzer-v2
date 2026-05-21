import { useCallback, useEffect, useRef, useState } from 'react';
import { KR_STOCKS, type KrStock } from '../lib/krStocks.js';

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (ticker: string) => void;
  disabled?: boolean;
}

function matchStock(query: string, stock: KrStock): boolean {
  const q = query.toLowerCase();
  return (
    stock.name.toLowerCase().includes(q) ||
    stock.ticker.toLowerCase().includes(q)
  );
}

function searchKr(query: string): KrStock[] {
  if (query.length < 1) return [];
  const results = KR_STOCKS.filter((s) => matchStock(query, s));
  return results.slice(0, 8);
}

export function TickerInput({ value, onChange, onSubmit, disabled }: Props) {
  const [suggestions, setSuggestions] = useState<KrStock[]>([]);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [showDrop, setShowDrop] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const updateSuggestions = useCallback((q: string) => {
    const trimmed = q.trim();
    if (trimmed.length === 0) {
      setSuggestions([]);
      setShowDrop(false);
      return;
    }
    const hits = searchKr(trimmed);
    setSuggestions(hits);
    setShowDrop(hits.length > 0);
    setActiveIdx(-1);
  }, []);

  useEffect(() => {
    updateSuggestions(value);
  }, [value, updateSuggestions]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setShowDrop(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function pick(stock: KrStock) {
    onChange(stock.ticker);
    setShowDrop(false);
    setSuggestions([]);
    onSubmit(stock.ticker);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!showDrop || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => (i + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault();
      pick(suggestions[activeIdx]);
    } else if (e.key === 'Escape') {
      setShowDrop(false);
    }
  }

  return (
    <div ref={wrapRef} className="relative flex-1">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => { if (suggestions.length > 0) setShowDrop(true); }}
        placeholder="티커 또는 한글 이름 (NVDA, 삼성, 현대...)"
        className="w-full min-h-[44px] px-3 py-2 rounded-lg border border-[#1e293b] bg-[#0a0f1a] text-base text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
        aria-label="티커 또는 종목명"
        autoCapitalize="characters"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        role="combobox"
        aria-expanded={showDrop}
        aria-autocomplete="list"
        aria-activedescendant={activeIdx >= 0 ? `kr-opt-${activeIdx}` : undefined}
      />
      {showDrop && suggestions.length > 0 && (
        <ul
          className="absolute z-50 left-0 right-0 mt-1 max-h-64 overflow-y-auto rounded-lg border border-[#1e293b] bg-[#0f172a] shadow-xl shadow-black/40"
          role="listbox"
        >
          {suggestions.map((s, i) => (
            <li
              key={s.ticker}
              id={`kr-opt-${i}`}
              role="option"
              aria-selected={i === activeIdx}
              onMouseDown={(e) => { e.preventDefault(); pick(s); }}
              onMouseEnter={() => setActiveIdx(i)}
              className={`flex items-center justify-between gap-2 px-3 py-2 cursor-pointer text-sm transition-colors ${
                i === activeIdx
                  ? 'bg-indigo-600/30 text-indigo-200'
                  : 'text-slate-300 hover:bg-[#1e293b]'
              }`}
            >
              <span className="truncate">
                <span className="font-medium">{s.name}</span>
                <span className="ml-2 text-xs text-slate-500">
                  {s.ticker.endsWith('.KS') ? 'KOSPI' : 'KOSDAQ'}
                </span>
              </span>
              <span className="font-mono text-xs text-slate-500 flex-shrink-0">{s.ticker}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
