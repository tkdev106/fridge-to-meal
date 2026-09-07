// 単価（USD / 1M tokens）。出典と日付を必ず添える。ここが古いと費用の比較が狂う。
// Anthropic: 一次情報（claude-api リファレンス, 2026-06-24 時点のキャッシュ）
// Google / OpenAI: 二次情報（2026-09 時点の公開記事）。公式ページで確認してから使うこと。
export const PRICING = {
  'claude-opus-5':     { input: 5.00, output: 25.00, source: 'anthropic-ref' },
  'claude-sonnet-5':   { input: 2.00, output: 10.00, source: 'anthropic-ref' },
  'claude-haiku-4-5':  { input: 1.00, output: 5.00,  source: 'anthropic-ref' },
  'gemini-3.1-pro':    { input: 2.00, output: 12.00, source: 'web-2026-09 要確認' },
  'gemini-3.8-flash':  { input: 0.75, output: 3.75,  source: 'web-2026-09 要確認（導入価格）' },
  'gemini-2.5-flash':  { input: 0.30, output: 2.50,  source: 'web-2026-09 要確認' },
  'gpt-5.6-terra':     { input: 2.00, output: 12.00, source: 'web-2026-09 要確認' },
  'gpt-5.6-luna':      { input: 0.20, output: 1.20,  source: 'web-2026-09 要確認' },
};

export const USD_JPY = 150;

export function estimateCost(model, inputTokens, outputTokens) {
  const p = PRICING[model];
  if (!p) return null;
  const usd = (inputTokens / 1e6) * p.input + (outputTokens / 1e6) * p.output;
  return { usd, jpy: usd * USD_JPY, source: p.source };
}
