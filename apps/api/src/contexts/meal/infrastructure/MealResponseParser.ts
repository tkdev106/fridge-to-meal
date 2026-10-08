import { MealRuleViolation } from '../domain/error/MealRuleViolation.js';
import { amountOf } from '../domain/value/Amount.js';
import { cookingStepOf } from '../domain/value/CookingStep.js';
import type { CookingStep } from '../domain/value/CookingStep.js';
import { createGeneratedMeal } from '../domain/value/GeneratedMeal.js';
import type { GeneratedMeal } from '../domain/value/GeneratedMeal.js';
import { createMealIngredient } from '../domain/value/MealIngredient.js';
import type { MealIngredient, MealIngredientKind } from '../domain/value/MealIngredient.js';
import { STAPLE_SEASONINGS } from './MealGenerationPrompt.js';

/**
 * 検証の上限（prompt-design 6.2）。**プロンプトの指示（30字・6件・60字）より緩い** —
 * 指示は出力を短く保つためのもので、検証は壊れていないものを落とさないためのもの。
 */
const MAX_TITLE_LENGTH = 40;
const MAX_INGREDIENT_COUNT = 12;
const MAX_INGREDIENT_NAME_LENGTH = 30;
const MAX_AMOUNT_LENGTH = 30;
const MAX_STEP_COUNT = 8;
const MAX_STEP_LENGTH = 150;

/** 材料名を直すために受け取る、プロンプトに載せた在庫品の名称と分量（prompt-design 6.3）。 */
export type PromptedStockItem = { readonly name: string; readonly amount: string | null };

const stapleSeasonings: ReadonlySet<string> = new Set(STAPLE_SEASONINGS);

/**
 * 生成側の応答の文字列を検証し、通った生成結果を返す（prompt-design 6.1〜6.4。B-72 規則13〜19）。
 *
 * プロバイダに依らない（ADR-005 の `MealResponseParser`）。献立1件ごとに検証し、通らなかった
 * 献立だけを捨てる。**重複を落としてから `requiredCount` 件を採り**（6.4）、並べ替えない。
 *
 * `stockItems` はプロンプトに載せた在庫品で、在庫品の名称に分量が混じった材料名
 * （「たまご 2コ」）を在庫品の名称に直すためだけに使う（6.3 / D-3 の受け皿）。
 *
 * @throws {MealRuleViolation} 'mealGenerator.noIngredient' — `meals` が空の配列（在庫に食材が無い。ADR-091 決定2）
 * @throws {MealRuleViolation} 'mealGenerator.empty' — 抽出・構文・構造の失敗、または通った献立が0件
 */
export function parseMealResponse(
  text: string,
  requiredCount: number,
  stockItems: readonly PromptedStockItem[] = [],
): readonly GeneratedMeal[] {
  const json = extractJson(text);
  if (json === null) throw emptyResponse('応答から JSON を取り出せません');

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    // 構文の誤りの詳細は応答の中身を含みうるので載せない（NFR-11 / ADR-045 結果2）。
    throw emptyResponse('応答が JSON として読めません');
  }

  const rawMeals = isRecord(parsed) ? parsed.meals : undefined;
  if (!Array.isArray(rawMeals)) throw emptyResponse('応答に献立の列がありません');
  if (rawMeals.length === 0) {
    throw new MealRuleViolation(
      'mealGenerator.noIngredient',
      '在庫に食材が無いとして空の列が返りました',
    );
  }

  const correctedNames = correctedNameMap(stockItems);
  const seenTitles = new Set<string>();
  const generatedMeals: GeneratedMeal[] = [];
  for (const rawMeal of rawMeals) {
    const generatedMeal = generatedMealOf(rawMeal, correctedNames);
    // 重複は**検証を通った献立**どうしで比べ、後に出たものを捨てる（6.2 / C-13）。
    if (generatedMeal === null || seenTitles.has(generatedMeal.title)) continue;
    seenTitles.add(generatedMeal.title);
    generatedMeals.push(generatedMeal);
  }

  if (generatedMeals.length === 0) throw emptyResponse('検証を通る献立が1件もありません');
  // 重複を落とした後で切る（6.4）。先に切ると通せたはずの1件を落とす。
  return generatedMeals.slice(0, requiredCount);
}

/** 断りは1つの規則に揃える。message に応答の中身を載せない（NFR-11 / ADR-045 結果2）。 */
function emptyResponse(message: string): MealRuleViolation {
  return new MealRuleViolation('mealGenerator.empty', message);
}

/**
 * 段階1: 最初の `{` から対応する `}` までを取り出す（6.1）。文字列リテラルとエスケープを
 * 考慮する — 名称や手順に `}` が入っていても途中で切らない。見つからなければ `null`。
 */
