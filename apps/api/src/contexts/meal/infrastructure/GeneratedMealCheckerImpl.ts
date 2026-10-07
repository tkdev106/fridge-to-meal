import type {
  GeneratedMealCheckInput,
  GeneratedMealChecker,
} from '../domain/port/GeneratedMealChecker.js';
import type { GeneratedMeal } from '../domain/value/GeneratedMeal.js';

/** 確かめの要求1件（B-78 5章）。`Request` を書かない（ADR-003）。 */
export type JevAnswersRequest = {
  readonly method: 'POST';
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly signal: AbortSignal;
};

/** `Response` を書かない（先行 GenerateContentResponse）。 */
export type JevAnswersResponse = {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
};

/** 確かめの要求を送る口。既定は実行環境の `fetch`（B-78 5章）。 */
export type FetchJevAnswers = (
  url: string,
  request: JevAnswersRequest,
) => Promise<JevAnswersResponse>;

/** Jev の鍵（ADR-089 決定3）。 */
export type GeneratedMealCheckerSettings = { readonly apiKey: string };

/** Jev の判定の口（ADR-089 状況）。 */
const JEV_ANSWERS_URL = 'https://api.typesafe.ai/v1/systemone';

const JEV_MODEL = 'jev-latest';

/** これ以上の確率で同じ・似ているとみなす（ADR-089 決定2(b)(c)）。 */
const DROP_THRESHOLD = 0.5;

/** 応答の本体を読み終えるまでの上限（ADR-089 決定3）。 */
const CHECK_TIMEOUT_MS = 3_000;

/** 確かめを飛ばした理由（B-78 規則8）。 */
type SkipReason = 'apiKeyEmpty' | 'timeout' | 'requestFailed' | 'httpStatus' | 'unreadable';

/** Jev への問い1つ。確率で答える型 noul で問う（B-78 規則4）。 */
type Question = { readonly type: 'noul'; readonly instructions: string };

/**
 * 生成結果を保存の前に確かめる（ADR-089 決定1〜3）。名称の重複はここで数え、避けたい献立との
 * 重複と同じ提案の中の似通いは Jev に問う。Jev を使えない回は名称の判定の結果だけを返し、投げない。
 */
export class GeneratedMealCheckerImpl implements GeneratedMealChecker {
  constructor(
    private readonly settings: GeneratedMealCheckerSettings,
    private readonly fetchJevAnswers: FetchJevAnswers = fetchFromRuntime,
    private readonly warn: (line: string) => void = (line) => {
      console.warn(line);
    },
    private readonly info: (line: string) => void = (line) => {
      console.info(line);
    },
  ) {}

  async check(input: GeneratedMealCheckInput): Promise<readonly GeneratedMeal[]> {
    const passed = input.generatedMeals.filter((generatedMeal) => {
      if (!repeatsMainName(generatedMeal)) return true;
      this.dropped(`repeatsMainName title=${generatedMeal.title}`);
      return false;
    });
    const questions = questionsOf(passed.length, input.avoidTitles.length);
    if (Object.keys(questions).length === 0) return passed;

    const apiKey = this.settings.apiKey.trim();
    if (apiKey === '') return this.skipped(passed, 'apiKeyEmpty');

    // AbortSignal.timeout を使わない — 本体の読み出しまでを同じ上限に含めたい（B-78 規則7）。
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(new Error('Jev の応答が3秒以内に届きませんでした'));
    }, CHECK_TIMEOUT_MS);
    try {
      const answered = await this.requestAnswers(
        apiKey,
        {
          meals: numbered(
            'm',
            passed.map((generatedMeal) => generatedMeal.title),
          ),
          avoid: numbered('a', input.avoidTitles),
        },
        questions,
        controller.signal,
      );
      if (typeof answered === 'string') return this.skipped(passed, answered);
      return keptBy(passed, input.avoidTitles, answered, (line) => {
        this.dropped(line);
      });
    } finally {
      clearTimeout(timer);
    }
  }

  /** 読めた答え（問いの鍵ごとの確率）か、飛ばす理由を返す。 */
  private async requestAnswers(
    apiKey: string,
    state: { meals: Record<string, string>; avoid: Record<string, string> },
    questions: Readonly<Record<string, Question>>,
    signal: AbortSignal,
  ): Promise<ReadonlyMap<string, number> | SkipReason> {
    let response: JevAnswersResponse;
    try {
      response = await this.fetchJevAnswers(JEV_ANSWERS_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        // 載せるのは名称だけ。材料・手順・在庫・世帯は外へ出さない（NFR-11）。
        body: JSON.stringify({ model: JEV_MODEL, state, questions }),
        signal,
      });
    } catch {
      return signal.aborted ? 'timeout' : 'requestFailed';
    }
    if (!response.ok) return 'httpStatus';

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return signal.aborted ? 'timeout' : 'unreadable';
    }
    return answersOf(body, Object.keys(questions)) ?? 'unreadable';
  }

  /** 落とした献立を残す（ADR-090）。載せるのは名称・理由・確率だけで、材料・在庫・世帯は載せない。 */
  private dropped(detail: string): void {
    this.info(`meal.generatedMealCheck.dropped ${detail}`);
  }

  private skipped(passed: readonly GeneratedMeal[], reason: SkipReason): readonly GeneratedMeal[] {
    // 献立名・鍵・状態コード・応答本体は載せない（B-78 規則8）。
    this.warn(`meal.generatedMealCheck.skipped ${reason}`);
    return passed;
  }
}

