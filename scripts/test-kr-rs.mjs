// Verify Korean-ticker RS uses absolute 1Y return.
import { analyzeOne } from '../api/analyze.ts';

const tickers = ['003230.KS', '005930.KS', '035720.KS'];
for (const t of tickers) {
  try {
    const r = await analyzeOne(t);
    const r1y = r.indicators.return1y;
    const r90 = r.indicators.return90d;
    console.log(
      `${t} ${r.fundamental.name}  |  bench=${r.indicators.subIndustryEtf}  |  1Y=${
        r1y != null ? (r1y * 100).toFixed(1).padStart(6) + '%' : '   —  '
      }  |  3M=${
        r90 != null ? (r90 * 100).toFixed(1).padStart(6) + '%' : '   —  '
      }  |  RS=${r.indicators.rs?.toFixed(1)}`,
    );
  } catch (e) {
    console.log(`${t} FAILED: ${e.message}`);
  }
}
