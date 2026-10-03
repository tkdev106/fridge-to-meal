// 単価（USD / 1M tokens）。**使う前に、比べたいモデルの公式単価を自分で入れること。**
// ここに多くのモデルを書き写しても必ず古くなる。実際に試すものだけ足す。
// 既定値は要件定義 6.3 の表（Claude）と同じもの。
export const PRICING = {
  'claude-opus-5':    { input: 5.00, output: 25.00 },
  'claude-sonnet-5':  { input: 2.00, output: 10.00 },
  'claude-haiku-4-5': { input: 1.00, output: 5.00 },
  // 有料枠の単価（2026-10-03 に公式の資料で確かめた。ADR-078）。無料枠の間は実際には掛からない。
  'gemini-3.5-flash-lite': { input: 0.30, output: 2.50 },
};

export const USD_JPY = 150;

/** 単価が未登録なら null を返す。summary.md では「-」として出る。 */
export function estimateCost(model, inputTokens, outputTokens) {
  const p = PRICING[model];
  if (!p) return null;
  const usd = (inputTokens / 1e6) * p.input + (outputTokens / 1e6) * p.output;
  return { usd, jpy: usd * USD_JPY };
}
