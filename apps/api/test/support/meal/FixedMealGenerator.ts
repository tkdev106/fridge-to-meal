import type {
  MealGenerationInput,
  MealGenerator,
} from '../../../src/contexts/meal/domain/port/MealGenerator.js';
import type { GeneratedMeal } from '../../../src/contexts/meal/domain/value/GeneratedMeal.js';
import { MealRuleViolation } from '../../../src/contexts/meal/domain/error/MealRuleViolation.js';

/**
 * 1回の呼び出しで起きること（B-78 5章）。**返す生成結果の列か、投げる例外のどちらか一方**である
 * （先行 `FixedStockItemUsecases` の応答）。投げる例外は呼び出し側が作って握る — そのまま
 * 伝わることを `toBe` で断定できるようにするためである。
 */
export type MealGenerationOutcome =
  { readonly returns: readonly GeneratedMeal[] } | { readonly throws: unknown };

/**
 * あらかじめ決めた生成結果を返す記憶上の献立生成器（B-15 設計書 5章）。
 *
 * 本物は外へ問い合わせる出口であり、そのままでは呼ぶ側のテストが外の都合に縛られる
 * （ADR-005 / `docs/testing.md` 2章）。`vi.mock` で差し替えず、**interface の記憶上の実装**を
 * 書くのは、型が合っていることまで一緒に確かめられるためである。
 *
 * **interface では強制できない契約4つを、実装として持つのはここである**
 * （B-15 6章 規則4〜7 / 7章1行目）。
 *
 * - 用意した生成結果が0件なら `MealRuleViolation('mealGenerator.empty', …)` を投げる
 * - 同じ `title` を2件以上返さない（先に出たほうを残す）
 * - `requiredCount` を超えた分は**先頭から**切る。**同じ名称を落とすのが先、切るのが後である**
 *   （B-15 規則7 / prompt-design 6.1 段階5 / 6.4 が切るのは「検証を通った」ものだから）
 * - 並べ替えない。用意した並びのまま返す
 *
 * **呼ぶ回ごとに別のことを起こせる**（B-78 5章）。作り直し（ADR-089 決定4）は同じ生成器を
 * 2回呼ぶので、1回目と2回目で返すものを変えられないと作り直しを確かめられない。
 * コンストラクタに生成結果を並べる書き方は「どの回も同じ結果を返す」であり、回ごとに
 * 変えるときは `byCall` を使う。**用意した回を超えて呼ばれたら最後の回と同じことを起こす** —
 * 投げずに通しておけば、誤って呼ばれた回も最後まで進み、落ちるのは回数の断定だけになる
 * （`docs/testing.md` 2章）。
 *
 * **`receivedInputs` を持つのは、生成に何を渡したかを観察する口が他に無いからである**
 * （B-28 規則3〜8 / B-78 規則10）。渡した在庫スナップショット・件数・避けるべき名称・基準日時は
 * 出口の向こうへ行ってしまい、呼ぶ側の返り値からは見えない。**`receivedInput` は1回目の入力**を
 * 返す — 作り直しが入っても、生成に最初に渡したものを見る既存のテストの意味を変えないためで
 * ある（B-78 8章）。一度も呼ばれていなければ `null` である。
 *
 * **`callCount` を持つのは、呼ばれないこと自体が要件だからである**（C-7 / C-15）。
 * `vi.fn()` で数えず、**記憶上の実装の状態として観察する**（`docs/testing.md` 2章 /
 * 先行 `FixedHouseholdAuthenticator`）。呼び出しの回数を見てよいのはこの2つの規則のときと、
 * 作り直しを1回に限る規則（ADR-089 決定4）のときだけで、それ以外の回数は実装の都合である（同3章）。
 *
 * **`requiredCount` が1未満のときは契約の外である**（B-15 規則8）。この代役は切った結果が0件になり
 * `mealGenerator.empty` を投げるが、それは契約が定めた振る舞いではない — 呼ぶ側が誤って0を渡すと
 * 「生成できなかった」と区別がつかない。
 */
export class FixedMealGenerator implements MealGenerator {
  #outcomes: readonly MealGenerationOutcome[];
  readonly #receivedInputs: MealGenerationInput[] = [];

  /** どの回も同じ生成結果を返す。 */
  constructor(...preparedGeneratedMeals: readonly GeneratedMeal[]) {
    this.#outcomes = [{ returns: preparedGeneratedMeals }];
  }

