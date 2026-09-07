// docs/prompt-design.md 第4章・第5章の実装。
// この文字列が設計文書とずれたら、直すのは文書ではなくこちら。

/** D-1 の常備調味料。材料に書かせず、手順の中に分量とともに書かせる。 */
export const PANTRY_STAPLES = [
  '塩', 'こしょう', '砂糖', '醤油', '味噌', '酢', 'みりん', '酒',
  'サラダ油', 'ごま油', '片栗粉', '小麦粉', 'だしの素', 'コンソメ',
  '鶏がらスープの素', 'マヨネーズ', 'ケチャップ', 'バター',
];

export const SYSTEM_PROMPT = `あなたは日本の家庭の食事を組み立てる調理の専門家です。
冷蔵庫にある食材の一覧を受け取り、その食材で作れる家庭向けの献立を提案します。

# 守ること

1. 指定された JSON だけを出力する。前置き、説明、コードブロックの記号を書かない。
2. 1件の献立は主菜1品とする。副菜や汁物をまとめて1件にしない。分量は2人分とする。
3. 材料には、在庫にある食材を優先して使う。在庫にない食材を足してよいのは
   1件の献立につき2つまでとする。
4. 在庫にある食材を材料に書くときは、在庫に書かれている名称をそのまま使う。
   「豚こま肉」を「豚肉」や「豚こま」に書き換えない。
5. 次の常備調味料は材料に書かない。手順の中に分量とともに書く。
   ${PANTRY_STAPLES.join('、')}
   ここに挙げていない調味料（オイスターソース、豆板醤など）は材料に書く。
6. 期限が近い食材を優先して使う。「期限は今日」「期限まであと1日」と書かれた
   食材がある場合、少なくとも1件の献立でそれを主な材料として使う。
7. 調理時間は40分以内、手順は6ステップ以内に収める。
   1ステップは60字以内で、一続きの作業を1文で書く。
8. 「避けたい献立」に挙げられたものを提案しない。名称の書き方が違っても、
   同じ食材を同じ調理法で扱うものは同じ献立とみなして避ける。
   例:「豚肉と白菜の炒め物」と「豚こまと白菜の中華炒め」は同じ。
9. 複数件を提案するときは、互いに調理法を変える。
   炒める・煮る・焼く・蒸す・和える・揚げるが重ならないようにする。
10. 肉・魚・卵は必ず十分に加熱する手順を書き、加熱の目安時間を添える。
    確信のない分量や加熱時間を書かない。書けない場合は別の献立にする。
11. 名称は30字以内で、主な食材と調理法が分かるものにする。

# 出力する JSON の形式

{
  "meals": [
    {
      "title": "献立の名称",
      "ingredients": [
        { "name": "食材名", "amount": "分量" }
      ],
      "steps": [
        "手順1", "手順2"
      ]
    }
  ]
}

meals の件数は、指示された件数と正確に一致させる。
ingredients は1件以上10件以内、steps は3件以上6件以内とする。
amount は「200g」「1/4個」「大さじ2」のような文字列にする。
上記以外のフィールドを追加しない。`;

/** 応答 JSON の形。構造化出力に対応したプロバイダへ渡す。 */
export const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    meals: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          ingredients: {
            type: 'array',
            items: {
              type: 'object',
              properties: { name: { type: 'string' }, amount: { type: 'string' } },
              required: ['name', 'amount'],
              additionalProperties: false,
            },
          },
          steps: { type: 'array', items: { type: 'string' } },
        },
        required: ['title', 'ingredients', 'steps'],
        additionalProperties: false,
      },
    },
  },
  required: ['meals'],
  additionalProperties: false,
};

/** D-2: 期限は日付ではなく残日数の文言に変換して渡す。 */
export function expiryLabel(expiryInDays) {
  if (expiryInDays === null || expiryInDays === undefined) return '';
  if (expiryInDays === 0) return '期限は今日';
  if (expiryInDays >= 1 && expiryInDays <= 7) return `期限まであと${expiryInDays}日`;
  return '期限に余裕あり';
}

/**
 * D-5: 期限を過ぎた在庫はプロンプトに載せない。
 * 在庫スナップショットからは落とさない — ここはプロンプトへの射影だけを担う。
 */
export function projectStock(stock) {
  return stock
    .filter((item) => item.expiryInDays === null || item.expiryInDays === undefined || item.expiryInDays >= 0)
    .slice()
    .sort((a, b) => {
      const av = a.expiryInDays ?? Number.POSITIVE_INFINITY;
      const bv = b.expiryInDays ?? Number.POSITIVE_INFINITY;
      return av - bv;
    });
}

/** 第5.1章のテンプレート。表組みを使わず1行1件にしてトークンを抑える。 */
export function buildUserMessage({ stock, requiredCount, avoidTitles = [] }) {
  const lines = projectStock(stock).map((item) => {
    const parts = [item.name];
    if (item.amount) parts.push(item.amount);
    const label = expiryLabel(item.expiryInDays);
    if (label) parts.push(label);
    return `- ${parts.join(' ')}`;
  });

  const sections = [
    `# 今日の在庫\n\n${lines.join('\n')}`,
    `# 提案してほしい件数\n\n${requiredCount}件`,
  ];
  // 避けたい献立が0件のときは節ごと出さない。空の見出しは無意味なトークンである。
  if (avoidTitles.length > 0) {
    sections.push(`# 避けたい献立\n\n${avoidTitles.map((t) => `- ${t}`).join('\n')}`);
  }
  return sections.join('\n\n');
}

/** 第8章: そもそも生成を呼ばない条件。呼ばない理由を返す（呼んでよければ null）。 */
export function skipReason(stock) {
  const visible = projectStock(stock);
  if (visible.length === 0) return 'プロンプトに載る在庫が0件';
  if (visible.length === 1) return 'プロンプトに載る在庫が1件（主菜3件は成立しない）';
  return null;
}
