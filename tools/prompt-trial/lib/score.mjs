// docs/prompt-design.md 第9.2章の評価観点のうち、機械的に測れるもの。
// 「意味的な重複」と「選べるか」は人が見る。ここでは測らない。
import { PANTRY_STAPLES } from './prompt.mjs';
import { projectStock } from './prompt.mjs';

const COOKING_METHODS = [
  { key: '炒', pattern: /炒め|炒る/ },
  { key: '煮', pattern: /煮|煮込|煮る/ },
  { key: '焼', pattern: /焼く|焼き|ソテー|グリル/ },
  { key: '蒸', pattern: /蒸す|蒸し/ },
  { key: '和', pattern: /和え|あえ/ },
  { key: '揚', pattern: /揚げ|フライ/ },
];

/** 表記ゆれの疑い: 完全一致しないが、片方が他方を含む。D-3 が崩れた兆候。 */
function looksLikeVariant(name, stockNames) {
  return stockNames.some((s) => s !== name && (s.includes(name) || name.includes(s)));
}

export function score({ stock, meals, avoidTitles = [], discarded = [] }) {
  const visible = projectStock(stock);
  const stockNames = visible.map((s) => s.name);
  const stockSet = new Set(stockNames);
  const urgentNames = new Set(
    visible.filter((s) => s.expiryInDays !== null && s.expiryInDays <= 1).map((s) => s.name),
  );
  const staples = new Set(PANTRY_STAPLES);
  const avoidSet = new Set(avoidTitles);

  let matched = 0;          // 在庫の表記と完全一致した主材料
  let variant = 0;          // 表記ゆれの疑い
  let missing = 0;          // 在庫にない主材料（= 不足材料）
  let kindCorrections = 0;  // リストにあるのに 'main' と申告され、倒し込まれた件数
  let seasoningTotal = 0;   // 'seasoning' と申告された材料
  let seasoningOffList = 0; // うち固定リストにないもの（ADR-023 の利点が出た件数）
  const missingPerMeal = [];

  for (const meal of meals) {
    kindCorrections += meal.kindCorrections ?? 0;
    let mealMissing = 0;
    for (const ing of meal.ingredients) {
      // C-16: 充足判定の対象は主材料だけ。調味料は数えない。
      if (ing.kind === 'seasoning') {
        seasoningTotal += 1;
        if (!staples.has(ing.name)) seasoningOffList += 1;
        continue;
      }
      if (stockSet.has(ing.name)) matched += 1;
      else {
        missing += 1;
        mealMissing += 1;
        if (looksLikeVariant(ing.name, stockNames)) variant += 1;
      }
    }
    missingPerMeal.push(mealMissing);
  }

  const usesUrgent = urgentNames.size === 0
    ? null // 判定対象なし
    : meals.some((m) => m.ingredients.some((i) => i.kind === 'main' && urgentNames.has(i.name)));

  const methods = new Set();
  for (const meal of meals) {
    const text = `${meal.title} ${meal.steps.join(' ')}`;
    for (const m of COOKING_METHODS) if (m.pattern.test(text)) methods.add(m.key);
  }

  const totalIngredients = matched + missing;
  return {
    mealCount: meals.length,
    ingredientNameMatchRate: totalIngredients === 0 ? null : matched / totalIngredients,
    variantSuspects: variant,
    kindCorrections,
    seasoningTotal,
    seasoningOffList,
    missingTotal: missing,
    missingMedian: median(missingPerMeal),
    missingOverLimit: missingPerMeal.filter((n) => n > 2).length, // 規則3（追加は2件まで）違反
    usesUrgentIngredient: usesUrgent,
    distinctCookingMethods: methods.size,
    exactAvoidHits: meals.filter((m) => avoidSet.has(m.title)).length,
    discardedCount: discarded.length,
  };
}

function median(values) {
  if (values.length === 0) return null;
  const s = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}
