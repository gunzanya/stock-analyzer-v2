# stock-analyzer-v2

분류 정확도 재설계 + EntryScore 감점 + 섹터 컨텍스트 안전장치.

## Stack

- **Frontend**: Vite + React 19 + TypeScript + Tailwind v4
- **Backend**: Vercel Serverless Functions in `/api` (yahoo-finance2)
- **Deploy**: Vercel

## Scripts

```bash
npm install
npm run dev         # vite dev server (frontend only)
npm run typecheck   # tsc -b --noEmit
npm run build       # tsc -b && vite build
```

For local API testing, use `vercel dev` (requires Vercel CLI).

## Layout

```
api/              Serverless functions (yahoo-finance2)
src/
  lib/
    types.ts          Data model
    stockType.ts      7-type classifier (숫자 70% + 이름 30%)
    typeWeights.ts    Blending rules
    entryScore.ts     Entry score with deductions, capped at 90
    safetyGuard.ts    RS + sector context
    indicators.ts     RS, ADX, OBV, sub-industry mapping
    analyzer.ts       Full pipeline
  components/     UI
```
