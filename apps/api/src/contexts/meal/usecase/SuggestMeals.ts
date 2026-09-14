import type { StockItemDto } from '@fridge-to-meal/contract';
import type { HouseholdId } from '../../../shared/domain/HouseholdId.js';
import type { ListStockItems } from '../../pantry/usecase/ListStockItems.js';
import { createSuggestion } from '../domain/entity/Suggestion.js';
import type { Suggestion } from '../domain/entity/Suggestion.js';
import type { SuggestionIdGenerator } from '../domain/port/SuggestionIdGenerator.js';
import type { MealRepository } from '../domain/repository/MealRepository.js';
import type { SuggestionRepository } from '../domain/repository/SuggestionRepository.js';
import { cookableMealsOf } from '../domain/service/CookableMealFinder.js';
import { amountOf } from '../domain/value/Amount.js';
import type { CookableMeal } from '../domain/value/CookableMeal.js';
import { dateTimeOf } from '../domain/value/DateTime.js';
import { expiryDateOf } from '../domain/value/ExpiryDate.js';
import type { MealId } from '../domain/value/MealId.js';
import { createPantrySnapshot } from '../domain/value/PantrySnapshot.js';
import { createStockItem } from '../domain/value/StockItem.js';
import type { StockItem } from '../domain/value/StockItem.js';
import { createSuggestionEntry } from '../domain/value/SuggestionEntry.js';
import type { SuggestionEntry, SuggestionEntryOrigin } from '../domain/value/SuggestionEntry.js';

/** 提案の1件。抱えるのは献立の識別子と由来だけである（ADR-008）。 */
export type SuggestionEntryOutput = {
  readonly mealId: string;
  readonly origin: SuggestionEntryOrigin;
};

/**
 * 提案1回ぶんの出力。**HTTP の契約ではない**（B-27 10章）。献立側の DTO を
 * `packages/contract` に置くのは api 経路を作る周であり、この周はここに置く。
 */
export type SuggestMealsOutput = {
  readonly id: string;
  readonly entries: readonly SuggestionEntryOutput[];
  /** 生成日時。UTC の正準形に正規化された文字列（`DateTime`）。 */
  readonly generatedAt: string;
};

/**
 * 在庫で作れる献立から提案を組む（FR-16 / FR-34 / FR-35）。世帯は第1引数で受け取り、
 * 基準日時も引数で受け取る（C-9 / `docs/testing.md` 5章）。
 *
 * `null` は「再利用では組めなかった」。生成は B-28 で、そこでこの `null` が消える。
 */
export type SuggestMeals = (
  householdId: HouseholdId,
  asOf: string,
) => Promise<SuggestMealsOutput | null>;

/**
 * 1回の提案で並べる上限（FR-16 / C-15 / `Suggestion` の不変条件）。**件数をこちらが持つのは、
 * 選び出す側（`cookableMealsOf`）に切り取りを移さないためである**（ADR-036 決定4 / 結果7）。
 */
const 並べる上限 = 3;

/**
 * 除外のために遡る提案の回数（C-11 / B-27 規則8）。**「直近3回」の3を持つのはこのユースケース
 * であり**、リポジトリには件数として渡す — 何回ぶんを見て飽きさせないかは再利用の規則であって、
 * 取得の実装が決めるものではない。保存済みが3回に満たないときはあるだけが返る。
 */
const 除外に遡る提案の回数 = 3;

/** 再利用の経路で組む提案の由来（C-4c）。 */
const 再利用: SuggestionEntryOrigin = 'reused';

/**
 * 提案のユースケースを組み立てる。依存は引数で受け取り、実装の生成は `main.ts` に任せる
 * （ADR-002 / B-09）。在庫は `pantry/usecase` から受け取る（ADR-033 決定2）。
 */
