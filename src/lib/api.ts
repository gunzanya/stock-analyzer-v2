// Frontend → /api/analyze client

import type { AnalysisResult } from './types.js';

export async function fetchAnalysis(ticker: string): Promise<AnalysisResult> {
  const res = await fetch(`/api/analyze?ticker=${encodeURIComponent(ticker)}`);
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { message?: string; error?: string };
      msg = body.message ?? body.error ?? msg;
    } catch {
      // ignore JSON parse
    }
    throw new Error(`${ticker}: ${msg}`);
  }
  return (await res.json()) as AnalysisResult;
}
