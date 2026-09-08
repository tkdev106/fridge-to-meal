// プロバイダごとの差を、ここ1ファイルに閉じる。
// 公式 SDK ではなく素の HTTP を使っているのは、3社を同じ形で比べるためと、
// このリポジトリにまだ package.json がないため。アプリ本体はこの限りでない。

const jsonOrThrow = async (res, label) => {
  const text = await res.text();
  if (!res.ok) throw new Error(`${label} ${res.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text);
};

export const PROVIDERS = {
  /* ------------------------------------------------------------------ */
  anthropic: {
    envKey: 'ANTHROPIC_API_KEY',
    defaultModel: 'claude-opus-5',
    // Opus 5 / Sonnet 5 は temperature を受け付けない（400 になる）。
    // 多様性は avoidTitles で作る。第7章の温度の記述はこの制約に合わせて読むこと。
    supportsTemperature: (model) => /haiku|4-6/.test(model),

    async generate({ model, system, user, maxTokens, effort, schema, temperature }) {
      const body = {
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
      };
      if (effort) body.output_config = { effort };
      if (schema) {
        body.output_config = { ...(body.output_config ?? {}), format: { type: 'json_schema', schema } };
      }
      if (temperature !== undefined && PROVIDERS.anthropic.supportsTemperature(model)) {
        body.temperature = temperature;
      }
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });
      const data = await jsonOrThrow(res, 'anthropic');
      const text = (data.content ?? [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('');
      return {
        text,
        usage: {
          input: data.usage?.input_tokens ?? null,
          output: data.usage?.output_tokens ?? null,
          cacheRead: data.usage?.cache_read_input_tokens ?? 0,
        },
        stopReason: data.stop_reason ?? null,
      };
    },

    // 入力トークンの実測（第10章）。生成せずに測れる唯一の経路。
    async countTokens({ model, system, user }) {
      const res = await fetch('https://api.anthropic.com/v1/messages/count_tokens', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({ model, system, messages: [{ role: 'user', content: user }] }),
      });
      const data = await jsonOrThrow(res, 'anthropic count_tokens');
      return data.input_tokens;
    },
  },

  /* ------------------------------------------------------------------ */
  google: {
    envKey: 'GOOGLE_API_KEY',
    defaultModel: 'gemini-2.5-flash',
    async generate({ model, system, user, maxTokens, schema, temperature }) {
      const generationConfig = { maxOutputTokens: maxTokens };
      if (temperature !== undefined) generationConfig.temperature = temperature;
      if (schema) {
        generationConfig.responseMimeType = 'application/json';
        generationConfig.responseSchema = toGeminiSchema(schema);
      }
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GOOGLE_API_KEY },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig,
        }),
      });
      const data = await jsonOrThrow(res, 'google');
      const cand = data.candidates?.[0];
      const text = (cand?.content?.parts ?? []).map((p) => p.text ?? '').join('');
      return {
        text,
        usage: {
          input: data.usageMetadata?.promptTokenCount ?? null,
          output: data.usageMetadata?.candidatesTokenCount ?? null,
          cacheRead: data.usageMetadata?.cachedContentTokenCount ?? 0,
        },
        stopReason: cand?.finishReason ?? null,
      };
    },
  },

  /* ------------------------------------------------------------------ */
  openai: {
    envKey: 'OPENAI_API_KEY',
    defaultModel: 'gpt-5.6-luna',
    async generate({ model, system, user, maxTokens, schema, temperature }) {
      const body = {
        model,
        max_completion_tokens: maxTokens,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      };
      if (temperature !== undefined) body.temperature = temperature;
      if (schema) {
        body.response_format = {
          type: 'json_schema',
          json_schema: { name: 'meals', strict: true, schema },
        };
      }
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify(body),
      });
      const data = await jsonOrThrow(res, 'openai');
      return {
        text: data.choices?.[0]?.message?.content ?? '',
        usage: {
          input: data.usage?.prompt_tokens ?? null,
          output: data.usage?.completion_tokens ?? null,
          cacheRead: data.usage?.prompt_tokens_details?.cached_tokens ?? 0,
        },
        stopReason: data.choices?.[0]?.finish_reason ?? null,
      };
    },
  },
};

/** Gemini の responseSchema は OpenAPI 由来で additionalProperties を受け付けない。 */
function toGeminiSchema(node) {
  if (Array.isArray(node)) return node.map(toGeminiSchema);
  if (node === null || typeof node !== 'object') return node;
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === 'additionalProperties') continue;
    out[k] = toGeminiSchema(v);
  }
  return out;
}
