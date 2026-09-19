import type { StockItemDto } from '@fridge-to-meal/contract';
import type { HouseholdId } from '../../../shared/domain/HouseholdId.js';
import type { ListStockItems } from '../../pantry/usecase/ListStockItems.js';
import { createMeal } from '../domain/entity/Meal.js';
import type { Meal } from '../domain/entity/Meal.js';
import { createSuggestion } from '../domain/entity/Suggestion.js';
import type { Suggestion } from '../domain/entity/Suggestion.js';
import type { MealGenerator } from '../domain/port/MealGenerator.js';
import type { MealIdGenerator } from '../domain/port/MealIdGenerator.js';
import type { SuggestionIdGenerator } from '../domain/port/SuggestionIdGenerator.js';
import type { MealRepository } from '../domain/repository/MealRepository.js';
import type { SuggestionRepository } from '../domain/repository/SuggestionRepository.js';
import { cookableMealsOf } from '../domain/service/CookableMealFinder.js';
import { amountOf } from '../domain/value/Amount.js';
import type { CookableMeal } from '../domain/value/CookableMeal.js';
import { dateTimeOf, hoursBeforeOf } from '../domain/value/DateTime.js';
import type { DateTime } from '../domain/value/DateTime.js';
import { expiryDateOf } from '../domain/value/ExpiryDate.js';
import type { MealId } from '../domain/value/MealId.js';
import {
  createPantrySnapshot,
  pantrySnapshotEquals,
  unexpiredStockItemsOf,
} from '../domain/value/PantrySnapshot.js';
import type { PantrySnapshot } from '../domain/value/PantrySnapshot.js';
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
 *
 * **いまの `SuggestMealsOutput` の改名であり、中身は1つも変えない**（ADR-041 決定2・結果3）。
 */
export type SuggestionOutput = {
  readonly id: string;
  readonly entries: readonly SuggestionEntryOutput[];
  /** 生成日時。UTC の正準形に正規化された文字列（`DateTime`）。 */
  readonly generatedAt: string;
};

/**
 * ユースケースの結末。**`outcome` で判別する**（ADR-041 決定1）。
 * 在庫が足りない回も上限に達した回も失敗でも規則違反でもないので、投げも `null` も使わない。
 *
 * `<ユースケース>Output` がそのユースケースの戻り値である先行（`ListStockItemsOutput`）に
 * 合わせ、union のほうが `SuggestMealsOutput` を名乗る。判別子に `kind` を使わないのは、
 * `MealIngredient.kind`（主材料／調味料。C-16）が同じ語を別の意味で持っているためである。
 *
 * **`'generationLimitReached'` が S-7 である**（NFR-C2 / ADR-049 結果5）。ADR-041 結果2 の
 * とおり、上限の数え方がどう決まっても足すのはこの1行と、それを返す分岐だけであった。
 */
export type SuggestMealsOutput =
  | { readonly outcome: 'suggested'; readonly suggestion: SuggestionOutput }
  | { readonly outcome: 'insufficientStockItems' }
  | { readonly outcome: 'generationLimitReached' };

/**
 * 在庫で作れる献立から提案を組む（FR-16 / FR-34 / FR-35）。世帯は第1引数で受け取り、
 * 基準日時も引数で受け取る（C-9 / `docs/testing.md` 5章）。
 *
 * **返すのは結末が判別できる1つの値である**（B-31b 規則1 / ADR-041 決定1）。再利用で組めなければ
 * 生成へ回るので、「組めなかった」を表す `null` は無い（B-28 規則16）。**生成を呼ぶだけの在庫が
 * 無い回は `'insufficientStockItems'` を名乗り、提案を組まない**（B-31b 規則7 / prompt-design 8章）。
 * **直近24時間の生成が上限に達している回も同じで、`'generationLimitReached'` を名乗る**
 * （B-31c / NFR-C2 / ADR-049）。
 *
 * 失敗（S-6）と規則違反はこれまでどおり投げる。判別できる戻り値にしたのは、在庫が足りない回も
 * 上限に達した回もそのどちらでもないためである（screen-design 3.1 S-4・S-6・S-7 / NFR-07 / ADR-025）。
 */
