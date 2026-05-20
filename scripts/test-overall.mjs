// Verify the new Overall = Fundamental*0.55 + Timing*0.45 blend.
// Usage: npx tsx scripts/test-overall.mjs

import { analyzeOne } from '../api/analyze.ts';

const TICKERS = ['GOOG', 'LLY', 'RIVN'];

for (const t of TICKERS) {
  try {
    const r = await analyzeOne(t);
    const f = r.fundamentalScore;
    const ti = r.timingScore;
    const o = r.overallScore;
    const timingPct = Math.round((ti.score / 90) * 100);
    const manual = Math.round(f.score * 0.55 + timingPct * 0.45);
    console.log(
      `${t.padEnd(5)} 종합 ${o.score.toString().padStart(2)} (${o.level.padEnd(7)}) ← 펀더 ${f.score.toString().padStart(2)} × 0.55 + 타이밍 ${timingPct.toString().padStart(2)}/100 × 0.45 = ${manual} ✓`,
    );
  } catch (e) {
    console.log(`💥 ${t}: ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 300));
}
