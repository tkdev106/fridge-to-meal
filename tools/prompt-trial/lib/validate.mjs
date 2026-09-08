// docs/prompt-design.md 第6章の検証規則。腐敗防止層に入る予定のものを、そのまま試行に使う。
import { PANTRY_STAPLES } from './prompt.mjs';

const LIMITS = {
  titleMax: 40,
  ingredientsMin: 1,
  ingredientsMax: 12,
  nameMax: 30,
  amountMax: 30,
  stepsMin: 1,
  stepsMax: 8,
  stepMax: 150,
};

/** 段階1: 応答文字列から最初の JSON オブジェクトを取り出す。 */
export function extractJson(raw) {
  if (typeof raw !== 'string') return null;
  const start = raw.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i += 1) {
    const ch = raw[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return null;
}

const trim = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * 第6章の全段階を通す。
 * @returns {{ ok: boolean, meals: object[], failure: string|null, discarded: string[] }}
 */
export function validate(raw, { requiredCount, precedingTitles = [] } = {}) {
  const discarded = [];
  const json = extractJson(raw);
  if (json === null) return { ok: false, meals: [], failure: 'JSON を抽出できない', discarded };

  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    return { ok: false, meals: [], failure: `JSON として解析できない: ${e.message}`, discarded };
  }
  if (!Array.isArray(parsed?.meals)) {
    return { ok: false, meals: [], failure: 'meals が配列でない', discarded };
  }

  const staples = new Set(PANTRY_STAPLES);
  const preceding = new Set(precedingTitles);
  const seenTitles = new Set();
  const accepted = [];

  for (const meal of parsed.meals) {
    const drop = (reason) => discarded.push(`${trim(meal?.title) || '(名称なし)'}: ${reason}`);

    const title = trim(meal?.title);
    if (!title || title.length > LIMITS.titleMax) { drop('title が空か長すぎる'); continue; }
    if (seenTitles.has(title)) { drop('同じ応答内で title が重複'); continue; }
    // FR-36: 新しさを求めた操作で、直前に見ていた献立を返させない
    if (preceding.has(title)) { drop('直前の提案に含まれていた献立と同名'); continue; }

    if (!Array.isArray(meal.ingredients)
      || meal.ingredients.length < LIMITS.ingredientsMin
      || meal.ingredients.length > LIMITS.ingredientsMax) { drop('ingredients の件数が範囲外'); continue; }
    if (!Array.isArray(meal.steps)
      || meal.steps.length < LIMITS.stepsMin
      || meal.steps.length > LIMITS.stepsMax) { drop('steps の件数が範囲外'); continue; }

    const seenNames = new Set();
    const ingredients = [];
    let kindCorrections = 0;
    for (const ing of meal.ingredients) {
      const name = trim(ing?.name);
      if (!name || name.length > LIMITS.nameMax) continue;
      if (seenNames.has(name)) continue;
      seenNames.add(name);

      // 6.2: 'main' / 'seasoning' 以外と欠落は 'main' に倒す（C-16）
      let kind = ing?.kind === 'seasoning' ? 'seasoning' : 'main';
      // 6.3 正規化: リストにある名称は申告によらず調味料に倒す。**倒し込みは片側だけ** —
      // リストにないものを 'main' に戻すと、リストが再び調味料の上限になる（ADR-023）。
      if (staples.has(name) && kind !== 'seasoning') { kind = 'seasoning'; kindCorrections += 1; }

      let amount = trim(ing?.amount);
      if (amount.length > LIMITS.amountMax) amount = '';
      ingredients.push({ name, amount, kind });
    }
    if (ingredients.length === 0) { drop('正規化の結果 ingredients が0件'); continue; }
    if (!ingredients.some((i) => i.kind === 'main')) { drop('主材料が0件'); continue; }

    const steps = meal.steps.map(trim).filter((s) => s.length > 0 && s.length <= LIMITS.stepMax);
    if (steps.length === 0) { drop('正規化の結果 steps が0件'); continue; }

    seenTitles.add(title);
    accepted.push({ title, ingredients, steps, kindCorrections });
  }

  // 6.4: 多い場合は先頭から採る。少ない場合はその件数で提案を組む（論点1）。
  const meals = accepted.slice(0, requiredCount);
  // 0件判定は切り詰めの**後**に行う。ok === true なら meals は必ず1件以上ある。
  if (meals.length === 0) {
    return { ok: false, meals: [], failure: '検証を通った献立が0件', discarded };
  }
  return { ok: true, meals, failure: null, discarded };
}