export type SuggestMeals = (householdId: HouseholdId, asOf: string) => Promise<SuggestMealsOutput>;

/**
 * 1回の提案で並べる上限（FR-16 / C-15 / `Suggestion` の不変条件）。**件数をこちらが持つのは、
 * 選び出す側（`cookableMealsOf`）に切り取りを移さないためである**（ADR-036 決定4 / 結果7）。
 */
const MAX_SUGGESTION_ENTRIES = 3;

/**
 * 除外のために遡る提案の回数（C-11 / B-27 規則8）。**「直近3回」の3を持つのはこのユースケース
 * であり**、リポジトリには件数として渡す — 何回ぶんを見て飽きさせないかは再利用の規則であって、
 * 取得の実装が決めるものではない。保存済みが3回に満たないときはあるだけが返る。
 */
const EXCLUSION_LOOKBACK_COUNT = 3;

/**
 * 生成に求める件数（ADR-022 / B-28 規則3）。**`maxSuggestionEntries` を流用しない** — 値は同じでも
 * 由来が違い、求める件数と並べる上限は片方だけ動きうる。
 */
const REQUIRED_GENERATED_MEAL_COUNT = 3;

/**
 * 生成に渡す避けるべき名称の上限（ADR-021 結果2 / B-28 規則8 / prompt-design D-6・論点4）。
 * **上限は費用の上限である** — 同じ名称を何件送っても避ける効果は頭打ちになる一方、
 * 送った分だけプロンプトが伸びる。**切るのは呼ぶ側であり、出口は検査しない**（B-15 規則9）。
 *
 * **この値は暫定である。** `prompt-design.md` の論点4 は `暫定で確定` であり、P-5 の試行
 * （0 / 20 / 50 の比較）の数字を待って閉じる。**動かすときは、この値を固定している2件の
 * テストが同時に動く** — 「避けるべき名称が上限を超えるときは、生成日時の古いほうから落ちる」と
 * 「直前の提案の献立名が保持している献立と重なっても、畳んでから切るので50件を渡す」。
 * **そこが赤くなったら、壊れたのではなく数字が変わったのである。**
 */
const MAX_AVOID_TITLES = 50;

/**
 * 生成を呼ぶのに要る、**期限切れを落としたあとの**在庫品の件数（prompt-design 8章 / B-31b 規則7）。
 * 2件あれば主菜が組めるが、1件では「ゆで卵」しか出ず提案にならない。**下回る回は外へ問い合わせず、
 * 在庫が足りない結末を返す**（screen-design 3.1 S-4 / ADR-041 決定1）。
 *
 * **この値は暫定である。** `prompt-design.md` 9.1 P-3（極端に少ない在庫）の試行の数字を待って閉じる。
 * **動かすときに動くのはこの1行であり**、境界を固定している5件のテストが同時に動く —
 * 「在庫が1件だけの日も…」「在庫が2件あれば生成へ回り…」「在庫が2件あっても全件が期限切れの
 * 日は…」「在庫が2件あっても、期限切れを落とすと1件しか残らない日は…」「期限が基準日の当日の
 * 在庫品が2件あれば…」。**そこが赤くなったら、壊れたのではなく数字が変わったのである**
 * （`MAX_AVOID_TITLES` と同じ）。
 */
const MIN_STOCK_ITEM_COUNT_TO_GENERATE = 2;

/**
 * 1日に生成を呼べる回数の上限（NFR-C2 / B-31c / screen-design 3.1 S-7）。**達していたら
 * 生成を呼ばず、上限に達した結末を返す**（ADR-049 決定1 / ADR-041 決定1）。
 *
 * 値は NFR-C2 の初期値である。**数える単位は世帯であり**（C-9。同 NFR の字面は「1ユーザー
 * あたり」だが、MVP は1利用者1世帯である）、**数えるのは生成の由来を持つ保存済みの提案**で
 * ある — 再利用だけで組めた提案も保存されるため（C-14）、提案の件数をそのまま数えると
 * 呼んでいない回まで上限を食う（ADR-049 決定1）。
 *
 * **動かすときに動くのはこの1行であり**、境界を固定している2件のテストが同時に動く —
 * 「直近24時間の生成が上限に達している日は…」と「上限にあと1回ぶん残っていれば…」。
 */