/** 実行環境の `fetch`。 */
const fetchFromRuntime: FetchJevAnswers = (url, request) => fetch(url, request);

/** 主材料のどれかの名前が名称に2回以上現れるか（ADR-089 決定2(a)）。C-16: 調味料は見ない。 */
function repeatsMainName(generatedMeal: GeneratedMeal): boolean {
  return generatedMeal.ingredients
    .filter((ingredient) => ingredient.kind === 'main')
    .some((ingredient) => generatedMeal.title.split(ingredient.name).length - 1 >= 2);
}

function numbered(prefix: string, titles: readonly string[]): Record<string, string> {
  return Object.fromEntries(titles.map((title, index) => [`${prefix}${String(index + 1)}`, title]));
}

function sameKey(mealNumber: number, avoidNumber: number): string {
  return `same_m${String(mealNumber)}_a${String(avoidNumber)}`;
}

function similarKey(earlierNumber: number, laterNumber: number): string {
  return `similar_m${String(earlierNumber)}_m${String(laterNumber)}`;
}

/** (b) は献立 × 避けたい献立の全組、(c) は献立どうしの全組（ADR-089 決定2）。 */
function questionsOf(mealCount: number, avoidCount: number): Record<string, Question> {
  const questions: Record<string, Question> = {};
  for (let i = 1; i <= mealCount; i++) {
    for (let j = 1; j <= avoidCount; j++) {
      questions[sameKey(i, j)] = {
        type: 'noul',
        instructions: `Is \`meals.m${String(i)}\` the same dish as \`avoid.a${String(j)}\`, only written differently? Answer yes when the main ingredients and the cooking method are the same and the names differ only in wording, word order, or adjectives (for example 「鶏むね肉のトマト煮」 and 「鶏むね肉とトマトの煮込み」). Answer no when the main ingredient or the cooking method differs (for example 「鶏むね肉のトマト煮」 and 「鶏むね肉の照り焼き」).`,
      };
    }
  }
  for (let i = 1; i <= mealCount; i++) {
    for (let j = i + 1; j <= mealCount; j++) {
      questions[similarKey(i, j)] = {
        type: 'noul',
        instructions: `Are \`meals.m${String(i)}\` and \`meals.m${String(j)}\` similar dishes? Answer yes when both the main ingredient and the cooking method are the same. Answer no when the main ingredient or the cooking method differs (for example 「鶏むね肉のトマト煮」 and 「鶏むね肉の照り焼き」).`,
      };
    }
  }
  return questions;
}

/** 送った問いの鍵すべてに数があるときだけ読める。1つでも欠ければ null（B-78 規則5）。 */
function answersOf(body: unknown, keys: readonly string[]): ReadonlyMap<string, number> | null {
  if (!isRecord(body) || !isRecord(body.answers)) return null;
  const answers = body.answers;
  const noulByKey = new Map<string, number>();
  for (const key of keys) {
    const answer = answers[key];
    if (!isRecord(answer) || typeof answer.noul !== 'number') return null;
    noulByKey.set(key, answer.noul);
  }
  return noulByKey;
}

/**
 * 先頭から1件ずつ、避けたい献立と同じなら落とし、前にある残した献立と似ていれば落とす
 * （ADR-089 決定2(b)(c)）。落とした献立は後ろとの比較に使わない。
 */
function keptBy(
  passed: readonly GeneratedMeal[],
  avoidTitles: readonly string[],
  noulByKey: ReadonlyMap<string, number>,
  dropped: (detail: string) => void,
): readonly GeneratedMeal[] {
  const noulOf = (key: string): number => noulByKey.get(key) ?? 0;
  const keptNumbers: number[] = [];
  return passed.filter((generatedMeal, index) => {
    const number = index + 1;
    const avoidIndex = avoidTitles.findIndex(
      (_, i) => noulOf(sameKey(number, i + 1)) >= DROP_THRESHOLD,
    );
    if (avoidIndex >= 0) {
      const p = noulOf(sameKey(number, avoidIndex + 1));
      dropped(
        `sameAsAvoid title=${generatedMeal.title} avoid=${String(avoidTitles[avoidIndex])} p=${String(p)}`,
      );
      return false;
    }
    const earlierNumber = keptNumbers.find(
      (keptNumber) => noulOf(similarKey(keptNumber, number)) >= DROP_THRESHOLD,
    );
    if (earlierNumber !== undefined) {
      const p = noulOf(similarKey(earlierNumber, number));
      dropped(
        `similarToEarlier title=${generatedMeal.title} earlier=${String(passed[earlierNumber - 1]?.title)} p=${String(p)}`,
      );
      return false;
    }
    keptNumbers.push(number);
    return true;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
