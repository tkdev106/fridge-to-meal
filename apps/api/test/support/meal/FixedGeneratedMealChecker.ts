import type {
  GeneratedMealCheckInput,
  GeneratedMealChecker,
} from '../../../src/contexts/meal/domain/port/GeneratedMealChecker.js';
import type { GeneratedMeal } from '../../../src/contexts/meal/domain/value/GeneratedMeal.js';

/**
 * 決めた名称だけを落とす記憶上の生成結果の確かめ（B-78 5章 / ADR-089 決定1）。
 *
 * 本物は外へ問い合わせることがある出口であり、そのままでは呼ぶ側のテストが外の都合に縛られる
 * （ADR-005 / `docs/testing.md` 2章）。`vi.mock` で差し替えず、**interface の記憶上の実装**を
 * 書くのは、型が合っていることまで一緒に確かめられるためである。
 *
 * **既定は全部残す。** 確かめが本題でない既存のテストは、これを結線しても振る舞いが変わらない。
 * 落とす名称を渡したら、**どの回でも**その名称の生成結果を落とす — 1回目と作り直しで同じ規則が
 * 効くことが、作り直しの結果も確かめにかける規則（B-78 規則9）の前提になる。
 *
 * ポートの契約どおり、残すものは**受け取った並びのまま**返し、投げない。名称は正規化せず
 * そのまま比べる（`createGeneratedMeal` が前後の空白を落とし済み）。
 *
 * **`receivedInputs` を持つのは、確かめに何を渡したかを観察する口が他に無いからである**
 * （B-78 規則10・11）。渡した生成結果と避けるべき名称は出口の向こうへ行ってしまい、
 * 呼ぶ側の返り値からは見えない。
 */
export class FixedGeneratedMealChecker implements GeneratedMealChecker {
  readonly #droppedTitles: ReadonlySet<string>;
  readonly #receivedInputs: GeneratedMealCheckInput[] = [];

  constructor(props: { readonly droppedTitles?: readonly string[] } = {}) {
    this.#droppedTitles = new Set(props.droppedTitles ?? []);
  }

  /** 受け取った入力を、呼ばれた順に全回ぶん。 */
  get receivedInputs(): readonly GeneratedMealCheckInput[] {
    return [...this.#receivedInputs];
  }

  async check(input: GeneratedMealCheckInput): Promise<readonly GeneratedMeal[]> {
    this.#receivedInputs.push(input);

    return input.generatedMeals.filter(
      (generatedMeal) => !this.#droppedTitles.has(generatedMeal.title),
    );
  }
}