const MAX_GENERATION_COUNT_PER_DAY = 10;

/**
 * 「1日」の幅（ADR-049 決定2）。**基準日時から遡る24時間の窓であり、暦日で切らない。**
 *
 * `docs/` のどこにもタイムゾーンの記述が無く、暦日で切るとどの案も時間帯を1つ選ぶことに
 * なる（ADR-040 結果1 がこの周へ送った判断）。窓なら `asOf` と幅だけで決まり、**暦日を
 * 1度も取り出さない。** 費用の上限としても素直である — 暦日で切ると日付が変わる瞬間に
 * 2日ぶんを続けて呼べるが、窓なら任意の24時間がつねに上限以下に収まる。
 *
 * **窓の下端は含む**（`countGeneratedByHouseholdSince` の契約）。**動かすときに動くのは
 * この1行であり**、境界を固定している2件のテストが同時に動く — 「ちょうど24時間前の生成も…」と
 * 「窓より前の生成は…」。
 */
const GENERATION_LIMIT_WINDOW_HOURS = 24;

/** 再利用の経路で組む提案の由来（C-4c）。 */
const REUSED_ORIGIN: SuggestionEntryOrigin = 'reused';

/** 生成の経路で組む提案の由来（C-4c / B-28 規則13）。 */
const GENERATED_ORIGIN: SuggestionEntryOrigin = 'generated';

/**
 * 提案のユースケースを組み立てる。依存は引数で受け取り、実装の生成は `main.ts` に任せる
 * （ADR-002 / B-09）。在庫は `pantry/usecase` から受け取る（ADR-033 決定2）。
 */