function extractJson(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (character === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

/**
 * 献立1件を検証する。通らなければ `null`（6.2 / 6.3）。
 *
 * **ドメインの生成関数が投げる入力を作らない**（B-72 規則19）— 名称・材料・主材料・手順の
 * どれかが空になる献立はここで捨て、`generatedMeal.*` の違反が外へ出て 500 に化けないようにする。
 */
function generatedMealOf(
  rawMeal: unknown,
  correctedNames: ReadonlyMap<string, string>,
): GeneratedMeal | null {
  if (!isRecord(rawMeal)) return null;

  const title = trimmedString(rawMeal.title);
  if (title === null || title === '' || lengthOf(title) > MAX_TITLE_LENGTH) return null;

  const rawIngredients = rawMeal.ingredients;
  // 件数は捨てる前の、受け取った件数で数える（B-72 規則14）。
  if (
    !Array.isArray(rawIngredients) ||
    rawIngredients.length === 0 ||
    rawIngredients.length > MAX_INGREDIENT_COUNT
  ) {
    return null;
  }

  const rawSteps = rawMeal.steps;
  if (!Array.isArray(rawSteps) || rawSteps.length === 0 || rawSteps.length > MAX_STEP_COUNT) {
    return null;
  }

  const ingredients = ingredientsOf(rawIngredients, correctedNames);
  if (ingredients.length === 0) return null;
  // 主材料が無い献立は充足が常に「作れる」になる（C-16）。
  if (!ingredients.some((ingredient) => ingredient.kind === 'main')) return null;

  const steps = stepsOf(rawSteps);
  if (steps.length === 0) return null;

  return createGeneratedMeal({ title, ingredients, steps });
}

/** 材料を検証して正規化する。同じ名称は残った材料のうち最初の1件だけを残す（6.3）。 */
function ingredientsOf(
  rawIngredients: readonly unknown[],
  correctedNames: ReadonlyMap<string, string>,
): MealIngredient[] {
  const seenNames = new Set<string>();
  const ingredients: MealIngredient[] = [];
  for (const rawIngredient of rawIngredients) {
    if (!isRecord(rawIngredient)) continue;
    const trimmedName = trimmedString(rawIngredient.name);
    if (trimmedName === null) continue;
    // 名称を直すのは他の検証と正規化より前（6.3）。
    const name = correctedNames.get(trimmedName) ?? trimmedName;
    if (name === '' || lengthOf(name) > MAX_INGREDIENT_NAME_LENGTH) continue;
    if (seenNames.has(name)) continue;
    seenNames.add(name);

    const rawAmount = trimmedString(rawIngredient.amount) ?? '';
    // 長すぎる分量は材料を捨てずに「分量なし」へ丸める（6.2）。
    const amount = amountOf(lengthOf(rawAmount) > MAX_AMOUNT_LENGTH ? '' : rawAmount);

    ingredients.push(
      createMealIngredient({ name, kind: kindOf(name, rawIngredient.kind), amount }),
    );
  }
  return ingredients;
}

/**
 * 種別を決める（6.2 / 6.3 / D-1）。申告が `seasoning` ならそのまま、それ以外（欠落を含む）は
 * `main` に倒す。**常備調味料に完全一致する名称は申告によらず `seasoning`** — 逆向きはしない。
 * リストにない調味料を `main` に戻すと、リストが調味料の上限に戻る（ADR-023）。
 */
function kindOf(name: string, rawKind: unknown): MealIngredientKind {
  if (stapleSeasonings.has(name)) return 'seasoning';
  return rawKind === 'seasoning' ? 'seasoning' : 'main';
}

/** 手順を検証して正規化する。空・長すぎる・文字列でない手順だけを捨てる（6.2）。 */
function stepsOf(rawSteps: readonly unknown[]): CookingStep[] {
  const steps: CookingStep[] = [];
  for (const rawStep of rawSteps) {
    const step = trimmedString(rawStep);
    if (step === null || step === '' || lengthOf(step) > MAX_STEP_LENGTH) continue;
    steps.push(cookingStepOf(step));
  }
  return steps;
}

/**
 * 「在庫品の名称＋半角空白＋その分量」→ 在庫品の名称 の表（6.3）。在庫品の名称と完全一致する
 * 文字列は直さない — 在庫にその名称があるなら、それが正しい表記である。
 */
function correctedNameMap(stockItems: readonly PromptedStockItem[]): ReadonlyMap<string, string> {
  const stockNames = new Set(stockItems.map((stockItem) => stockItem.name));
  const correctedNames = new Map<string, string>();
  for (const stockItem of stockItems) {
    if (stockItem.amount === null) continue;
    const mixedName = `${stockItem.name} ${stockItem.amount}`;
    if (stockNames.has(mixedName) || correctedNames.has(mixedName)) continue;
    correctedNames.set(mixedName, stockItem.name);
  }
  return correctedNames;
}

/** 文字列なら前後の空白を落として返す。文字列でなければ `null`。 */
function trimmedString(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() : null;
}

/** 字数はコードポイントで数える（B-72 規則17）。 */
function lengthOf(value: string): number {
  return [...value].length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