export function suggestMeals(deps: {
  listStockItems: ListStockItems;
  mealRepository: MealRepository;
  suggestionRepository: SuggestionRepository;
  generateSuggestionId: SuggestionIdGenerator;
}): SuggestMeals {
  return async (householdId, asOf) => {
    // 在庫も献立も直近の提案も第1引数の世帯で引く。同じ世帯のものだけを突き合わせる責務は
    // ここにある（C-9 / B-27 規則1）。**取得が投げた例外は握りつぶさない** — 直近の提案が
    // 引けないときに除外なしの提案で埋め合わせると、C-11 が黙って効かなくなる（7章2行目）。
    const 在庫の一覧 = await deps.listStockItems(householdId);
    const 保持されている献立 = await deps.mealRepository.findByHousehold(householdId);
    const 直近の提案 = await deps.suggestionRepository.findRecentByHousehold(
      householdId,
      除外に遡る提案の回数,
    );

    // 写した在庫は1本だけ作り、作れる献立の判定と在庫スナップショットの両方へ渡す。
    // 同じ在庫から2種類を組むと、判定に使った在庫と記録に残る在庫がずれる
    // （B-27 規則4 / ADR-037 決定1）。
    const 献立側の在庫 = 在庫の一覧.stockItems.map(献立側の在庫品にする);

    // 順は**並べる → 除外する → 切る**（B-27 規則6 / ADR-036 決定4 / 結果7）。
    // 並べるのは `cookableMealsOf` で、受け取るのは全件である（C-12）。受け取った列は
    // 読むだけで、その場で並べ替えない（規則17 / ADR-009）。
    const 作れる献立たち = cookableMealsOf(保持されている献立, 献立側の在庫);
    // 直近に出した献立を落とす。**先に切ってから除外すると**、除外された分を取り戻せず
    // 3件を割る（B-27 規則6(b)・7 / C-11 / FR-37）。
    const 直近に出していないもの = 除外を通す(作れる献立たち, 直近の提案);
    // 上位から採る。切るのはこのユースケースであり、`cookableMealsOf` は全件を返す
    // （FR-16 / C-15 / B-27 規則6(c)・10 / ADR-036 決定4）。
    const 採ったもの = 直近に出していないもの.slice(0, 並べる上限);

    // 残りが0件なら、提案を組まずに `null` を返す。**保存もしない** — 組めなかった回を
    // 記録に残すと C-11 の除外が1回ぶん狂う。0件は例外ではなく、生成へ回る正常な経路で
    // ある（B-27 規則14・15 / C-15 / NFR-C1b）。生成は B-28 で、そこでこの `null` が消える。
    if (採ったもの.length === 0) return null;

    // 検証を保存の前に済ませる。規則違反で終わったときに何も残らないのはこの順序による
    // （B-27 規則11 / 先行 `registerStockItem`）。
    const 提案 = createSuggestion({
      // 現在時刻も乱数も本体では読まない（B-27 規則12 / `docs/testing.md` 5章）。
      id: deps.generateSuggestionId(),
      householdId,
      entries: 採ったもの.map(再利用の1件にする),
      // 在庫スナップショットは呼び出し時点の在庫の複製であり、献立が使った分だけではない
      // （B-27 規則13 / C-7）。
      pantrySnapshot: createPantrySnapshot({ stockItems: 献立側の在庫 }),
      generatedAt: dateTimeOf(asOf),
    });

    await deps.suggestionRepository.save(householdId, 提案);

    return 出力にする(提案);
  };
}

/**
 * 直近の提案に出した献立を落とす（C-11 / FR-37 / B-27 規則6(b)・7）。在庫が動かない期間、
 * ずっと同じ献立が出続けるのを避けるためである。
 *
 * **落とすのは `entries` に現れる献立すべてで、先頭の1件だけではない。由来も問わない** —
 * `origin` はどの経路から来たかの印であって、除外の可否を決めるものではない（C-4c）。
 *
 * 受け取った列は読むだけで、返すのは濾した新しい配列である（規則17 / ADR-009）。
 */
function 除外を通す(
  作れる献立たち: readonly CookableMeal[],
  直近の提案: readonly Suggestion[],
): readonly CookableMeal[] {
  const 直近に出した献立 = new Set<MealId>(
    直近の提案.flatMap((提案) => 提案.entries.map((提案の1件) => 提案の1件.mealId)),
  );

  return 作れる献立たち.filter((作れる献立) => !直近に出した献立.has(作れる献立.meal.id));
}

/**
 * 在庫の一覧が返した在庫品を献立側の在庫品に写す（B-27 規則2・3）。持つのは**名称・分量・
 * 期限の3項目**だけで、識別子と食材の指定は落とす — 献立側のどの規則も見ないためである
 * （ADR-033 決定3 / ADR-037 決定1）。
 *
 * **ここで trim も既定値の補完もしない。** 正規化はドメインが持つものであり、写す側が
 * 2つ目の正規化の規則を持つと、片方だけ変わったときに突き合わせが静かにずれる
 * （先行 `registerStockItem` / ADR-037 理由(3)）。
 */
function 献立側の在庫品にする(在庫品: StockItemDto): StockItem {
  return createStockItem({
    name: 在庫品.name,
    amount: amountOf(在庫品.amount),
    expiryDate: expiryDateOf(在庫品.expiryDate),
  });
}

/**
 * 作れる献立を提案の1件に写す。**由来は全件が再利用であり、生成と混ぜない**
 * （FR-35 / C-15 / B-27 規則9）。
 */
function 再利用の1件にする(作れる献立: CookableMeal): SuggestionEntry {
  return createSuggestionEntry({ mealId: 作れる献立.meal.id, origin: 再利用 });
}

/**
 * 保存した提案を出力に写す。`entries` の並びは再利用の順そのままである
 * （FR-35 / C-12 / B-27 規則16）。
 */
function 出力にする(提案: Suggestion): SuggestMealsOutput {
  return {
    id: 提案.id,
    entries: 提案.entries.map((提案の1件) => ({
      mealId: 提案の1件.mealId,
      origin: 提案の1件.origin,
    })),
    generatedAt: 提案.generatedAt,
  };
}