export function suggestMeals(deps: {
  listStockItems: ListStockItems;
  mealRepository: MealRepository;
  suggestionRepository: SuggestionRepository;
  mealGenerator: MealGenerator;
  generateMealId: MealIdGenerator;
  generateSuggestionId: SuggestionIdGenerator;
}): SuggestMeals {
  return async (householdId, asOf) => {
    // 在庫も献立も最新の提案も直近の提案も第1引数の世帯で引く。同じ世帯のものだけを
    // 突き合わせる責務はここにある（C-9 / B-27 規則1）。**取得が投げた例外は握りつぶさない** —
    // 比べる相手や除外の材料が引けないときに埋め合わせると、C-7 と C-11 が黙って効かなくなる
    // （7章2行目）。
    const stockItemsOutput = await deps.listStockItems(householdId);

    // 写した在庫は1本だけ作り、作れる献立の判定と在庫スナップショットの両方へ渡す。
    // 同じ在庫から2種類を組むと、判定に使った在庫と記録に残る在庫がずれる
    // （B-27 規則4 / ADR-037 決定1）。
    const mealStockItems = stockItemsOutput.stockItems.map(toMealStockItem);

    // 在庫スナップショットも1本だけ作り、C-7 の比較に使うものと生成に渡すものと提案が抱える
    // ものを同じにする（B-28 規則4 / ADR-037 決定1）。在庫スナップショットは呼び出し時点の
    // 在庫の複製であり、献立が使った分だけではない（B-27 規則13 / C-7）。
    const pantrySnapshot = createPantrySnapshot({ stockItems: mealStockItems });
    // 基準日時の正準化も1度きりにする。生成に渡す瞬間・新しい献立の生成日時・提案の生成日時が
    // 同じ値であることは、この1本から従う（B-28 規則5 / `docs/testing.md` 5章）。
    // **短絡する回も通す** — 引数が読めるかどうかは経路で変わらない。
    const asOfDateTime = dateTimeOf(asOf);

    // 在庫が最新の提案のときから動いていなければ、その提案をそのまま返してここで終える
    // （C-7 / FR-21 / NFR-C1 / B-28 規則1）。**最初の分岐がこれである**
    // （domain-model 6章）。献立も直近3回の提案も引かず、提案を組まず、識別子も発行せず、
    // 保存もしない — 返す識別子も由来も生成日時も保存済みの提案のものであって、
    // 引数の基準日時でも新しく発行した識別子でもない。
    const latestSuggestion = await deps.suggestionRepository.findLatestByHousehold(householdId);
    if (
      latestSuggestion !== null &&
      pantrySnapshotEquals(latestSuggestion.pantrySnapshot, pantrySnapshot)
    ) {
      return toOutput(latestSuggestion);
    }

    // 一致しない、または比べる相手が1件も無ければ、いつもどおり再利用から組む（B-28 規則1・2）。
    const storedMeals = await deps.mealRepository.findByHousehold(householdId);
    const recentSuggestions = await deps.suggestionRepository.findRecentByHousehold(
      householdId,
      EXCLUSION_LOOKBACK_COUNT,
    );

    // 順は**並べる → 除外する → 切る**（B-27 規則6 / ADR-036 決定4 / 結果7）。
    // 並べるのは `cookableMealsOf` で、受け取るのは全件である（C-12）。受け取った列は
    // 読むだけで、その場で並べ替えない（B-27 規則17 / ADR-009）。
    const cookableMeals = cookableMealsOf(storedMeals, mealStockItems);
    // 直近に出した献立を落とす。**先に切ってから除外すると**、除外された分を取り戻せず
    // 3件を割る（B-27 規則6(b)・7 / C-11 / FR-37）。
    const notRecentlySuggested = excludeRecentlySuggested(cookableMeals, recentSuggestions);
    // 上位から採る。切るのはこのユースケースであり、`cookableMealsOf` は全件を返す
    // （FR-16 / C-15 / B-27 規則6(c)・10 / ADR-036 決定4）。
    const selectedCookableMeals = notRecentlySuggested.slice(0, MAX_SUGGESTION_ENTRIES);

    // 再利用で採れたものが0件のときだけ生成へ回る。0件は例外ではなく正常な経路であり、
    // 1件でも採れていれば生成は呼ばない（B-28 規則2 / C-15 / NFR-C1b）。避けるべき名称を
    // 組むのも、名称の引き当てを組むのも生成へ回る回だけである — 再利用で組めた回は
    // 外へ何も出さず、既存との突き合わせも要らない。
    //
    // **引き当ては生成を呼ぶ前に組み終える。** 生成の途中で保存した献立は
    // `findByHousehold` が返した列（記録そのもの）に積まれるため、都度引き直すと
    // その回に保存したばかりの献立まで参照の対象に入る（B-28 規則10）。
    const shouldGenerate = selectedCookableMeals.length === 0;

    // 生成へ回る回だけ、呼ぶ直前に在庫の下限を見る（B-31b 規則3・7 / prompt-design 8章 /
    // screen-design 3.1 S-4）。**門は経路の入口ではなくここにある** — 前に置くと、C-7 で短絡
    // できる回（規則4）も作れる既存の献立が残っている回（規則5）も、出せる提案があるのに
    // 「在庫が足りない」と告げることになる。取得もどの回も通る（規則9）。
    //
    // 数えるのは `unexpiredStockItemsOf` が返した列の件数であり、**期限の規則はここに写さない**
    // （B-31b 規則6 / ADR-040 決定1）。在庫が0件の回も全件が期限切れの回も、載る在庫が0件で
    // あることに変わりはなく、同じ結末になる（規則10）。
    //
    // 下回った回は**生成を呼ばず、献立も提案も組まず、識別子も発行せず、保存もしない**
    // （規則8 / C-14）— 組まなかった回を記録に残すと、次の回の比較（C-7）と除外（C-11）が
    // その記録を引きずる。失敗でも規則違反でもないので投げない（規則1 / ADR-041 決定1）。
    if (
      shouldGenerate &&
      unexpiredStockItemsOf(pantrySnapshot, asOfDateTime).length < MIN_STOCK_ITEM_COUNT_TO_GENERATE
    ) {
      return { outcome: 'insufficientStockItems' };
    }

    // 続けて、同じ位置で1日の生成回数の上限を見る（B-31c / NFR-C2 / screen-design 3.1 S-7 /
    // ADR-049）。**門が在庫の下限と同じ位置にあるのは同じ理由である** — 前に置くと、C-7 で
    // 短絡できる回も作れる既存の献立が残っている回も、出せる提案があるのに上限を告げることに
    // なる（ADR-049 結果6）。
    //
    // **在庫の下限より後にあるのも決めごとである**（同 結果6）。下限は手元の在庫だけで判るが、
    // 上限は問い合わせが1つ要る — 在庫が足りない日は数えに行かない。両方に当たる日に
    // 在庫の側を名乗るのも正しい: **在庫を登録すれば解ける S-4 と違い、S-7 は待つしかない。**
    //
    // 数えるのは**生成の由来を持つ保存済みの提案**であって提案の件数ではない（決定1 / C-14 /
    // C-15 / C-4c）。**由来で絞る規則はリポジトリの契約が持ち、ここには写さない** —
    // こちらが持つのは上限の数と窓の幅である（ADR-038 決定3 が `limit` に対して置いた線と同じ）。
    //
    // 達した回は**生成を呼ばず、献立も提案も組まず、識別子も発行せず、保存もしない。**
    // 保存すると、数えている当のものが自分で増えていく。失敗でも規則違反でもないので投げない。
    if (shouldGenerate) {
      const generationCount = await deps.suggestionRepository.countGeneratedByHouseholdSince(
        householdId,
        hoursBeforeOf(asOfDateTime, GENERATION_LIMIT_WINDOW_HOURS),
      );
      if (generationCount >= MAX_GENERATION_COUNT_PER_DAY) {
        return { outcome: 'generationLimitReached' };
      }
    }

    const suggestionEntries = shouldGenerate
      ? await generateSuggestionEntries(
          deps,
          householdId,
          pantrySnapshot,
          asOfDateTime,
          buildAvoidTitles(storedMeals, recentSuggestions),
          buildExistingMealIdByTitle(storedMeals),
        )
      : selectedCookableMeals.map(toReusedEntry);

    // 検証を保存の前に済ませる。規則違反で終わったときに何も残らないのはこの順序による
    // （B-27 規則11 / 先行 `registerStockItem`）。**提案を保存するのはどちらの経路でも同じ**で、
    // 識別子も生成日時も経路で変えない（B-28 規則15 / C-14）。
    const suggestion = createSuggestion({
      // 現在時刻も乱数も本体では読まない（B-27 規則12 / `docs/testing.md` 5章）。
      id: deps.generateSuggestionId(),
      householdId,
      entries: suggestionEntries,
      pantrySnapshot,
      generatedAt: asOfDateTime,
    });

    await deps.suggestionRepository.save(householdId, suggestion);

    return toOutput(suggestion);
  };
}

