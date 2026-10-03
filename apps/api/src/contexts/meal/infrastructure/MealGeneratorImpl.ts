import { MealRuleViolation } from '../domain/error/MealRuleViolation.js';
import type { MealGenerationInput, MealGenerator } from '../domain/port/MealGenerator.js';
import type { GeneratedMeal } from '../domain/value/GeneratedMeal.js';
import {
  RESPONSE_JSON_SCHEMA,
  SYSTEM_PROMPT,
  promptedStockItemsOf,
  userMessageOf,
} from './MealGenerationPrompt.js';
import { parseMealResponse } from './MealResponseParser.js';

/** 生成の要求1件（B-72 5章）。`Request` を書かない（ADR-003）。 */
export type GenerateContentRequest = {
  readonly method: 'POST';
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
};

/** `Response` を書かない（先行 JwksResponse）。 */
export type GenerateContentResponse = {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
};

/** 生成の要求を送る口。既定は実行環境の `fetch`（B-72 5章）。 */
export type FetchGenerateContent = (
  url: string,
  request: GenerateContentRequest,
) => Promise<GenerateContentResponse>;

/** モデル名と API キー（ADR-078 決定4）。どちらも設定から来て、コードに既定値を持たない。 */
export type MealGeneratorSettings = { readonly model: string; readonly apiKey: string };

/** Gemini API の `generateContent` の基点（ADR-078 決定2）。 */
const GENERATE_CONTENT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * 最大出力トークン（prompt-design 7章）。**思考のトークンもこの枠を消費する** — 切り詰めると
 * 打ち切りが JSON の破損として現れる。
 */
const MAX_OUTPUT_TOKENS = 8192;

/**
 * 思考の深さ（ADR-078 決定3）。`low` では避けたい献立と主材料・調理法が同じ献立がすり抜けた
 * ため、試行の結果で `medium` にした（2026-10-03 にユーザーが決定）。
 */
const THINKING_LEVEL = 'medium';

/** 応答が最後まで書き切られたことを示す停止理由。これ以外は本文を読まない（B-72 規則12）。 */
const COMPLETED_FINISH_REASON = 'STOP';

/**
 * Gemini の `generateContent` を呼ぶ献立生成器（B-72 / ADR-078）。`MealGenerator` の腐敗防止層
 * （ADR-005）であり、プロンプト・JSON・モデル名はここから外へ出ない。
 *
 * 失敗の境目（ADR-078 決定5）: **応答は届いたが使える献立が無い**ときは `mealGenerator.empty`。
 * **応答が届かない**（送れない・2xx でない）ときと設定が空のときは素の `Error`（ADR-045）。
 * どちらも再試行しない（ADR-005）。
 */
export class MealGeneratorImpl implements MealGenerator {
  constructor(
    private readonly settings: MealGeneratorSettings,
    private readonly fetchGenerateContent: FetchGenerateContent = fetchFromRuntime,
  ) {}

  async generate(input: MealGenerationInput): Promise<readonly GeneratedMeal[]> {
    // 設定は呼び出し時に検査する。組み立ては空でも投げない（先行 `HouseholdAuthenticatorImpl`）。
    const { model, apiKey } = requireConfiguredSettings(this.settings);

    const userMessage = userMessageOf(input);
    if (userMessage === null) {
      // 載せる在庫が0件なら呼ばない。空の列を返さないのはポートの約束である（D-5 / 8章）。
      throw new MealRuleViolation(
        'mealGenerator.empty',
        '期限内の在庫品が1件も無いため、献立を生成できません',
      );
    }

    // 送れなかった失敗は包み直さずにそのまま伝える（ADR-045 決定2）。
    const response = await this.fetchGenerateContent(
      `${GENERATE_CONTENT_BASE_URL}/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        // キーは URL に載せずヘッダで送る — URL はログに残りやすい（NFR-10）。
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ role: 'user', parts: [{ text: userMessage }] }],
          // 温度は送らない。既定の 1.0 が prompt-design 7章の「高め」と一致する（ADR-078 決定3）。
          generationConfig: {
            responseMimeType: 'application/json',
            responseJsonSchema: RESPONSE_JSON_SCHEMA,
            maxOutputTokens: MAX_OUTPUT_TOKENS,
            thinkingConfig: { thinkingLevel: THINKING_LEVEL },
          },
        }),
      },
    );
    if (!response.ok) {
      // 429（無料枠の上限）もここ。本体は読まず、状態コードだけを載せる（ADR-078 結果2 / ADR-045 結果2）。
      throw new Error(`献立の生成の要求が断られました（状態 ${String(response.status)}）`);
    }

    const text = responseTextOf(await response.json());
    return parseMealResponse(
      text,
      input.requiredCount,
      promptedStockItemsOf(input).map(({ name, amount }) => ({ name, amount })),
    );
  }
}

/** 実行環境の `fetch`。Workers と Node のどちらにもある（ADR-078 決定2）。 */
const fetchFromRuntime: FetchGenerateContent = (url, request) => fetch(url, request);

/** 設定の空を断る。message には空の設定の名前だけを載せ、値は載せない（ADR-045 結果2）。 */
function requireConfiguredSettings(settings: MealGeneratorSettings): MealGeneratorSettings {
  const model = settings.model.trim();
  const apiKey = settings.apiKey.trim();
  if (model === '') throw new Error('献立の生成の設定 GEMINI_MODEL が空です');
  if (apiKey === '') throw new Error('献立の生成の設定 GEMINI_API_KEY が空です');
  return { model, apiKey };
}

/**
 * 応答の封筒から本文を取り出す（B-72 規則12）。候補が無い・停止理由が `STOP` でない・本文が
 * 無いなら `mealGenerator.empty` — 応答は届いたが使える献立が無い（ADR-078 決定5）。
 * 思考の部分（`thought: true`）は本文ではない。
 */
function responseTextOf(body: unknown): string {
  const candidate = firstCandidateOf(body);
  if (candidate === null) {
    throw new MealRuleViolation('mealGenerator.empty', '生成の応答に候補がありません');
  }
  const finishReason = candidate.finishReason;
  if (finishReason !== COMPLETED_FINISH_REASON) {
    throw new MealRuleViolation(
      'mealGenerator.empty',
      `生成の応答が書き切られていません（停止理由 ${typeof finishReason === 'string' ? finishReason : 'なし'}）`,
    );
  }
  const content = candidate.content;
  const parts = isRecord(content) && Array.isArray(content.parts) ? content.parts : [];
  return parts
    .filter(isRecord)
    .filter((part) => part.thought !== true && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('');
}

function firstCandidateOf(body: unknown): Record<string, unknown> | null {
  if (!isRecord(body) || !Array.isArray(body.candidates)) return null;
  const candidate: unknown = body.candidates[0];
  return isRecord(candidate) ? candidate : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
