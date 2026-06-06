import { useEffect, useState } from 'react';
import { fetchSectorRegime } from '../lib/api.js';
import { findSectorForStock, type SectorEntry } from '../lib/sectorRegime.js';
import type { FundamentalData } from '../lib/types.js';

const STATUS = {
  leading: { ko: '주도', emoji: '🟢', tone: 'border-emerald-700/50 bg-emerald-900/20 text-emerald-200' },
  neutral: { ko: '중립', emoji: '🟡', tone: 'border-amber-700/50 bg-amber-900/20 text-amber-200' },
  lagging: { ko: '부진', emoji: '🔴', tone: 'border-red-700/60 bg-red-900/25 text-red-200' },
} as const;

interface Props {
  fund: Pick<FundamentalData, 'ticker' | 'sector' | 'industry'>;
}

/** Per-stock sector status badge. Maps the stock's sector/industry to a tracked
 *  ETF and surfaces that ETF's regime score, with a 진입 신중 warning when the
 *  sector is lagging. Renders nothing for unmapped stocks (e.g. Korean tickers)
 *  or while the regime is still loading/failed. */
export function SectorBadge({ fund }: Props) {
  const [entry, setEntry] = useState<SectorEntry | null>(null);

  useEffect(() => {
    let alive = true;
    fetchSectorRegime()
      .then((r) => {
        if (alive) setEntry(findSectorForStock(r, fund));
      })
      .catch(() => {
        /* stay quiet — badge is a helper, not core data */
      });
    return () => {
      alive = false;
    };
  }, [fund]);

  if (!entry) return null;

  const meta = STATUS[entry.status];
  return (
    <div className="space-y-1.5">
      <span
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${meta.tone}`}
      >
        섹터({entry.label}): {meta.emoji} {meta.ko} {entry.score}
      </span>
      {entry.status === 'lagging' && (
        <p className="text-[11px] text-red-300/90 leading-relaxed">
          ⚠️ 섹터 부진 — 진입 신중 (종목이 좋아도 섹터 로테이션 역풍)
        </p>
      )}
    </div>
  );
}