/**
 * 生成へ回して、提案の1件の列を返す（B-28 規則9・12・13・14）。**再利用で1件も採れなかった
 * ときだけ通る道**である（規則2 / C-15）。
 *
 * 生成結果は**返ってきた並びのまま**提案の1件に写す。並べ替えも切り捨てもしない — 並びを
 * 決めるのは生成の側であり、C-12 は再利用の並びの規則である（C-2 / 規則9）。求めるのは3件だが、
 * 満たなくても通った件数でそのまま組み、再生成も再試行もしない（規則14 / C-15）。
 *
 * **名称が既存の献立と完全一致した生成結果は、その献立を参照する**（規則10 / C-4）。同じ名称の
 * 献立を二重に持たないための写像であり、参照で済んだものは献立を作らず、保存もせず、識別子も
 * 発行しない（規則12）。**それでも由来は生成のままである** — 経路の印であって、どこから
 * 引いてきたかの印ではない（規則13 / C-4c）。
 *
 * **一致しなかったものだけを、1件ずつ、識別子を発行し、献立にして、保存してから提案の1件に
 * する。** 提示するのは保存を終えた献立だけであり、保存の途中で投げたときに提案が組み上がら
 * ないのはこの順序による（C-1 / 規則12）。発行の順が生成の並びとずれると、同じ入力でも名称と
 * 識別子の対応が回ごとに変わる（C-12 の決定性）。
 *
 * 1件も生成できなければ出口が `MealRuleViolation` を投げ、それをそのまま伝える。ここで
 * 握って別の提案に埋め合わせない（B-28 7章1行目 / NFR-07）。
 */
