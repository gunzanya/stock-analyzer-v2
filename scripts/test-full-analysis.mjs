// Sanity test: full AnalysisResult shape for one ticker
import { analyzeOne } from '../api/analyze.ts';

const ticker = process.argv[2] ?? 'NVDA';
const r = await analyzeOne(ticker);
console.log(`=== ${r.fundamental.ticker} (${r.fundamental.name}) ===`);
console.log(`Classification: ${r.classification.display} · confidence ${r.classification.confidence}`);
console.log(`Fundamental:     ${r.fundamentalScore.score} (${r.fundamentalScore.level})`);
console.log(`Timing:     ${r.timingScore.score} (${r.timingScore.level})`);
console.log(`Safety:         ${r.safetyGuard.triggered ? '🛡️ ' + r.safetyGuard.sectorContext : 'OK'}`);
console.log('\n--- CANSLIM 12 ---');
for (const item of r.canslim.items) {
  const bar = '█'.repeat(Math.round(item.score / 5)).padEnd(20, '·');
  const star = item.starredForTypes.includes(r.classification.primary) ? ' ⭐' : '';
  console.log(`  ${item.key} ${bar} ${item.score.toString().padStart(3)}  ${item.label}${star}`);
}
console.log('\n--- Strategy ---');
console.log(`  Entry ${r.strategy.entry} → Stop ${r.strategy.stop} → T1 ${r.strategy.target1} (R:R ${r.strategy.riskReward1}) → T2 ${r.strategy.target2} (R:R ${r.strategy.riskReward2})`);
console.log(`  ATR14: ${r.strategy.atr14}`);
console.log(`  Rule:  ${r.strategy.stopRule}`);
console.log('\n--- Top contributors ---');
for (const c of r.fundamentalScore.topContributors) {
  console.log(`  ${c.label}: score ${c.score} × weight ${c.weight}%`);
}
console.log('\n--- Bottom contributors ---');
for (const c of r.fundamentalScore.bottomContributors) {
  console.log(`  ${c.label}: score ${c.score} × weight ${c.weight}%`);
}
console.log('\n--- Risk factors ---');
for (const rf of r.riskFactors) {
  console.log(`  [${rf.severity}] ${rf.message}`);
}
console.log('\n--- Type insight ---');
console.log(`  핵심: ${r.typeInsight.coreQuestions[0]}`);
console.log(`  논리: ${r.typeInsight.thesis.slice(0, 80)}...`);
console.log(`  매도 신호 ${r.typeInsight.sellSignals.length}개`);
console.log(`\nPrice bars: ${r.priceBars.length} | EMA20=${r.indicators.ema20?.toFixed(2)} SMA50=${r.indicators.sma50?.toFixed(2)} SMA200=${r.indicators.sma200?.toFixed(2)}`);
