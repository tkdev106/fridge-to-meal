// 献立の DTO（B-48a）。web と api がここだけを共有する（ADR-003）。
//
// ここにあるのは型だけであり、実行時の検証も関数も持たない。
// 世帯・調理記録・献立の生成日時はどの型にも持たせない（C-9 / NFR-09 / B-48a 規則12）。
// **例外は2つだけ** — 献立詳細の出力 `ShowMealOutput` の `cooked`（記録の有無の真偽1つ。
// ADR-070 決定1・2）と、献立の一覧の1件が持つその列の日時（`SeenMealSummaryOutput.generatedAt` /
// `CookedMealSummaryOutput.cookedAt`。ADR-083 決定2）である。記録の件数と全件の日時はどこにも載せない。
// 由来と種別の union は domain の型を import せず、同じ値をここにも持つ（ADR-003）。

/** 提案の1件の由来（FR-35 / C-4c）。 */
export type SuggestionEntryOrigin = 'generated' | 'reused';

/** 材料の種別（C-16）。 */
export type MealIngredientKind = 'main' | 'seasoning';

/** 材料1件。分量は自由文字列で、未設定は null（ADR-010）。キーは省略しない。 */
export type MealIngredientDto = {
  name: string;
  kind: MealIngredientKind;
  amount: string | null;
};

/** 賄える材料。expiryDate は同じ名称の在庫品の最も早い期限。期限を持つ在庫品が無ければ null */
export type CoveredMealIngredientDto = MealIngredientDto & { expiryDate: string | null };

/** 現在の在庫での充足（FR-17 / ADR-009）。 */
export type MealCoverageDto = {
  covered: CoveredMealIngredientDto[];
  missing: MealIngredientDto[];
};

/**
 * 献立1件ぶんの中身。識別子・名称・材料・手順と、**現在の在庫での充足**を載せる（FR-30 / FR-32）。
 *
 * **由来（`origin`）は持たない**（ADR-067 論点1）— 由来は提案の1件の性質であって献立の性質
 * ではなく、履歴から開いた献立には由来が無い（FR-35）。世帯・調理記録・生成日時も
 * 持たない（B-48a 規則12 / NFR-09）。
 *
 * **B-48a の `SuggestionEntryOutput` から切り出したものであり、JSON の形は変えていない。**
 */
export type MealOutput = {
  mealId: string;
  title: string;
  ingredients: MealIngredientDto[];
  steps: string[];
  coverage: MealCoverageDto;
};

/** 献立詳細の出力。献立1件の中身に、調理記録が1件以上あるかだけを足したもの（ADR-070） */
export type ShowMealOutput = MealOutput & { cooked: boolean };

/** 提案の1件。献立1件の中身に、その回の由来（FR-35 / C-4c）だけを足したものである。 */
export type SuggestionEntryOutput = MealOutput & { origin: SuggestionEntryOrigin };

/**
 * 提案1回ぶん。generatedAt は UTC の正準形。
 *
 * B-31b までは usecase に置かれていた型であり（ADR-041 決定2・結果3）、B-48a で contract へ移り、
 * 提案の1件が献立の中身と充足を載せるようになった。
 */
export type SuggestionOutput = {
  id: string;
  entries: SuggestionEntryOutput[];
  generatedAt: string;
};

/**
 * 提案の結末。`outcome` で判別する（ADR-041 決定1）。
 * 在庫が足りない回も上限に達した回も失敗でも規則違反でもないので、投げも `null` も使わない。
 *
 * `<ユースケース>Output` がそのユースケースの戻り値である先行（`ListStockItemsOutput`）に
 * 合わせ、union のほうが `SuggestMealsOutput` を名乗る。判別子に `kind` を使わないのは、
 * 材料の `kind`（主材料／調味料。C-16）が同じ語を別の意味で持っているためである。
 *
 * `'generationLimitReached'` が S-7 である（NFR-C2 / ADR-049 結果5）。
 */
export type SuggestMealsOutput =
  | { outcome: 'suggested'; suggestion: SuggestionOutput }
  | { outcome: 'insufficientStockItems' }
  | { outcome: 'generationLimitReached' };

/**
 * 保存済みの提案を読み取り専用で返す結末（B-58）。
 *
 * **`SuggestMealsOutput` と別の型である。** あちらは生成を呼びうる経路の結末で、在庫が足りない
 * （S-4）・上限に達した（S-7）という結末を持つ。こちらは**生成を一切呼ばない**ので、その2つは
 * 起こりえず、代わりに「**まだ1件も保存されていない**」が起こる。
 *
 * **献立タブはこちらで描く**（2026-09-24 にユーザーが決定。ADR-065 決定1）— 画面を出すだけで
 * 1日10回の枠（NFR-C2）を使わないためであり、生成は明示操作（FR-36）だけで起こる。
 */
export type ShowLatestSuggestionOutput =
  | {
      outcome: 'suggested';
      suggestion: SuggestionOutput;
      /**
       * 保存時の在庫スナップショットが、現在の在庫と食い違うか（C-7 と同じ比較）。
       *
       * **真なら、押せば違う献立が出る見込みがある** — 画面が「新しい献立を見る」（FR-36）へ
       * 誘う手がかりになる。偽なら、いま押しても同じ在庫から組み直すだけである。
       * **どう見せるか（出さないことも含めて）は画面が決める**（ADR-065 結果2）。
       * **この周では画面はまだ使わない。**
       */
      pantryChanged: boolean;
    }
  | { outcome: 'none' };

/**
 * 献立の一覧の1件に共通する部分（B-54a / FR-28 / FR-29）。識別子・名称・**主材料の件数**を持つ。
 * 列ごとの日時は `SeenMealSummaryOutput` / `CookedMealSummaryOutput` が足す（ADR-083 決定2）。
 *
 * 世帯・調理記録（件数・全件の日時・有無の真偽）・充足・材料と手順の中身を載せない
 * （B-48a 規則12 / NFR-09）。
 */
export type MealSummaryOutput = {
  mealId: string;
  title: string;
  /** 主材料の件数。調味料を数えない（C-16）。 */
  ingredientCount: number;
};

/**
 * 世帯の献立の一覧（B-54a / ADR-068）。調理記録の無い献立は `seen`、ある献立は `cooked` に入る。
 * **一覧では、調理記録の有無はどちらの列に入るかでだけ表れる**（ADR-068 決定3。詳細の `ShowMealOutput.cooked` は ADR-070）。
 * どちらの列もその列の日時の降順で、同時刻は `mealId` の昇順に並ぶ（ADR-083 決定1）。
 */
export type ListMealsOutput = {
  seen: SeenMealSummaryOutput[];
  cooked: CookedMealSummaryOutput[];
};

/** 「以前見た献立」の1件（ADR-083 決定2）。献立の生成日時を UTC の ISO 8601 文字列で持つ。 */
export type SeenMealSummaryOutput = MealSummaryOutput & { generatedAt: string };

/** 「作った献立」の1件（ADR-083 決定2）。直近の調理記録の日時を UTC の ISO 8601 文字列で持つ。 */
export type CookedMealSummaryOutput = MealSummaryOutput & { cookedAt: string };