async function generateSuggestionEntries(
  deps: {
    mealGenerator: MealGenerator;
    generateMealId: MealIdGenerator;
    mealRepository: MealRepository;
  },
  householdId: HouseholdId,
  pantrySnapshot: PantrySnapshot,
  asOfDateTime: DateTime,
  avoidTitles: readonly string[],
  existingMealIdByTitle: ReadonlyMap<string, MealId>,
): Promise<readonly SuggestionEntry[]> {
  // 出口には世帯を渡さない（NFR-11 / B-28 9章）。避けるべき名称は組み終えたものを受け取る
  // だけで、ここで並べ替えも切り取りもしない（規則6・8 / `buildAvoidTitles`）。
  const generatedMeals = await deps.mealGenerator.generate({
    pantrySnapshot,
    requiredCount: REQUIRED_GENERATED_MEAL_COUNT,
    avoidTitles,
    asOf: asOfDateTime,
  });

  const suggestionEntries: SuggestionEntry[] = [];
  for (const generatedMeal of generatedMeals) {
    // 同じ名称の献立がすでに手元にあれば、それを指して次へ進む（規則10 / C-4）。突き合わせは
    // **両者の値をそのまま**比べるだけで、ここで詰め直しも畳み直しもしない — `createMeal` と
    // `createGeneratedMeal` が同じ正規化を1度ずつ通しており、2つ目の正規化の規則をここに
    // 置くと、片方だけ変わったときに突き合わせが静かにずれる（C-6 / ADR-037 理由(3)）。
    const existingMealId = existingMealIdByTitle.get(generatedMeal.title);
    if (existingMealId !== undefined) {
      // 作らず、保存せず、識別子も発行しない。発行するのは新しく保存するぶんだけである
      // （規則12）。**直近の提案で除外した献立もここで参照されうる** — C-11 で外したものが
      // 生成の印のまま戻る穴は、稀なものとして明示的に許容されている（C-4b）。
      suggestionEntries.push(
        createSuggestionEntry({ mealId: existingMealId, origin: GENERATED_ORIGIN }),
      );
      continue;
    }

    // 生成結果は識別子も世帯も生成日時も持たない（ADR-035）。それを与えて献立にするのが
    // 呼ぶ側の仕事である。材料と手順は写すだけで、並べ替えも補完もしない（C-5）。
    const meal = createMeal({
      id: deps.generateMealId(),
      householdId,
      title: generatedMeal.title,
      ingredients: generatedMeal.ingredients,
      steps: generatedMeal.steps,
      generatedAt: asOfDateTime,
      // 生成された時点では作っていない。調理記録は「作った」を記録する周で増える（C-3 / C-8）。
      cookingRecords: [],
    });

    // 保存にも第1引数の世帯を渡す（C-9）。1件ずつ待つのは、保存できたものだけを
    // 提案に並べるためである（C-1）。
    await deps.mealRepository.save(householdId, meal);

    suggestionEntries.push(createSuggestionEntry({ mealId: meal.id, origin: GENERATED_ORIGIN }));
  }

  return suggestionEntries;
}

