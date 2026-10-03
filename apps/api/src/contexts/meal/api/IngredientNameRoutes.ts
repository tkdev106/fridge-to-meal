// 食材名の経路（B-50b / FR-02 / ADR-063）。
//
// 呼んでよいのは usecase だけであり、`domain/` も `shared/domain/` も `identity/` の何も
// import しない（ADR-003 / ADR-032）。世帯の型はユースケースのシグネチャから導出する。

import type { ErrorResponseDto } from '@fridge-to-meal/contract';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { extractAccessToken } from './AccessToken.js';
import { statusOfThrown } from './RuleViolationStatus.js';
import type { ListIngredientNames } from '../usecase/ListIngredientNames.js';

/** 世帯は**中身を見ない値**として扱う。型はユースケースから引く（ADR-032 決定1）。 */
type HouseholdIdParam = Parameters<ListIngredientNames>[0];

export type IngredientNameRoutesDeps = {
  identifyHousehold: (accessToken: string) => Promise<HouseholdIdParam>;
  listIngredientNames: ListIngredientNames;
};

/**
 * 食材名の1経路（`GET /ingredient-names`）を持つサブアプリを組み立てる。
 * **接頭辞は付けない** — マウント先は `main.ts` が決める（ADR-048 決定4）。
 *
 * **`GET` に置く**（B-50b 規則2）— 読み取りだけで保存も生成も起こさず、**ADR-062 決定1 が
 * 提案の2経路に `POST` を選んだ理由（費用と副作用）が当たらない。** 同じ読み方の先行が
 * `GET /suggestions/latest`（ADR-065 決定2）で、在庫の `GET /stock-items` にも揃う。
 *
 * **要求の本体もクエリも1つも読まない**（規則3 / C-9 / ADR-028）— 世帯はアクセストークンから
 * だけ定まる。絞り込みは画面の仕事である（`docs/screen-design.md` 6章）。
 * **基準日時も取らない** — このユースケースは時刻に依存する判断を1つも持たない。
 */
export function createIngredientNameRoutes(deps: IngredientNameRoutesDeps): Hono {
  // `new` してよいのは Hono だけである（ADR-002）。
  const routes = new Hono();

  /**
   * 食材名の列を返す（FR-02）。**世帯を定めるのが常に先で**（規則4 / NFR-09）、認証を
   * 通らない要求ではユースケースを呼ばず DB に触れない。
   *
   * 通った回は 200 で、**出力を詰め替えも整形もせずそのまま返す**（規則6 / ADR-063 決定4）—
   * 並び（コード単位の昇順）も重複の畳み方（完全一致。C-6）もユースケースのものを保つ。
   * **0件でも 200 で空の列である**（規則7 / FR-03）— 補完が空であることは登録を止めない。
   */
  routes.get('/ingredient-names', async (c) => {
    try {
      // `Request` / `Context` はここに閉じ、ユースケースには世帯だけを渡す（ADR-003）。
      const household = await deps.identifyHousehold(
        extractAccessToken(c.req.header('Authorization')),
      );

      // 世帯は必ず第1引数（C-9）。
      return c.json(await deps.listIngredientNames(household), 200);
    } catch (thrown) {
      return reject(c, thrown);
    }
  });

  return routes;
}

/**
 * 投げられたものを応答に写す（B-50b 設計書7章）。表も既定も提案の経路と同じものを使う
 * （`RuleViolationStatus.ts`）— 表に無い献立の規則違反は 500 であり、**この経路も利用者の
 * 入力を受け取らないので 400 を既定にしない**（ADR-062 決定3）。
 *
 * **写せない失敗は 500 の `unexpected` に畳み、`message` を本体に出さない**
 * （NFR-09 / ADR-045 決定3）— 接続文字列や設定の中身が応答に漏れる経路を作らない。
 */
function reject(c: Context, thrown: unknown) {
  const mappedError = statusOfThrown(thrown);
  if (mappedError !== null) return c.json(mappedError.body, mappedError.status);

  // 応答には原因を出さない代わりに、サーバ側のログにだけ種類とメッセージを残す（応答の規則14 / NFR-09 は
  // 変えない）。スタックと `cause` は出さない — 接続の情報が混ざりうる。
  console.error(
    'unexpected',
    thrown instanceof Error ? `${thrown.name}: ${thrown.message}` : typeof thrown,
  );
  return c.json({ rule: 'unexpected' } satisfies ErrorResponseDto, 500);
}
