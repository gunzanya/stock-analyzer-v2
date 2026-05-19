import { fetchPriceHistory } from '../api/fetchStock.ts';

const t = process.argv[2] ?? 'NVDA';
const bars = await fetchPriceHistory(t);
console.log(`${t}: ${bars.length} bars, newest=${bars[0].date} close=${bars[0].close} vol=${bars[0].volume}, oldest=${bars[bars.length - 1].date}`);