/**
 * 生成に渡す避けるべき名称を組む（B-28 規則6・7・8 / FR-42 / ADR-021 / prompt-design D-6）。
 *
 * 並びは **(a) 直前の提案に並んだ献立の名称 → (b) 保持している献立の名称**である。直前に
 * 見たものを最も強く避けるための順であり、**直前の提案は `findRecentByHousehold` が返した
 * 先頭**である — その先頭が最新の1件と同じものになることはリポジトリの契約が持っているので、
 * ここで最新の1件を引き直さない（ADR-038 決定1・2）。
 *
 * **(a) の内部は提案の1件の並びのまま**で、名称順に並べ替えない。提示した順そのもの
 * （再利用なら C-12、生成なら生成側の並び）であり、すでに決定的である。(b) は生成日時の
 * 新しい順で、同じ生成日時は `MealId` の降順で閉じる（`byNewestFirst`）。
 *
 * 提案が抱えるのは献立の識別子だけなので、名称は保持している献立から引く。**引けない識別子は
 * 黙って落とす** — 避ける対象は努力目標であり、手元に無い献立は避けようがない（規則7 /
 * ADR-021 結果1 / ADR-008）。
 *
 * **同じ名称は先に出たほうを残して1件に畳み、畳んでから上限で切る**（規則8）。先に切ると、
 * 重なっていたぶんだけ実際に避けられる名称が減る。先頭が (a) なので、直前に見た献立は
 * 蓄積が上限を超えていても残る。
 *
 * 受け取った列は読むだけで、その場で並べ替えない（B-27 規則17 / ADR-009）。
 */
function buildAvoidTitles(
  storedMeals: readonly Meal[],
  recentSuggestions: readonly Suggestion[],
): readonly string[] {
  // 同じ識別子は同じ献立を指す。先に見たほうを残すのは、名称を畳むときと同じ扱いである。
  const titleByMealId = new Map<MealId, string>();
  for (const meal of storedMeals) {
    if (!titleByMealId.has(meal.id)) titleByMealId.set(meal.id, meal.title);
  }

  // 直前の提案は直近の先頭である。1回も提案していなければ無い（規則6）。
  const previousSuggestion = recentSuggestions[0];
  const previousSuggestionTitles =
    previousSuggestion === undefined
      ? []
      : previousSuggestion.entries.flatMap((entry) => {
          const title = titleByMealId.get(entry.mealId);
          // 引けなかった1件だけが落ちる。空文字で埋めると、避ける対象として意味の無い
          // 名称を外へ送ることになる（規則7）。
          return title === undefined ? [] : [title];
        });

  // 並べ替えるのは複製した配列であって、リポジトリが返した列ではない（B-27 規則17 / ADR-009）。
  const storedMealTitles = [...storedMeals].sort(byNewestFirst).map((meal) => meal.title);

  const seenTitles = new Set<string>();
  const avoidTitles: string[] = [];
  for (const title of [...previousSuggestionTitles, ...storedMealTitles]) {
    if (seenTitles.has(title)) continue;
    seenTitles.add(title);
    avoidTitles.push(title);
  }

  // 畳んでから切る（規則8）。逆にすると、重なっていたぶんだけ渡せる名称が減る。
  return avoidTitles.slice(0, MAX_AVOID_TITLES);
}

/**
 * 名称から既存の献立の識別子を引けるようにする（B-28 規則10・11 / C-4）。生成結果の名称が
 * これに当たれば、新しい献立を作らずその献立を参照する。
 *
 * **同じ名称の献立が2件以上あるときは `MealId` の昇順の先頭を採る**（規則11 / ADR-036 決定2）。
 * `findByHousehold` は並び順を約束しない（ADR-038 決定1）ので、返った列の先頭を採ると参照先が
 * 実装ごとにぶれる。識別子で閉じれば、同じ手元の献立からは常に同じ1件を指す（C-12 の決定性）。
 * **`buildAvoidTitles` の `byNewestFirst` を流用しない** — あちらは何を避けるかの強さの順で
 * あって、どれを指すかの決着ではない。
 *
 * 受け取った列は読むだけで、その場で並べ替えない（B-27 規則17 / ADR-009）。小さいほうを
 * 拾い続けるので、複製して並べ替える必要もない。
 */
function buildExistingMealIdByTitle(storedMeals: readonly Meal[]): ReadonlyMap<string, MealId> {
  const mealIdByTitle = new Map<string, MealId>();
  for (const meal of storedMeals) {
    const mappedMealId = mealIdByTitle.get(meal.title);
    if (mappedMealId === undefined || compareCodeUnits(meal.id, mappedMealId) < 0) {
      mealIdByTitle.set(meal.title, meal.id);
    }
  }

  return mealIdByTitle;
}

