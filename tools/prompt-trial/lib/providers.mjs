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
    // アプリ本体（MealGeneratorImpl）と同じ名前で読む（ADR-078 決定4）。
    envKey: 'GEMINI_API_KEY',
    defaultModel: 'gemini-3.5-flash-lite',
    async generate({ model, system, user, maxTokens, effort, schema, temperature }) {
      const generationConfig = { maxOutputTokens: maxTokens };
      if (temperature !== undefined) generationConfig.temperature = temperature;
      // 思考の深さを anthropic の effort と揃える（第7章「浅く」）。送らないとモデルの既定になり、
      // 出力トークンと応答時間が比べられなくなる。
      if (effort) generationConfig.thinkingConfig = { thinkingLevel: effort };
      if (schema) {
        // responseJsonSchema は JSON Schema をそのまま受け取る（responseSchema と違い
        // additionalProperties を落とさなくてよい）。アプリ本体と同じ送り方にする。
        generationConfig.responseMimeType = 'application/json';
        generationConfig.responseJsonSchema = schema;
      }
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig,
        }),
      });
      const data = await jsonOrThrow(res, 'google');
      const cand = data.candidates?.[0];
      // 思考の要約（thought: true）は応答の本文ではない。
      const text = (cand?.content?.parts ?? [])
        .filter((p) => !p.thought)
        .map((p) => p.text ?? '')
        .join('');
      return {
        text,
        usage: {
          input: data.usageMetadata?.promptTokenCount ?? null,
          // 思考のトークンも出力として課金されるので足す。
          output:
            data.usageMetadata?.candidatesTokenCount == null
              ? null
              : data.usageMetadata.candidatesTokenCount + (data.usageMetadata.thoughtsTokenCount ?? 0),
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
