import type {
  MealGenerationInput,
  MealGenerator,
} from '../../../src/contexts/meal/domain/port/MealGenerator.js';
import type { GeneratedMeal } from '../../../src/contexts/meal/domain/value/GeneratedMeal.js';
import { MealRuleViolation } from '../../../src/contexts/meal/domain/error/MealRuleViolation.js';

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
 * **`受け取った入力` を持つのは、生成に何を渡したかを観察する口が他に無いからである**
 * （B-28 規則3〜8）。渡した在庫スナップショット・件数・避けるべき名称・基準日時は出口の
 * 向こうへ行ってしまい、呼ぶ側の返り値からは見えない。持つのは**最後の1件**で、
 * 一度も呼ばれていなければ `null` である（B-28 5章）。
 *
 * **`呼ばれた回数` を持つのは、呼ばれないこと自体が要件だからである**（C-7 / C-15）。
 * `vi.fn()` で数えず、**記憶上の実装の状態として観察する**（`docs/testing.md` 2章 /
 * 先行 `記憶上の世帯認証器`）。呼び出しの回数を見てよいのはこの2つの規則のときだけで、
 * それ以外の回数は実装の都合である（同3章）。
 *
 * **`requiredCount` が1未満のときは契約の外である**（B-15 規則8）。この代役は切った結果が0件になり
 * `mealGenerator.empty` を投げるが、それは契約が定めた振る舞いではない — 呼ぶ側が誤って0を渡すと
 * 「生成できなかった」と区別がつかない。呼ぶ側は常に3を渡す（ADR-022）。
 */
export class 記憶上の献立生成器 implements MealGenerator {
  readonly #用意した生成結果たち: readonly GeneratedMeal[];
  #呼ばれた回数 = 0;
  #受け取った入力: MealGenerationInput | null = null;

  constructor(...用意した生成結果たち: readonly GeneratedMeal[]) {
    this.#用意した生成結果たち = 用意した生成結果たち;
  }

  /** 何度呼ばれたか。**呼ばれないこと**が要件のときだけ見る（C-7 / C-15 / `docs/testing.md` 2章）。 */
  get 呼ばれた回数(): number {
    return this.#呼ばれた回数;
  }

  /** 最後に受け取った入力。まだ一度も呼ばれていなければ `null`（B-28 5章 / 規則3〜8）。 */
  get 受け取った入力(): MealGenerationInput | null {
    return this.#受け取った入力;
  }

  async generate(input: MealGenerationInput): Promise<readonly GeneratedMeal[]> {
    // 数えるのは投げるより先である。**呼ばれたことは、投げても事実である**（B-28 規則18 /
    // 先行 `記憶上の世帯認証器`）。後で数えると、用意した生成結果が0件の回に
    // 「呼ばれていない」と見えてしまい、C-7 と C-15 の番人が務まらない。
    this.#呼ばれた回数 += 1;
    // 受け取った入力も同じ理由で投げるより先に控える。**何を渡したかは、投げても渡した事実で
    // ある**（B-28 規則18）。後で控えると、投げた回に「何も渡していない」と見えてしまう。
    this.#受け取った入力 = input;

    // 読むのは `requiredCount` だけである。在庫スナップショット・避けるべき名称・基準日時は
    // 本物が生成の材料にするものであって、代役が返すものを変える根拠にはならない
    // （B-15 規則9・10。上限50件も在庫0件もここでは拒まない）。
    const 名称の重ならない生成結果たち = 同じ名称を落とした(this.#用意した生成結果たち);

    // 落としてから切る。逆にすると、同名を含む4件を `requiredCount: 3` で渡したときに
    // 先頭3件を採ってから重複が落ちて2件になり、通せたはずの1件を落とす（B-15 規則7）。
    const 返す生成結果たち = 名称の重ならない生成結果たち.slice(0, input.requiredCount);

    if (返す生成結果たち.length === 0) {
      // 0件で返さない（B-15 規則5 / 7章1行目）。空の列で返すと、呼ぶ側が「生成が失敗した」と
      // 「生成するものが無かった」を見分けられない。**投げるのは0件のときだけ**であり、
      // `requiredCount` に満たないだけなら得られた件数で返す（B-15 規則4 / C-15）。
      throw new MealRuleViolation('mealGenerator.empty', '生成結果が1件もありません');
    }

    return 返す生成結果たち;
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
function 同じ名称を落とした(生成結果たち: readonly GeneratedMeal[]): readonly GeneratedMeal[] {
  const 出た名称たち = new Set<string>();
  const 残った生成結果たち: GeneratedMeal[] = [];
  for (const 生成結果 of 生成結果たち) {
    if (出た名称たち.has(生成結果.title)) continue;
    出た名称たち.add(生成結果.title);
    残った生成結果たち.push(生成結果);
  }
  return 残った生成結果たち;
}