/**
 * 蓄積の側の並び。**生成日時の新しい順、同じ生成日時は `MealId` の降順**で閉じる
 * （B-28 規則6 / ADR-038 決定1・2）。同時刻の決着をつけないと、同じ入力から渡す名称の
 * 並びが回ごとに変わる（C-12 の決定性）。`findByHousehold` は並び順を約束しないので、
 * 並べるのはこちらの仕事である。
 *
 * `DateTime` は UTC の正準形に正規化済みなので、文字列の大小がそのまま時刻の順になる。
 */
function byNewestFirst(leftMeal: Meal, rightMeal: Meal): number {
  const generatedAtOrder = compareCodeUnits(rightMeal.generatedAt, leftMeal.generatedAt);
  if (generatedAtOrder !== 0) return generatedAtOrder;

  return compareCodeUnits(rightMeal.id, leftMeal.id);
}

/**
 * コード単位の大小で比べる（先行 `cookableMealsOf` / `ListStockItems`）。
 *
 * 照合順序は実行環境の ICU に依存するため `localeCompare` を使わない。コード単位なら
 * Workers と Node で同じ並びになる（ADR-036 結果8 / C-12 の決定性）。
 */
function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/**
 * 直近の提案に出した献立を落とす（C-11 / FR-37 / B-27 規則6(b)・7）。在庫が動かない期間、
 * ずっと同じ献立が出続けるのを避けるためである。
 *
 * **落とすのは `entries` に現れる献立すべてで、先頭の1件だけではない。由来も問わない** —
 * `origin` はどの経路から来たかの印であって、除外の可否を決めるものではない（C-4c）。
 *
 * 受け取った列は読むだけで、返すのは濾した新しい配列である（B-27 規則17 / ADR-009）。
 */
function excludeRecentlySuggested(
  cookableMeals: readonly CookableMeal[],
  recentSuggestions: readonly Suggestion[],
): readonly CookableMeal[] {
  const recentlySuggestedMealIds = new Set<MealId>(
    recentSuggestions.flatMap((suggestion) => suggestion.entries.map((entry) => entry.mealId)),
  );

  return cookableMeals.filter(
    (cookableMeal) => !recentlySuggestedMealIds.has(cookableMeal.meal.id),
  );
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
function toMealStockItem(stockItem: StockItemDto): StockItem {
  return createStockItem({
    name: stockItem.name,
    amount: amountOf(stockItem.amount),
    expiryDate: expiryDateOf(stockItem.expiryDate),
  });
}

/**
 * 作れる献立を提案の1件に写す。**由来は全件が再利用であり、生成と混ぜない**
 * （FR-35 / C-15 / B-27 規則9）。
 */
function toReusedEntry(cookableMeal: CookableMeal): SuggestionEntry {
  return createSuggestionEntry({ mealId: cookableMeal.meal.id, origin: REUSED_ORIGIN });
}

/**
 * 提案を、**提案を返したことを名乗る結末**に写す（B-31b 規則1・2 / ADR-041 決定1・決定2）。
 * **この周で組んで保存した提案と、C-7 で短絡して返す保存済みの提案の両方が通る** —
 * どちらも同じ写し方であり、短絡した回だけ識別子や生成日時を作り替えない（B-28 規則1）。
 *
 * **判別子が付くだけで、提案の中身は1つも変わらない**（B-31b 規則2）。結末を名乗る場所を
 * ここ1か所に閉じているので、変種が増えても提案を組む側は動かない。
 *
 * `entries` の並びは**組んだ順そのまま**である — 再利用なら C-12 の順、生成なら生成側が
 * 返した並びであり、ここで並べ替えない（FR-35 / C-2 / C-12 / B-27 規則16 / B-28 規則9）。
 */
function toOutput(suggestion: Suggestion): SuggestMealsOutput {
  return {
    outcome: 'suggested',
    suggestion: {
      id: suggestion.id,
      entries: suggestion.entries.map((entry) => ({
        mealId: entry.mealId,
        origin: entry.origin,
      })),
      generatedAt: suggestion.generatedAt,
    },
  };
}
