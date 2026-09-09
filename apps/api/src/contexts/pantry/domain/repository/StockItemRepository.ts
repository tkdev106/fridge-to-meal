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
 * 実装（B-07）は Supabase に対して**利用者の JWT で問い合わせる**（ADR-020 / NFR-09）。
 * RLS が二重の網になるが、**網があることを理由にこの引数を外さない。**
 */
export interface StockItemRepository {
  /** 見つからないときは `null`。**他の世帯の在庫品も「無い」として扱う。** */
  findById(householdId: HouseholdId, id: StockItemId): Promise<StockItem | null>;

  /**
   * その世帯の在庫品をすべて返す。
   *
   * **並び順を約束しない。** 期限の近い順に見せるのは画面の要求（FR-04）であり、
   * 並べ替えはユースケース層で行う（B-05）。ここで順序を決めると、実装ごとに
   * 並びが変わる余地が残る。
   */
  list(householdId: HouseholdId): Promise<StockItem[]>;

  /**
   * 登録と更新を兼ねる。同じ `id` の在庫品があれば置き換える。
   *
   * 在庫品は不変なので、更新は「作り直したものを保存する」形になる（FR-05）。
   * `stockItem.householdId` と引数の `householdId` が食い違う場合、実装は保存を
   * 拒む。**食い違いは呼び出し側の誤りであり、黙って引数の側に寄せない。**
   */
  save(householdId: HouseholdId, stockItem: StockItem): Promise<void>;

  /**
   * 物理削除する（FR-06）。献立は材料を複製済みで在庫品を参照しないため、
   * 削除しても献立は壊れない（C-5）。
   *
   * 存在しない場合も、他の世帯の在庫品を指した場合も、**何もせずに成功する。**
   * 「消えている」という結果は同じであり、呼び出し側に他の世帯の在庫品の有無を
   * 知らせない。
   */
  delete(householdId: HouseholdId, id: StockItemId): Promise<void>;
}
