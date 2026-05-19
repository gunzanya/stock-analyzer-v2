import type { SafetyGuardResult } from '../lib/types.js';

interface Props {
  safety: SafetyGuardResult;
}

export function SafetyBanner({ safety }: Props) {
  if (!safety.triggered) return null;

  const isCompanySpecific = safety.sectorContext?.startsWith('🚨');
  const isSectorWeak = safety.sectorContext?.includes('이중 역풍');
  const tone =
    isCompanySpecific || isSectorWeak
      ? 'from-red-950/80 to-red-900/40 border-red-700 text-red-100'
      : 'from-amber-950/80 to-amber-900/40 border-amber-700 text-amber-100';

  return (
    <section className={`rounded-xl border bg-gradient-to-r ${tone} p-4`}>
      <div className="flex items-start gap-3">
        <span className="text-2xl flex-shrink-0">🛡️</span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold tracking-wider uppercase opacity-80 mb-1">
            안전장치 발동
          </p>
          <p className="text-sm font-medium leading-relaxed break-words">
            {safety.sectorContext ?? '시장 대비 부진'}
          </p>
          {safety.reasons.length > 0 && (
            <ul className="mt-2 text-[11px] opacity-80 space-y-0.5">
              {safety.reasons.map((r, i) => (
                <li key={i}>· {r}</li>
              ))}
            </ul>
          )}
          {safety.sectorReturn3M != null && safety.stockReturn3M != null && (
            <div className="mt-3 flex gap-4 text-[11px] tabular-nums">
              <span>
                종목 3M{' '}
                <span className="font-bold">
                  {(safety.stockReturn3M * 100).toFixed(1)}%
                </span>
              </span>
              <span>
                섹터 3M{' '}
                <span className="font-bold">
                  {(safety.sectorReturn3M * 100).toFixed(1)}%
                </span>
              </span>
              {safety.excessVsSector != null && (
                <span>
                  Excess{' '}
                  <span className="font-bold">
                    {(safety.excessVsSector * 100).toFixed(1)}%p
                  </span>
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
