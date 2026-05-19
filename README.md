# stock-analyzer-v2

7가지 유형 분류 + Entry Score + 섹터 컨텍스트 안전장치.
라이브 검증 **29/30 (97%)** 통과.

## Stack

- **Frontend**: Vite + React 19 + TypeScript + Tailwind v4
- **Backend**: Vercel Serverless Functions in `/api` (yahoo-finance2 v3)
- **Deploy**: Vercel (auto-detect via `vercel.json`)

## Scripts

```bash
npm install

# Dev (two processes — Vite proxies /api → dev-api server)
npx tsx scripts/dev-api.mjs   # terminal 1: API on :3001
npm run dev                    # terminal 2: SPA on :5173

# Production
npm run typecheck             # tsc -b --noEmit
npm run build                 # tsc -b && vite build → dist/
```

For a single-terminal dev workflow, run both concurrently:
```bash
(npx tsx scripts/dev-api.mjs &) && npm run dev
```

## Deploy

Push to a Git repo connected to Vercel and it builds automatically.
Or via CLI:
```bash
npx vercel --prod
```

`vercel.json` configures the framework hint, function memory (1GB)
and timeout (30s), and edge cache headers (5min s-maxage).

## Verification scripts

```bash
npx tsx scripts/test-30.mjs    # full 30-ticker classifier validation
npx tsx scripts/test-classify.mjs  # 12-ticker smoke test
npx tsx scripts/test-safety-entry.mjs  # 4-ticker safety + entry check
npx tsx scripts/probe.mjs NVDA AAPL   # raw fundamentals for a ticker
```

## Layout

```
api/                Serverless functions (yahoo-finance2)
  fetchStock.ts     Pulls fundamentals + balance sheet + price history
  analyze.ts        Unified endpoint → AnalysisResult

src/lib/            Pure logic shared by API + frontend
  types.ts          Data model
  stockType.ts      7-type 0-100 scoring with disqualification rules
  typeWeights.ts    Blend rules (top-2 within 20pt → blend)
  indicators.ts     RS, ADX, OBV divergence, sub-industry ETF map
  safetyGuard.ts    RS-triggered + 4 sector-context labels
  entryScore.ts     Gains + deductions, capped at 90

src/components/
  StockCard.tsx     Mobile-responsive card with score, banner, metrics

scripts/
  dev-api.mjs       Local /api server (mirrors Vercel Functions)
  test-30.mjs       Full validation
  probe-*.mjs       Diagnostic probes for Yahoo Finance fields
```

## 7가지 유형

| 이모지 | 유형 | 본질 |
|---|---|---|
| 🚀 | FAST_GROWER | EPS+매출 동시 성장, 적자 이력 없음 |
| 🏛️ | STALWART | 메가캡, 안정 8-25% 성장, ROE/마진 좋음 |
| 💰 | SLOW_GROWER | 배당 ≥ 3%, 성장 둔화 |
| 🔄 | CYCLICAL | 영업이익률 변동, 원자재/철강/자동차 산업 |
| 🔃 | TURNAROUND | 적자 → 흑자 회복 (분기 OR 3년 윈도우 연간) |
| 🏗️ | ASSET_PLAY | 지주사, 낮은 PBR, 매출/자산 < 0.1 |
| 🎰 | SPECULATIVE | 4Q 연속 영업적자 + 고PSR, 밈주 등 |

블렌딩: 1·2위 둘 다 ≥40점 AND 차이 ≤20점이면 비율 표시.