  /** 呼ぶ回ごとに起こすことを並べる。用意した回を超えたら最後の回と同じことを起こす。 */
  static byCall(...outcomes: readonly MealGenerationOutcome[]): FixedMealGenerator {
    const mealGenerator = new FixedMealGenerator();
    mealGenerator.#outcomes = outcomes;
    return mealGenerator;
  }

  /** 何度呼ばれたか。**呼ばれないこと**が要件のときだけ見る（C-7 / C-15 / `docs/testing.md` 2章）。 */
  get callCount(): number {
    return this.#receivedInputs.length;
  }

  /** 1回目に受け取った入力。まだ一度も呼ばれていなければ `null`（B-28 5章 / B-78 8章）。 */
  get receivedInput(): MealGenerationInput | null {
    return this.#receivedInputs[0] ?? null;
  }

  /** 受け取った入力を、呼ばれた順に全回ぶん（B-78 5章）。 */
  get receivedInputs(): readonly MealGenerationInput[] {
    return [...this.#receivedInputs];
  }

  async generate(input: MealGenerationInput): Promise<readonly GeneratedMeal[]> {
    // 受け取った入力は投げるより先に控える。**呼ばれたことも何を渡したかも、投げても事実である**
    // （B-28 規則18 / 先行 `FixedHouseholdAuthenticator`）。後で控えると、投げた回に「呼ばれて
    // いない」「何も渡していない」と見えてしまい、C-7 と C-15 の番人が務まらない。
    this.#receivedInputs.push(input);

    const outcome = this.#outcomeOf(this.#receivedInputs.length);
    if ('throws' in outcome) {
      throw outcome.throws;
    }

    // 読むのは `requiredCount` だけである。在庫スナップショット・避けるべき名称・基準日時は
    // 本物が生成の材料にするものであって、代役が返すものを変える根拠にはならない
    // （B-15 規則9・10。上限50件も在庫0件もここでは拒まない）。
    const distinctTitleGeneratedMeals = dropDuplicateTitles(outcome.returns);

    // 落としてから切る。逆にすると、同名を含む4件を `requiredCount: 3` で渡したときに
    // 先頭3件を採ってから重複が落ちて2件になり、通せたはずの1件を落とす（B-15 規則7）。
    const toReturn = distinctTitleGeneratedMeals.slice(0, input.requiredCount);

    if (toReturn.length === 0) {
      // 0件で返さない（B-15 規則5 / 7章1行目）。空の列で返すと、呼ぶ側が「生成が失敗した」と
      // 「生成するものが無かった」を見分けられない。**投げるのは0件のときだけ**であり、
      // `requiredCount` に満たないだけなら得られた件数で返す（B-15 規則4 / C-15）。
      throw new MealRuleViolation('mealGenerator.empty', '生成結果が1件もありません');
    }

    return toReturn;
  }

  /** `callNumber` 回目（1始まり）に起こすこと。用意した回を超えたら最後の回のものを使う。 */
  #outcomeOf(callNumber: number): MealGenerationOutcome {
    const outcome = this.#outcomes[Math.min(callNumber, this.#outcomes.length) - 1];
    if (outcome === undefined) {
      throw new Error('生成器に起こすことが1つも用意されていない');
    }
    return outcome;
  }
}

/**
 * 同じ `title` の生成結果を1件に畳む（B-15 規則7 / C-13）。残すのは**先に出たほう**である。
 *
 * 先頭から順に拾うだけで、並べ替えも優先順位づけもしない — 用意した並びがそのまま返る
 * （B-15 規則6。ポートは順位を約束しないので、代役が順位をつけると呼ぶ側のテストが
 * 契約に無い並びに寄りかかる）。名称は正規化せずそのまま比べる。`GeneratedMeal` が
 * 生成のときに前後の空白を落としているため、ここで畳み直すと二重の正規化になる。
 */
function dropDuplicateTitles(generatedMeals: readonly GeneratedMeal[]): readonly GeneratedMeal[] {
  const seenTitles = new Set<string>();
  const remaining: GeneratedMeal[] = [];
  for (const generatedMeal of generatedMeals) {
    if (seenTitles.has(generatedMeal.title)) continue;
    seenTitles.add(generatedMeal.title);
    remaining.push(generatedMeal);
  }
  return remaining;
}
