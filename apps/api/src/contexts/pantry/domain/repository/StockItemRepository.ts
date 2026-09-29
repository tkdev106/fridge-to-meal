import type { HouseholdId } from '../../../../shared/domain/HouseholdId.js';
import type { StockItem } from '../entity/StockItem.js';
import type { StockItemId } from '../value/StockItemId.js';

/**
 * 在庫品の永続化の出口。**interface だけを置き、実装はインフラ層に持つ**（ADR-002）。
 *
 * **全メソッドが `householdId` を必須引数に取る**（C-9）。世帯をまたぐ取得を型として
 * 不可能にするためであり、**在庫品自身が `householdId` を持っていても省かない。**
 * 省いてよいのは実装が正しいときだけで、それは型では確かめられない。引数にあれば、
 * 世帯を渡し忘れた問い合わせはコンパイルを通らない。
 *
 * 実装（B-07）は**利用者の世帯のクレームを張った接続で問い合わせる**（ADR-029 / NFR-09）。
 * RLS が二重の網になるが、**網があることを理由にこの引数を外さない。**
 */
export interface StockItemRepository {
  /** 見つからないときは `null`。**他の世帯の在庫品も「無い」として扱う。** */
  findById(householdId: HouseholdId, id: StockItemId): Promise<StockItem | null>;

  /**
   * その世帯の在庫品をすべて返す。
   *
   * 名前は ADR-002 の結果が挙げた例（`findByHousehold`）に合わせた。全メソッドが
   * `householdId` を取るので `ByHousehold` は冗長だが、**後続のリポジトリが同じ判断を
   * やり直さずに済むほうを採る。**
   *
   * **並び順を約束しない。** 期限の近い順に見せるのは画面の要求（FR-04）であり、
   * 並べ替えはユースケース層で行う（B-05）。ここで順序を決めると、実装ごとに
   * 並びが変わる余地が残る。
   */
  findByHousehold(householdId: HouseholdId): Promise<StockItem[]>;

  /**
   * その世帯でこれまでに保存したことのある在庫品の名称をすべて返す（FR-02 / B-50d）。
   *
   * **`save` は在庫品を保存するたびに、その名称を世帯の名称として残す。** 登録と更新を
   * 区別しない。残すのはドメインで前後の空白を落とした後の値で、同じ世帯・同じ名称
   * （完全一致。C-6）は1つとして残し、2度目の保存を断らない。表記の違う名称は別に残す
   * （ADR-063 決定4）。`save.householdMismatch` で断った回は名称も残さない。
   *
   * **`delete` は名称を消さない。** 消した在庫品の名称もここに残る — 補完に出すのは
   * 「その世帯が過去に入力した食材名」であり、今ある在庫品に限らない（FR-02）。
   *
   * 引数の世帯の名称だけを返す（C-9）。0件なら空の配列。**並び順を約束しない** —
   * 全件を返す口であり、並べ替えはユースケース層で行う（先行 `findByHousehold`）。
   */
  findSavedNamesByHousehold(householdId: HouseholdId): Promise<string[]>;

  /**
   * 登録（FR-01）と更新（FR-05）の永続化を兼ねる。同じ `id` の在庫品があれば置き換える。
   *
   * **更新は「作り直したものを保存する」形をとる**（B-06）。在庫品は不変であり、
   * `withAmountAndExpiryDate` が分量と期限だけを差し替えた在庫品を作って渡す。
   * このメソッドから見れば、登録も更新も同じ「同じ id なら置き換える」1つの操作である。
   * `stockItem.householdId` と引数の `householdId` が食い違う場合、実装は
   * **`PantryRuleViolation`（`rule: 'save.householdMismatch'`）を投げて保存を拒む。**
   * 食い違いは呼び出し側の誤りであり、黙って引数の側に寄せない。interface では
   * 強制できない約束なので、**実装ごとにテストで確かめる。**
   */
  save(householdId: HouseholdId, stockItem: StockItem): Promise<void>;

  /**
   * 物理削除する（FR-06）。献立は材料を複製済みで在庫品を参照しないため、
   * 削除しても献立は壊れない（C-5）。
   *
   * 存在しない場合も、他の世帯の在庫品を指した場合も、**何もせずに成功する。**
   * どちらも「消えている」という結果は同じであり、ここで区別を作らない。
   *
   * **これはリポジトリの契約であって、アプリの振る舞いではない。** 利用者に対しては
   * 消せなかったことを断る（`DeleteStockItem` が `delete` の前に `findById` で確かめる。
   * ADR-027）。存在しないのか他の世帯のものなのかを漏らさない役割は、
   * そちらでも同じく果たされる。
   */
  delete(householdId: HouseholdId, id: StockItemId): Promise<void>;

  /**
   * その世帯の在庫品と、保存したことのある在庫品の名称をすべて消す（FR-27 / NFR-13 / B-56a）。
   *
   * **`delete` は名称を消さないが、これは名称も消す**（ADR-072 結果1。ADR-069 決定1 の例外）。
   * 引数の世帯の行だけを消し、他の世帯の行は1行も消さない（C-9）。消す物が無くても、
   * 2度目の呼び出しでも、何もせずに成功する（B-56a 規則7）。
   */
  deleteByHousehold(householdId: HouseholdId): Promise<void>;
}
