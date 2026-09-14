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
import { dateTimeOf } from '../domain/value/DateTime.js';
import type { DateTime } from '../domain/value/DateTime.js';
import { expiryDateOf } from '../domain/value/ExpiryDate.js';
import type { MealId } from '../domain/value/MealId.js';
import { createPantrySnapshot, pantrySnapshotEquals } from '../domain/value/PantrySnapshot.js';
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
 * **返すのは提案か、投げるかの2択である**（B-28 規則16）。再利用で組めなければ生成へ回るので、
 * 「組めなかった」を表す `null` は無くなった。
 */
export type SuggestMeals = (householdId: HouseholdId, asOf: string) => Promise<SuggestMealsOutput>;

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

/**
 * 生成に求める件数（ADR-022 / B-28 規則3）。**`並べる上限` を流用しない** — 値は同じでも
 * 由来が違い、求める件数と並べる上限は片方だけ動きうる。
 */
const 求める生成の件数 = 3;

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
const 避けるべき名称の上限 = 50;

/** 再利用の経路で組む提案の由来（C-4c）。 */
const 再利用: SuggestionEntryOrigin = 'reused';

/** 生成の経路で組む提案の由来（C-4c / B-28 規則13）。 */
const 生成: SuggestionEntryOrigin = 'generated';

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
    const 在庫の一覧 = await deps.listStockItems(householdId);

    // 写した在庫は1本だけ作り、作れる献立の判定と在庫スナップショットの両方へ渡す。
    // 同じ在庫から2種類を組むと、判定に使った在庫と記録に残る在庫がずれる
    // （B-27 規則4 / ADR-037 決定1）。
    const 献立側の在庫 = 在庫の一覧.stockItems.map(献立側の在庫品にする);

    // 在庫スナップショットも1本だけ作り、C-7 の比較に使うものと生成に渡すものと提案が抱える
    // ものを同じにする（B-28 規則4 / ADR-037 決定1）。在庫スナップショットは呼び出し時点の
    // 在庫の複製であり、献立が使った分だけではない（B-27 規則13 / C-7）。
    const 在庫スナップショット = createPantrySnapshot({ stockItems: 献立側の在庫 });
    // 基準日時の正準化も1度きりにする。生成に渡す瞬間・新しい献立の生成日時・提案の生成日時が
    // 同じ値であることは、この1本から従う（B-28 規則5 / `docs/testing.md` 5章）。
    // **短絡する回も通す** — 引数が読めるかどうかは経路で変わらない。
    const 基準の日時 = dateTimeOf(asOf);

    // 在庫が最新の提案のときから動いていなければ、その提案をそのまま返してここで終える
    // （C-7 / FR-21 / NFR-C1 / B-28 規則1）。**最初の分岐がこれである**
    // （domain-model 6章）。献立も直近3回の提案も引かず、提案を組まず、識別子も発行せず、
    // 保存もしない — 返す識別子も由来も生成日時も保存済みの提案のものであって、
    // 引数の基準日時でも新しく発行した識別子でもない。
    const 最新の提案 = await deps.suggestionRepository.findLatestByHousehold(householdId);
    if (
      最新の提案 !== null &&
      pantrySnapshotEquals(最新の提案.pantrySnapshot, 在庫スナップショット)
    ) {
      return 出力にする(最新の提案);
    }

    // 一致しない、または比べる相手が1件も無ければ、いつもどおり再利用から組む（B-28 規則1・2）。
    const 保持されている献立 = await deps.mealRepository.findByHousehold(householdId);
    const 直近の提案 = await deps.suggestionRepository.findRecentByHousehold(
      householdId,
      除外に遡る提案の回数,
    );

    // 順は**並べる → 除外する → 切る**（B-27 規則6 / ADR-036 決定4 / 結果7）。
    // 並べるのは `cookableMealsOf` で、受け取るのは全件である（C-12）。受け取った列は
    // 読むだけで、その場で並べ替えない（B-27 規則17 / ADR-009）。
    const 作れる献立たち = cookableMealsOf(保持されている献立, 献立側の在庫);
    // 直近に出した献立を落とす。**先に切ってから除外すると**、除外された分を取り戻せず
    // 3件を割る（B-27 規則6(b)・7 / C-11 / FR-37）。
    const 直近に出していないもの = 除外を通す(作れる献立たち, 直近の提案);
    // 上位から採る。切るのはこのユースケースであり、`cookableMealsOf` は全件を返す
    // （FR-16 / C-15 / B-27 規則6(c)・10 / ADR-036 決定4）。
    const 採ったもの = 直近に出していないもの.slice(0, 並べる上限);

    // 再利用で採れたものが0件のときだけ生成へ回る。0件は例外ではなく正常な経路であり、
    // 1件でも採れていれば生成は呼ばない（B-28 規則2 / C-15 / NFR-C1b）。避けるべき名称を
    // 組むのも、名称の引き当てを組むのも生成へ回る回だけである — 再利用で組めた回は
    // 外へ何も出さず、既存との突き合わせも要らない。
    //
    // **引き当ては生成を呼ぶ前に組み終える。** 生成の途中で保存した献立は
    // `findByHousehold` が返した列（記録そのもの）に積まれるため、都度引き直すと
    // その回に保存したばかりの献立まで参照の対象に入る（B-28 規則10）。
    const 提案の1件たち =
      採ったもの.length === 0
        ? await 生成して提案の1件たちにする(
            deps,
            householdId,
            在庫スナップショット,
            基準の日時,
            避けるべき名称を組む(保持されている献立, 直近の提案),
            名称ごとの既存の献立を組む(保持されている献立),
          )
        : 採ったもの.map(再利用の1件にする);

    // 検証を保存の前に済ませる。規則違反で終わったときに何も残らないのはこの順序による
    // （B-27 規則11 / 先行 `registerStockItem`）。**提案を保存するのはどちらの経路でも同じ**で、
    // 識別子も生成日時も経路で変えない（B-28 規則15 / C-14）。
    const 提案 = createSuggestion({
      // 現在時刻も乱数も本体では読まない（B-27 規則12 / `docs/testing.md` 5章）。
      id: deps.generateSuggestionId(),
      householdId,
      entries: 提案の1件たち,
      pantrySnapshot: 在庫スナップショット,
      generatedAt: 基準の日時,
    });

    await deps.suggestionRepository.save(householdId, 提案);

    return 出力にする(提案);
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
async function 生成して提案の1件たちにする(
  deps: {
    mealGenerator: MealGenerator;
    generateMealId: MealIdGenerator;
    mealRepository: MealRepository;
  },
  householdId: HouseholdId,
  在庫スナップショット: PantrySnapshot,
  基準の日時: DateTime,
  避けるべき名称: readonly string[],
  名称ごとの既存の献立: ReadonlyMap<string, MealId>,
): Promise<readonly SuggestionEntry[]> {
  // 出口には世帯を渡さない（NFR-11 / B-28 9章）。避けるべき名称は組み終えたものを受け取る
  // だけで、ここで並べ替えも切り取りもしない（規則6・8 / `避けるべき名称を組む`）。
  const 生成結果たち = await deps.mealGenerator.generate({
    pantrySnapshot: 在庫スナップショット,
    requiredCount: 求める生成の件数,
    avoidTitles: 避けるべき名称,
    asOf: 基準の日時,
  });

  const 提案の1件たち: SuggestionEntry[] = [];
  for (const 生成結果 of 生成結果たち) {
    // 同じ名称の献立がすでに手元にあれば、それを指して次へ進む（規則10 / C-4）。突き合わせは
    // **両者の値をそのまま**比べるだけで、ここで詰め直しも畳み直しもしない — `createMeal` と
    // `createGeneratedMeal` が同じ正規化を1度ずつ通しており、2つ目の正規化の規則をここに
    // 置くと、片方だけ変わったときに突き合わせが静かにずれる（C-6 / ADR-037 理由(3)）。
    const 既存の献立の識別子 = 名称ごとの既存の献立.get(生成結果.title);
    if (既存の献立の識別子 !== undefined) {
      // 作らず、保存せず、識別子も発行しない。発行するのは新しく保存するぶんだけである
      // （規則12）。**直近の提案で除外した献立もここで参照されうる** — C-11 で外したものが
      // 生成の印のまま戻る穴は、稀なものとして明示的に許容されている（C-4b）。
      提案の1件たち.push(createSuggestionEntry({ mealId: 既存の献立の識別子, origin: 生成 }));
      continue;
    }

    // 生成結果は識別子も世帯も生成日時も持たない（ADR-035）。それを与えて献立にするのが
    // 呼ぶ側の仕事である。材料と手順は写すだけで、並べ替えも補完もしない（C-5）。
    const 献立 = createMeal({
      id: deps.generateMealId(),
      householdId,
      title: 生成結果.title,
      ingredients: 生成結果.ingredients,
      steps: 生成結果.steps,
      generatedAt: 基準の日時,
      // 生成された時点では作っていない。調理記録は「作った」を記録する周で増える（C-3 / C-8）。
      cookingRecords: [],
    });

    // 保存にも第1引数の世帯を渡す（C-9）。1件ずつ待つのは、保存できたものだけを
    // 提案に並べるためである（C-1）。
    await deps.mealRepository.save(householdId, 献立);

    提案の1件たち.push(createSuggestionEntry({ mealId: 献立.id, origin: 生成 }));
  }

  return 提案の1件たち;
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
 * 新しい順で、同じ生成日時は `MealId` の降順で閉じる（`新しい順`）。
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
function 避けるべき名称を組む(
  保持されている献立: readonly Meal[],
  直近の提案: readonly Suggestion[],
): readonly string[] {
  // 同じ識別子は同じ献立を指す。先に見たほうを残すのは、名称を畳むときと同じ扱いである。
  const 識別子ごとの名称 = new Map<MealId, string>();
  for (const 献立 of 保持されている献立) {
    if (!識別子ごとの名称.has(献立.id)) 識別子ごとの名称.set(献立.id, 献立.title);
  }

  // 直前の提案は直近の先頭である。1回も提案していなければ無い（規則6）。
  const 直前の提案 = 直近の提案[0];
  const 直前に並んだ名称 =
    直前の提案 === undefined
      ? []
      : 直前の提案.entries.flatMap((提案の1件) => {
          const 名称 = 識別子ごとの名称.get(提案の1件.mealId);
          // 引けなかった1件だけが落ちる。空文字で埋めると、避ける対象として意味の無い
          // 名称を外へ送ることになる（規則7）。
          return 名称 === undefined ? [] : [名称];
        });

  // 並べ替えるのは複製した配列であって、リポジトリが返した列ではない（B-27 規則17 / ADR-009）。
  const 蓄積の名称 = [...保持されている献立].sort(新しい順).map((献立) => 献立.title);

  const 出た名称たち = new Set<string>();
  const 避けるべき名称: string[] = [];
  for (const 名称 of [...直前に並んだ名称, ...蓄積の名称]) {
    if (出た名称たち.has(名称)) continue;
    出た名称たち.add(名称);
    避けるべき名称.push(名称);
  }

  // 畳んでから切る（規則8）。逆にすると、重なっていたぶんだけ渡せる名称が減る。
  return 避けるべき名称.slice(0, 避けるべき名称の上限);
}

/**
 * 名称から既存の献立の識別子を引けるようにする（B-28 規則10・11 / C-4）。生成結果の名称が
 * これに当たれば、新しい献立を作らずその献立を参照する。
 *
 * **同じ名称の献立が2件以上あるときは `MealId` の昇順の先頭を採る**（規則11 / ADR-036 決定2）。
 * `findByHousehold` は並び順を約束しない（ADR-038 決定1）ので、返った列の先頭を採ると参照先が
 * 実装ごとにぶれる。識別子で閉じれば、同じ手元の献立からは常に同じ1件を指す（C-12 の決定性）。
 * **`避けるべき名称を組む` の `新しい順` を流用しない** — あちらは何を避けるかの強さの順で
 * あって、どれを指すかの決着ではない。
 *
 * 受け取った列は読むだけで、その場で並べ替えない（B-27 規則17 / ADR-009）。小さいほうを
 * 拾い続けるので、複製して並べ替える必要もない。
 */
function 名称ごとの既存の献立を組む(
  保持されている献立: readonly Meal[],
): ReadonlyMap<string, MealId> {
  const 名称ごとの識別子 = new Map<string, MealId>();
  for (const 献立 of 保持されている献立) {
    const すでに引ける識別子 = 名称ごとの識別子.get(献立.title);
    if (すでに引ける識別子 === undefined || コード単位で比べる(献立.id, すでに引ける識別子) < 0) {
      名称ごとの識別子.set(献立.title, 献立.id);
    }
  }

  return 名称ごとの識別子;
}

/**
 * 蓄積の側の並び。**生成日時の新しい順、同じ生成日時は `MealId` の降順**で閉じる
 * （B-28 規則6 / ADR-038 決定1・2）。同時刻の決着をつけないと、同じ入力から渡す名称の
 * 並びが回ごとに変わる（C-12 の決定性）。`findByHousehold` は並び順を約束しないので、
 * 並べるのはこちらの仕事である。
 *
 * `DateTime` は UTC の正準形に正規化済みなので、文字列の大小がそのまま時刻の順になる。
 */
function 新しい順(左の献立: Meal, 右の献立: Meal): number {
  const 生成日時の差 = コード単位で比べる(右の献立.generatedAt, 左の献立.generatedAt);
  if (生成日時の差 !== 0) return 生成日時の差;

  return コード単位で比べる(右の献立.id, 左の献立.id);
}

/**
 * コード単位の大小で比べる（先行 `cookableMealsOf` / `ListStockItems`）。
 *
 * 照合順序は実行環境の ICU に依存するため `localeCompare` を使わない。コード単位なら
 * Workers と Node で同じ並びになる（ADR-036 結果8 / C-12 の決定性）。
 */
function コード単位で比べる(左: string, 右: string): number {
  if (左 < 右) return -1;
  if (左 > 右) return 1;
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
 * 提案を出力に写す。**この周で組んで保存した提案と、C-7 で短絡して返す保存済みの提案の
 * 両方が通る** — どちらも同じ写し方であり、短絡した回だけ識別子や生成日時を作り替えない
 * （B-28 規則1）。
 *
 * `entries` の並びは**組んだ順そのまま**である — 再利用なら C-12 の順、生成なら生成側が
 * 返した並びであり、ここで並べ替えない（FR-35 / C-2 / C-12 / B-27 規則16 / B-28 規則9）。
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
