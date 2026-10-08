/**
 * 画面の骨組み。構造は `docs/screen-design.md` に定めてある。
 * 下タブ3つ（献立 / 在庫 / 履歴）の器は `navigation/TabbedScreen.tsx` にあり、門は
 * **3つの中身を組み立てて渡すだけ**である（B-38 設計 10章）。**起動時に開くのは献立タブである**
 * （2026-09-24 にユーザーが決定。ADR-064 / 要件 第7章 / 同書 2.2。反映は B-49a）。
 *
 * **文言と配色は決まっていない**（同書 冒頭）。ここに書く日本語も仮である。
 *
 * **ここは門である**（ADR-046 結果4 / B-35 設計 6章 規則1・2）。`Session.subscribe` の3値で
 * 「何も出さない／ログイン／今の画面」を出し分ける。セッションは props で受け取り、
 * 実装を `new` するのは `main.tsx` だけ（規則3）。
 */
import { useEffect, useState } from 'react';
import { SignedOutScreen } from './features/identity/SignedOutScreen.js';
import { SettingsScreen } from './features/identity/SettingsScreen.js';
import { HouseholdJoinScreen } from './features/identity/HouseholdJoinScreen.js';
import { householdJoinNoticeOf } from './features/identity/HouseholdJoinNotice.js';
import type { HouseholdMemberCountState } from './features/identity/SettingsScreen.js';
import { HistoryTab } from './features/meal/HistoryTab.js';
import type { HistoryTabState } from './features/meal/HistoryTab.js';
import { cookingRecordFailureNoticeOf } from './features/meal/CookingRecordFailureNotice.js';
import type { CookingRecordFailureNotice } from './features/meal/CookingRecordFailureNotice.js';
import { MealDetail } from './features/meal/MealDetail.js';
import type { MealDetailState } from './features/meal/MealDetail.js';
import type { MealsTabState } from './features/meal/MealsTab.js';
import { MealsTab } from './features/meal/MealsTab.js';
import { deleteFailureNoticeOf } from './features/pantry/DeleteFailureNotice.js';
import type { IngredientNamesState } from './features/pantry/IngredientNameOptions.js';
import type { PantryListState } from './features/pantry/PantryList.js';
import { PantryTab } from './features/pantry/PantryTab.js';
import { todayOf } from './features/pantry/RemainingDays.js';
import type { TabId } from './navigation/Tabs.js';
import { DEFAULT_TAB } from './navigation/Tabs.js';
import { TabbedScreen } from './navigation/TabbedScreen.js';
import type { Session, SessionState } from './session/Session.js';
import type { Connectivity, ConnectivityState } from './connectivity/Connectivity.js';
import { OfflineBanner } from './connectivity/OfflineBanner.js';
import { useBackHandler } from './backNavigation/BackHandler.js';
import type {
  DeleteStockItem,
  ListStockItems,
  RegisterStockItem,
  UpdateStockItem,
} from './server/StockItemRequests.js';
import type { ListIngredientNames } from './server/IngredientNameRequests.js';
import type { RequestNewMeals, ShowLatestSuggestion } from './server/SuggestionRequests.js';
import type { AddCookingRecord, ListMeals, ShowMeal } from './server/MealRequests.js';
import type { DeleteHouseholdData } from './server/HouseholdDataRequests.js';
import type {
  CreateHouseholdInvitation,
  JoinHousehold,
  JoinHouseholdOutcome,
  LeaveHousehold,
  ShowHouseholdMemberCount,
} from './server/HouseholdRequests.js';
import type { ClipboardWriter } from './clipboard/ClipboardWriter.js';
import type { PendingHouseholdInvitation } from './householdInvitation/PendingHouseholdInvitation.js';

export type AppProps = {
  /** セッションの継ぎ目。画面はこの型だけを見る（ADR-046 決定3）。 */
  session: Session;
  /**
   * 在庫一覧を取りに行く口（B-22 設計 5章）。**組み立てるのは `main.tsx` だけ**であり、
   * 門は呼ぶだけで、基点も `fetch` もトークンの取り出し方も知らない。
   */
  listStockItems: ListStockItems;
  /** 在庫を登録しに行く口（B-24）。組み立てるのは `main.tsx` だけである。 */
  registerStockItem: RegisterStockItem;
  /** 在庫を削除しに行く口（B-23）。同じく組み立てるのは `main.tsx` だけである。 */
  deleteStockItem: DeleteStockItem;
  /**
   * 在庫品1件を更新しに行く口（FR-05 / B-55）。組み立てるのは `main.tsx` だけである。
   *
   * **通った回だけ門が一覧を取り直す**（設計 規則9）。結末はそのまま画面へ返し、断りの
   * 文言を選ぶのは `StockItemEditForm` の側である（ADR-032 決定3）。
   */
  updateStockItem: UpdateStockItem;
  /**
   * 保存済みの提案を取りに行く口（B-49a / B-58）。組み立てるのは `main.tsx` だけである。
   *
   * **在庫の口と同じく、門はサインイン済みになったら1度だけ呼ぶ。** この経路は生成を
   * 呼ばないので（ADR-065 決定1）、開かれるまで待つ理由が無い。
   */
  showLatestSuggestion: ShowLatestSuggestion;
  /**
   * 補完の元になる食材名を取りに行く口（FR-02 / B-50c）。組み立てるのはやはり `main.tsx`
   * だけである。
   *
   * **在庫の口と同じ構えで呼ぶ** — サインイン済みのときだけ取りに行き、**登録が通った回と
   * 消えたと読めた回に取り直す**（名称の出所が在庫品の名称だからである。ADR-063 決定2）。
   * 読み取りだけの `GET` なので、取り直しても費用も 1日10回の枠（NFR-C2）も使わない。
   */
  listIngredientNames: ListIngredientNames;
  /**
   * 「新しい献立を求める」操作（B-49b / FR-36）。組み立てるのは `main.tsx` だけである。
   *
   * 送信中フラグ・失敗フラグの state、結果の反映、在庫の登録・削除が通った回の取り直しは
   * 下の `handleRequestNewMeals` と `showLatestSuggestion` の効果が持つ。
   */
  requestNewMeals: RequestNewMeals;
  /**
   * 献立1件を取りに行く口（B-53 / B-52）。組み立てるのは `main.tsx` だけである。
   *
   * **開かれるまで呼ばない** — 充足は開いた時点の在庫で算出されたものでなければならず
   * （FR-32 / ADR-009）、先に取っておくと古い判定を見せることになる。
   */
  showMeal: ShowMeal;
  /**
   * 調理記録を1件足す口（FR-22 / B-51）。組み立てるのは `main.tsx` だけである。
   *
   * **「作った」を記録しても在庫は減らさない**（C-8）— 記録が通った回に在庫も提案も
   * 取り直さない。
   */
  addCookingRecord: AddCookingRecord;
  /** 献立の履歴を取りに行く口（B-54b）。組み立てるのは `main.tsx` だけである。 */
  listMeals: ListMeals;
  /** 世帯のデータを消す口（B-56f）。組み立てるのは `main.tsx` だけである。 */
  deleteHouseholdData: DeleteHouseholdData;
  /** 接続状態の継ぎ目（B-70 設計 5章）。**必須**であり、組み立てるのは `main.tsx` だけである。 */
  connectivity: Connectivity;
  /** 世帯の人数を取りに行く口（B-76 / FR-47）。組み立てるのは `main.tsx` だけである。 */
  showHouseholdMemberCount: ShowHouseholdMemberCount;
  /** 招待を作る口（B-76 / FR-44）。組み立てるのは `main.tsx` だけである。 */
  createHouseholdInvitation: CreateHouseholdInvitation;
  /** 世帯を抜ける口（B-76 / FR-46）。組み立てるのは `main.tsx` だけである。 */
  leaveHousehold: LeaveHousehold;
  /** 文字を写す継ぎ目（B-76）。`new` するのは `main.tsx` だけである。 */
  clipboard: ClipboardWriter;
  /** 招待リンクの基点（B-76 規則6）。末尾の `/` を持たない値（`location.origin`）を `main.tsx` が渡す。 */
  webOrigin: string;
  /** 招待のトークンで世帯に参加する口（B-77 / FR-45）。組み立てるのは `main.tsx` だけである。 */
  joinHousehold: JoinHousehold;
  /** 持ち越し中の招待のトークンの継ぎ目（B-77 / ADR-087 決定4）。`new` するのは `main.tsx` だけである。 */
  pendingHouseholdInvitation: PendingHouseholdInvitation;
};

/** 開いている献立と、その出どころのタブ（B-54b 設計 規則9。門の内部の形で export しない）。 */
type OpenMeal = { readonly mealId: string; readonly from: 'meals' | 'history' };

export function App({
  session,
  listStockItems,
  registerStockItem,
  deleteStockItem,
  updateStockItem,
  showLatestSuggestion,
  listIngredientNames,
  requestNewMeals,
  showMeal,
  addCookingRecord,
  listMeals,
  deleteHouseholdData,
  connectivity,
  showHouseholdMemberCount,
  createHouseholdInvitation,
  leaveHousehold,
  clipboard,
  webOrigin,
  joinHousehold,
  pendingHouseholdInvitation,
}: AppProps) {
  // 購読を始めた時点の状態は subscribe が1度目に渡す（`Session.ts` 規則5）ので、
  // ここで先に決めない。最初の描画は購読が始まるまでの一瞬だけ 'unknown' でよい。
  const [state, setState] = useState<SessionState>('unknown');

  // 在庫は取りに行くまで「読み込み中」である。**0件を初期値にしない**（B-22 設計 7章）—
  // 在庫があるのに無いように見せてしまう。
  const [stockItems, setStockItems] = useState<PantryListState>({ outcome: 'loading' });

  // 一覧を取り直した回数。登録が通るたび（B-24）と、消えたと読めるたび（B-23）に1つ増やし、
  // 下の効果をもう1度走らせる。
  const [reloadCount, setReloadCount] = useState(0);

  // 提案も取りに行くまでは「読み込み中」である（在庫と同じ構え。B-22 設計 7章）。
  const [suggestion, setSuggestion] = useState<MealsTabState>({ outcome: 'loading' });

  // 食材名も取りに行くまでは「読み込み中」である。**0件を初期値にしない** — 補完が出ない
  // ことは同じでも、取れていないのに「取れて0件」と名乗る状態を作らない。
  const [ingredientNames, setIngredientNames] = useState<IngredientNamesState>({
    outcome: 'loading',
  });

  // **いま選んでいるタブ**（ADR-066 決定2 / B-49c 規則10）。器は自分では持たず、
  // props で受け取るだけである（同 決定1）— そうでないと、画面の側からタブを移す手段が
  // 1つも無い（`docs/screen-design.md` D-7）。**開くのは既定の献立タブ**（ADR-064）。
  //
  // **URL にも `localStorage` にも書かない**（同 結果1）ので、再読み込みは既定に戻る。
  const [selectedTab, setSelectedTab] = useState<TabId>(DEFAULT_TAB);

  /**
   * **開いている献立と、それをどのタブから開いたか**（B-53 設計 規則17 / B-54b 設計 規則9）。
   * `null` なら詳細を出していない。
   *
   * **器でもタブでもなく門が持つ** — 取りに行く効果の置き場が門であり（B-22 設計 規則10）、
   * 献立タブと履歴タブが同じ状態から詳細を開く。ADR-066 が選んでいるタブを門へ移したのと
   * 同じ理由である。**開いている献立は1つだけ**で、詳細は出どころ（`from`）のタブにだけ描く —
   * 閉じれば出どころのタブの一覧に戻る（画面設計 2.3「戻り先だけが違う」）。別のタブから
   * 開き直すと、出どころごと置き換わる（B-54b 規則10）。
   */
  const [openMeal, setOpenMeal] = useState<OpenMeal | null>(null);

  /**
   * **設定を開いているか**（B-56c 設計 規則1 / `docs/screen-design.md` 2.1・8章）。
   *
   * **門が持つ** — 開いている献立（`openMeal`）と同じ置き方であり、理由も ADR-066 と同じである。
   * **設定はタブの外の4つ目の行き先であり**（B-60 設計 6章 規則7）、器（`TabbedScreen`）が
   * 選んでいたタブの中身の代わりに描く。**開く入口は、SP では3つのタブの見出しの歯車、PC では
   * サイドナビの下端の「設定」である**（B-60 規則4・12）。閉じるのは設定画面の「閉じる」、**タブを押した回**
   * （B-60 規則8。B-56c 規則9「タブを移っても閉じない」はここで置き換わった）、サインイン済みで
   * なくなった回（B-56c 規則10）である。開閉で `selectedTab` も `openMeal` も変えない
   * （B-60 規則9）。開いた回に取りに行くのは世帯の人数だけである（B-76 規則12）。
   */
  const [settingsOpen, setSettingsOpen] = useState(false);

  /**
   * 世帯のデータの削除を送っている間か（B-60b 規則1・4・8）。**帯を止めるために門も持つ** —
   * 設定画面の「送っている間はどの操作も効かない」（B-56f 規則6）は設定画面の中にしか及ばず、
   * 帯のタブを押すと設定が閉じて（B-60 規則8）、失敗の案内を見ないまま残る。設定画面の
   * `deleting` とは別に持つ（二重に持つ。設定画面の口と状態は変えない）。
   */
  const [deletingHouseholdData, setDeletingHouseholdData] = useState(false);

  // 世帯の人数（B-76 / FR-47）。設定を開くまでは取りに行かないので「読み込み中」のままである。
  const [memberCount, setMemberCount] = useState<HouseholdMemberCountState>({ outcome: 'loading' });

  // 人数を取り直した回数。抜けるの要求が終わるたびに1つ増やす（B-76 規則13）。
  const [memberCountReloadCount, setMemberCountReloadCount] = useState(0);

  /**
   * **参加の確認に出している招待のトークン**（B-77 規則6・9 / FR-45）。`null` なら確認を出さない。
   *
   * 読み込んだ時点で持ち越していたトークンから始める。継ぎ目（端末に残る写し）とは別に持つ —
   * 断られた回は継ぎ目をその時点で消すが、確認は `閉じる` まで残すため。サインインしていない間は
   * 確認を出さず、トークンは持ち越したままにする。
   */
  const [invitationToken, setInvitationToken] = useState<string | null>(() =>
    pendingHouseholdInvitation.read(),
  );

  // 開いた献立の取得の結末。**開くまでは「読み込み中」ですらない**（詳細を出していない）。
  const [mealDetail, setMealDetail] = useState<MealDetailState>({ outcome: 'loading' });

  // 調理記録を送っている間か。
  const [recordingCooking, setRecordingCooking] = useState(false);
  // 直前の記録の読み（`null` なら断りの案内を出さない）。
  const [recordFailureNotice, setRecordFailureNotice] = useState<CookingRecordFailureNotice | null>(
    null,
  );
  // 直前の記録が通ったか（規則11・12。**開き直したら消える**）。
  const [cookingRecorded, setCookingRecorded] = useState(false);

  // 献立の履歴も取りに行くまでは「読み込み中」である（在庫と同じ構え。B-54b 設計 5章）。
  const [mealList, setMealList] = useState<HistoryTabState>({ outcome: 'loading' });

  // 履歴を取り直した回数。**在庫の `reloadCount` とは別に数える**（B-54b 規則12）— 献立が
  // 増えたり列を移ったりするのは、調理記録が通った回と新しい献立が届いた回だけであり、
  // 在庫の登録・更新・削除では履歴は変わらない。
  const [mealListReloadCount, setMealListReloadCount] = useState(0);

  // 「新しい献立を求める」（B-49b / FR-36）を求めた時刻（ミリ秒）。`null` なら送っていない（S-5）。
  // **送信中かどうかはこの値だけで決まる**（B-62 設計 10章 前提1。真偽と時刻の2つを持たない）。
  // 門が持つのは、器が選んでいないタブを木から外すためである — 献立タブを離れて戻っても
  // 生成中のまま見える（B-62 規則12 / D-6 / NFR-04）。時刻は送信中かどうかの判定にだけ使う。
  const [newMealsRequestedAt, setNewMealsRequestedAt] = useState<number | null>(null);
  // 直前の要求が失敗したか（S-6）。押し直した時点で消す（規則: 同時に出さない）。
  const [newMealsFailed, setNewMealsFailed] = useState(false);

  // 購読は1本。`session` が同じなら張り替えず、外れるとき戻り値で解除する（規則2）。
  useEffect(() => session.subscribe(setState), [session]);

  // 接続状態も門が持つ（B-70 設計 規則3 / ADR-066）。購読は1本で、`connectivity` が同じなら
  // 張り替えない。**購読が渡すまでの初期値は `online`** — 一瞬の描画で操作を止めない。
  // セッションとは別に持つので、サインアウトしても捨てない。
  const [connectivityState, setConnectivityState] = useState<ConnectivityState>('online');
  useEffect(() => connectivity.subscribe(setConnectivityState), [connectivity]);
  const offline = connectivityState === 'offline';

  // 取りに行くのは**サインイン済みのときだけ1度**（B-22 設計 規則10）。サインアウトしている間は
  // 叩いても 401 が返るだけで、往復を1つ無駄にする。
  //
  // **効果が解除されたら結果を捨てる**（同 規則10）。StrictMode の二重呼び出しと、
  // サインアウトが割り込んだ場合に、古い結果を画面に置かないため。
  //
  // **自動で取りに行き直さない。** 継ぎ目は例外を投げず結末で返す（同 規則9）ので、
  // ここに `catch` は要らない。
  useEffect(() => {
    if (state !== 'signedIn') return;

    let active = true;
    setStockItems({ outcome: 'loading' });

    void listStockItems().then((outcome) => {
      if (active) setStockItems(outcome);
    });

    return () => {
      active = false;
    };
  }, [state, listStockItems, reloadCount]);

  /**
   * サインイン済みになったら保存済みの提案を**1度だけ**取りに行く（FR-16 / FR-21 / B-49a）。
   *
   * **在庫の一覧と同じ構えである。** 献立タブが開かれるのを待たない — 取りに行く先は
   * 生成を一度も呼ばない読み取り専用の経路であり（ADR-065 決定1・決定2）、費用も
   * 1日10回の枠（NFR-C2）も使わない。生成は「新しい献立を求める」（FR-36 / B-49b）だけで
   * 起こる。**起動時に開くタブが献立になった**（ADR-064）いま、開かれるのを待つ形は
   * 「起動＝開かれた」と同じであり、待つ意味がそもそも無い。
   *
   * **自動で取り直さない**（在庫と同じ。B-22 設計 規則11）。
   *
   * **効果が解除されたら結果を捨てる**（在庫と同じ。B-22 設計 規則10）。StrictMode の
   * 二重呼び出しと、サインアウトが割り込んだ場合に、古い結果を画面に置かないため。
   *
   * **`catch` は要らない。** 継ぎ目は例外を投げず結末で返す（`SuggestionRequests.ts`）。
   */
  useEffect(() => {
    if (state !== 'signedIn') return;

    let active = true;
    setSuggestion({ outcome: 'loading' });

    void showLatestSuggestion().then((outcome) => {
      if (active) setSuggestion(outcome);
    });

    return () => {
      active = false;
    };
    // `reloadCount` を依存に足す: 在庫の登録・削除が通った回に、保存済みの提案も取り直す
    // （B-49b 規則10）。在庫の一覧を取り直す効果と同じ回数を読んで揃える。
  }, [state, showLatestSuggestion, reloadCount]);

  /**
   * 補完の元になる食材名を取りに行く（FR-02 / B-50c 設計 規則6）。
   *
   * **在庫の一覧と同じ構えである** — サインイン済みのときだけ取りに行き、`reloadCount` が
   * 増えた回（登録が通った回と、消えたと読めた回）に取り直す。登録が通れば名称の列も
   * 変わっており、**「保存してもう1件」で打つ次の1件に効く。** 読み取りだけの `GET` なので、
   * 取り直しても費用も 1日10回の枠（NFR-C2）も使わない。
   *
   * **取れなくても何も出さない**（設計 規則4 / FR-02 / FR-03）。補完が出ないだけで、登録は
   * 止まらない — 断りの案内もここには無い。
   *
   * **効果が解除されたら結果を捨てる**（在庫と同じ。B-22 設計 規則10）。
   */
  useEffect(() => {
    if (state !== 'signedIn') return;

    let active = true;

    void listIngredientNames().then((outcome) => {
      if (active) setIngredientNames(outcome);
    });

    return () => {
      active = false;
    };
  }, [state, listIngredientNames, reloadCount]);

  /**
   * **開いている献立を取りに行く**（FR-30 / FR-32 / B-53 設計 規則1・19）。
   *
   * **開かれた回に1度だけ**取りに行き、`reloadCount` が増えた回（在庫の登録・削除が通った回）に
   * 取り直す — 充足は現在の在庫で都度算出されるものであり（ADR-009）、在庫が動けば印が変わる。
   * 読み取りだけの `GET` なので、取り直しても費用も 1日10回の枠（NFR-C2）も使わない。
   *
   * **効果が解除されたら結果を捨てる**（在庫と同じ。B-22 設計 規則10）。StrictMode の
   * 二重呼び出しと、閉じられた・サインアウトが割り込んだ場合に、古い結果を画面に置かないため。
   */
  useEffect(() => {
    if (state !== 'signedIn' || openMeal === null) return;

    let active = true;
    setMealDetail({ outcome: 'loading' });

    void showMeal(openMeal.mealId).then((outcome) => {
      if (active) setMealDetail(outcome);
    });

    return () => {
      active = false;
    };
    // `openMeal` は開いた回ごとに作り直すので、同じ献立を別のタブから開き直しても取りに行く
    // （B-54b 規則11 — 充足は開いた時点の在庫で算出されたものでなければならない）。
  }, [state, showMeal, openMeal, reloadCount]);

  /**
   * サインイン済みになったら献立の履歴を**1度だけ**取りに行く（FR-28 / FR-29 / B-54b 規則12）。
   *
   * **提案と同じ構えである** — 履歴タブが開かれるのを待たない。読み取りだけの `GET` であり、
   * 費用も 1日10回の枠（NFR-C2）も使わない。取り直すのは `mealListReloadCount` が増えた回
   * （調理記録が通った回と、新しい献立が届いた回）だけで、タブの移動・詳細の開閉・在庫の
   * 登録・更新・削除では取り直さない。
   *
   * **効果の頭で「読み込み中」にし、解除されたら結果を捨てる**（B-54b 規則14 / 先行 B-22
   * 設計 規則10）。取り直している間に前の列を出さず、遅れて届いた古い取得で上書きしない。
   *
   * **`catch` は要らない。** 継ぎ目は例外を投げず結末で返す（`MealRequests.ts`）。
   */
  useEffect(() => {
    if (state !== 'signedIn') return;

    let active = true;
    setMealList({ outcome: 'loading' });

    void listMeals().then((outcome) => {
      if (active) setMealList(outcome);
    });

    return () => {
      active = false;
    };
  }, [state, listMeals, mealListReloadCount]);

  /**
   * **設定を開くたびに世帯の人数を1回取りに行く**（B-76 規則12 / FR-47）。
   *
   * 在庫の一覧と同じ構えである — サインイン済みで設定を開いているときだけ取りに行き、効果の
   * 頭で「読み込み中」に戻して前の人数を出さない。**閉じる前に届かなかった結末は捨てる**
   * （先行 B-22 設計 規則10 の `active`）。抜けるの要求が終わった回にも取り直す（規則13）。
   */
  useEffect(() => {
    if (state !== 'signedIn' || !settingsOpen) return;

    let active = true;
    setMemberCount({ outcome: 'loading' });

    void showHouseholdMemberCount().then((outcome) => {
      if (active) setMemberCount(outcome);
    });

    return () => {
      active = false;
    };
  }, [state, settingsOpen, showHouseholdMemberCount, memberCountReloadCount]);

  /**
   * **サインイン済みでなくなったら、開いている詳細も閉じる**（NFR-09）。
   *
   * 閉じないと**前の世帯の献立が残る** — 別の世帯で入り直したとき、識別子は前の世帯のもので
   * あり、取り直しは 404 になる（そして画面には前の献立が出たままになる）。
   */
  useEffect(() => {
    if (state === 'signedIn') return;

    setOpenMeal(null);
  }, [state]);

  /**
   * **サインイン済みでなくなったら、設定も閉じる**（B-56c 規則10 / ADR-066 結果1 / NFR-09）。
   *
   * 門は signedOut の間も生き続けるので、mount には頼れない。閉じないと、入り直した回に
   * タブの中身ではなく設定のまま出る。
   */
  useEffect(() => {
    if (state === 'signedIn') return;

    setSettingsOpen(false);
  }, [state]);

  /**
   * **サインイン済みでなくなったら、履歴も初期に戻す**（B-54b 規則15 / NFR-09）。
   *
   * 戻さないと**前の世帯の献立がサインアウトの間も残り**、入り直したときも取り直しが届く
   * までの間に出る（先行 `setSuggestion` の効果）。
   */
  useEffect(() => {
    if (state === 'signedIn') return;

    setMealList({ outcome: 'loading' });
  }, [state]);

  /**
   * **サインイン済みでなくなったら、食材名も初期に戻す**（B-50c 設計 規則7）。
   *
   * 戻さないと**前の世帯の食材名が補完に残る**（NFR-09）— 別の世帯で入り直したとき、
   * 取り直しが届くまで前の世帯の名称が候補に出る。
   */
  useEffect(() => {
    if (state === 'signedIn') return;

    setIngredientNames({ outcome: 'loading' });
  }, [state]);

  /**
   * **サインイン済みでなくなったら、献立タブの状態を初期に戻す**（B-49a）。
   *
   * 戻さないと**前の世帯の提案が残る** — 別の世帯で入り直したとき、取り直しが届くまで
   * 前の献立が画面に出る（NFR-09）。上の効果は `signedIn` になった時点で「読み込み中」へ
   * 戻すが、**サインアウトしている間も出たままになる。**
   */
  useEffect(() => {
    if (state === 'signedIn') return;

    setSuggestion({ outcome: 'loading' });
  }, [state]);

  /**
   * **サインイン済みでなくなったら、開いているタブも既定に戻す**（ADR-066 結果1 /
   * B-38 設計 6章 規則9 / `docs/screen-design.md` 2.3 の `login --> meals`）。
   *
   * 状態が器の中にあったころは、門がサインイン済みの枝でだけ器を mount することで
   * 自然に戻っていた。**門へ持ち上げた以上、門は signedOut の間も生き続ける**ので、
   * ここで明示的に戻さないと**前に開いていたタブのまま入り直す**ことになる。
   */
  useEffect(() => {
    if (state === 'signedIn') return;

    setSelectedTab(DEFAULT_TAB);
  }, [state]);

  /**
   * **端末の戻るで、既定でないタブから献立タブへ戻す**（B-75 規則2・4 / ADR-064 / ADR-084）。
   *
   * 口の格は `'tab'` — 開いている画面（詳細・パネル・確認）の口がすべて無いときにだけ呼ばれる。
   * **設定を開いている間は外す**（規則5）— 設定はタブの中身の代わりに描かれ、戻るで閉じた先は
   * 開く前のタブである。献立タブで何も開いていなければ登録せず、戻るはアプリを離れる（規則3）。
   */
  useBackHandler(
    state === 'signedIn' && selectedTab !== DEFAULT_TAB && !settingsOpen,
    () => {
      setSelectedTab(DEFAULT_TAB);
    },
    'tab',
  );

  /**
   * 登録が通ったら一覧を取り直す（FR-01 / FR-04 / B-24）。
   *
   * **登録した在庫品を web で列に足さない。** 並び（期限の近い順）を決めるのはサーバであり
   * （B-22 設計 規則3）、足すと帯の中の位置を web が決めることになる。継ぎ目が成功に
   * 在庫品を載せていないのもこのためである。
   *
   * 結末はそのまま画面へ返す — 断りの文言を選ぶのは `StockItemForm` の側である（ADR-032 決定3）。
   */
  const registerAndReload: RegisterStockItem = async (input) => {
    const outcome = await registerStockItem(input);
    if (outcome.outcome === 'registered') setReloadCount((count) => count + 1);

    return outcome;
  };

  /**
   * **消えたと読めたら一覧を取り直す**（FR-06 / B-23 / ADR-050）。
   *
   * 読みは `deleteFailureNoticeOf` の1つだけを使う — 案内を出すかどうかを決めるのと
   * **同じ関数**であり（`DeleteFailureNotice.ts`）、2か所に判断を置くと「案内は出さないのに
   * 一覧は古いまま」のような食い違いが生まれる。`null` は「思ったとおりになった」を表す。
   *
   * **web で列から行を抜かない。** 登録と同じ理由で、並び（期限の近い順）を決めるのは
   * サーバである（B-22 設計 規則3 / B-24）。**取り直しは読みの検めでもある** — 404 を
   * 「すでに消えている」と読んだ回も、消えていなければ行がそのまま戻ってくる。
   *
   * **消せなかった回は取り直さない。** 一覧は変わっておらず、往復を1つ無駄にするうえ、
   * その取得も失敗すれば断りが一覧全体の断りに置き換わってしまう（`PantryList`）。
   */
  const deleteAndReload: DeleteStockItem = async (id) => {
    const outcome = await deleteStockItem(id);
    if (deleteFailureNoticeOf(outcome) === null) setReloadCount((count) => count + 1);

    return outcome;
  };

  /**
   * アカウントとデータの削除の配線（FR-27 / B-56f 設計 規則7・8）。
   *
   * **消えた回はすぐにサインアウトしてから解決する**（ADR-071 結果2）— サーバではもう利用者が
   * 居ないので、手元のセッションを残しても使い道が無い。門の状態が signedOut に移れば、
   * 既存の効果が設定・開いた献立・履歴を閉じてログインの画面を出す。サインアウトのサーバ側の
   * 失敗は画面に届かない（`Session.ts` 規則8）。**失敗した回はサインアウトしない** —
   * データも利用者も残っており（ADR-073 結果3）、案内を出すのは設定画面である。
   */
  const deleteHouseholdDataAndSignOut: DeleteHouseholdData = async () => {
    // **結末がどちらでも・口が投げても帯を戻す**（B-60b 規則4）。戻し忘れると帯が効かないまま残る。
    setDeletingHouseholdData(true);
    try {
      const outcome = await deleteHouseholdData();
      if (outcome.outcome === 'deleted') await session.signOut();

      return outcome;
    } finally {
      setDeletingHouseholdData(false);
    }
  };

  /**
   * 献立詳細を開く（B-53 / 画面設計 2.3）。**どのタブから開いたかを添える**（B-54b 規則9）。
   * **前の記録の結末は持ち越さない**（B-53 規則12 / B-54b 規則10）— 持ち越すと、記録して
   * いない献立に記録の案内が出る。
   */
  const openMealFrom = (from: OpenMeal['from']) => (mealId: string) => {
    setRecordFailureNotice(null);
    setCookingRecorded(false);
    setOpenMeal({ mealId, from });
  };

  /** 献立詳細を閉じる（出どころのタブの一覧に戻る。B-54b 規則9）。 */
  const handleCloseMeal = () => {
    setRecordFailureNotice(null);
    setCookingRecorded(false);
    setOpenMeal(null);
  };

  /**
   * 世帯を抜ける配線（FR-46 / B-76 規則13・14）。
   *
   * **結末に関わらず人数を取り直す** — 断られた回（409 で1人と分かった回）も、取り直した人数で
   * 抜ける操作が消える（規則3）。**抜けた回は空の世帯から始まる**ので、開いている献立を閉じ、
   * 在庫・提案・食材名（`reloadCount`）と履歴（`mealListReloadCount`）を取り直す。設定は開いたまま
   * にする。結末はそのまま設定画面へ返し、案内を出すのは設定画面である。
   */
  const leaveHouseholdAndReload: LeaveHousehold = async () => {
    const outcome = await leaveHousehold();
    setMemberCountReloadCount((count) => count + 1);

    if (outcome.outcome === 'left') {
      handleCloseMeal();
      setReloadCount((count) => count + 1);
      setMealListReloadCount((count) => count + 1);
    }

    return outcome;
  };

  /**
   * 招待のトークンで参加する配線（FR-45 / B-77 規則9 / ADR-087 決定4・5）。
   *
   * 読みは `householdJoinNoticeOf` の1つだけを使う（先行 `deleteAndReload`）。**参加できた回**は
   * 継ぎ目を消して確認を閉じ、招待した人の冷蔵庫のものを取り直す — 在庫・提案・食材名
   * （`reloadCount`）と履歴（`mealListReloadCount`）。**使えない招待・すでに共有している断り**は
   * その時点で継ぎ目を消すが（再読み込みで確認が戻らない）、確認は `閉じる` まで残す。それ以外の
   * 失敗は継ぎ目を残し、確認に留まる。結末はそのまま画面へ返し、案内を出すのは画面である。
   */
  const joinWithInvitation = async (token: string): Promise<JoinHouseholdOutcome> => {
    const outcome = await joinHousehold(token);
    const notice = householdJoinNoticeOf(outcome);

    if (notice !== 'unavailable') pendingHouseholdInvitation.clear();
    if (notice === null) {
      setInvitationToken(null);
      setReloadCount((count) => count + 1);
      setMealListReloadCount((count) => count + 1);
    }

    return outcome;
  };

  /** 参加しない（B-77 規則9）。トークンを捨てて確認を閉じる。 */
  const declineInvitation = () => {
    pendingHouseholdInvitation.clear();
    setInvitationToken(null);
  };

  /**
   * 「これを作った」の配線（FR-22 / C-8 / B-51 の経路）。
   *
   * **送っている間は2度目を送らない** — 同じ記録が2件入る（先行 `handleRequestNewMeals`）。
   * **通っても献立を取り直さない**（規則11）— `MealOutput` は記録で変わらず、**在庫も
   * 減らない**（C-8。在庫の口を1つも呼ばないことで型から読める）。
   * **通った回は履歴だけを取り直す**（B-54b 規則12・13）— 記録で献立は「以前見た」から
   * 「作った」へ移る。在庫と提案は取り直さず、詳細も閉じない。
   * **断られても詳細を閉じない** — 案内を読む前に画面が変わる。
   */
  const handleAddCookingRecord = () => {
    // **接続が切れている間は何もしない**（B-70 規則8）— 見た目の `disabled` と門の二重である。
    if (openMeal === null || recordingCooking || offline) return;

    setRecordingCooking(true);
    setRecordFailureNotice(null);
    setCookingRecorded(false);

    void addCookingRecord(openMeal.mealId).then((outcome) => {
      setRecordingCooking(false);

      // 読みは `cookingRecordFailureNoticeOf` の1つだけを使う（先行 `deleteAndReload`）—
      // 判断を2か所に置くと、「案内は出さないのに記録できていない」食い違いが生まれる。
      const notice = cookingRecordFailureNoticeOf(outcome);
      setRecordFailureNotice(notice);
      setCookingRecorded(notice === null);
      if (notice === null) setMealListReloadCount((count) => count + 1);
    });
  };

  /**
   * **更新が通ったら一覧を取り直す**（FR-05 / B-55 設計 規則9 / B-22 設計 規則3）。
   *
   * **web で行を書き換えない。** 登録・削除と同じ理由で、並び（期限の近い順）を決めるのは
   * サーバであり、取り直した結果がそれである。継ぎ目が成功に在庫品を載せていないのも
   * このためである。
   *
   * **通らなかった回は取り直さない。** 断られた回（`update.notFound` を含む。ADR-050 結果5）も
   * 失敗した回も在庫は1件も変わっておらず、往復を1つ無駄にする。
   *
   * 数えは登録・削除と**同じ1つ**に載せる（`reloadCount`）ので、保存済みの提案と食材名も
   * 同時に取り直される — 在庫が変われば C-7 の一致が崩れ、`pantryChanged` の手がかりが
   * 古くなる（B-49b 規則10）。
   */
  const updateAndReload: UpdateStockItem = async (id, input) => {
    const outcome = await updateStockItem(id, input);
    if (outcome.outcome === 'updated') setReloadCount((count) => count + 1);

    return outcome;
  };

  /**
   * 「新しい献立を求める」操作の配線（B-49b / FR-36）。
   *
   * **押している間は2度目の要求を出さない** — `newMealsRequestedAt` が `null` でなければ何もしない。
   * 1度の求めで生成が2回走ると、**1日10回の枠（NFR-C2）が利用者の意図の倍で減る。**
   * **押した時点で前回の失敗の案内を消す**（役割の割り当て。送信中と失敗は同時に出ない）。
   *
   * **必ず生成を呼ぶ**（ADR-051）ので、届く結末は3つ（提案・在庫が足りない・上限に達した）に
   * 加えて継ぎ目の `failed` がある。**提案が届いた回だけ `suggestion` を差し替え、`pantryChanged`
   * を `false` に決め打つ**（規則: 生成直後は在庫と食い違いようがない）。在庫が足りない・上限に
   * 達した回も `suggestion` を置き換える（見せ方は B-49c）。失敗は `newMealsFailed` に載せるだけで、
   * **渡された提案のカードは消さない**（S-6 / D-6）。
   *
   * **提案が届いた回だけ履歴を取り直す**（B-54b 規則12）— 表示された献立は「以前見た献立」に
   * なる（FR-28）。在庫が足りない・上限に達した・失敗の回は生成が起きず、献立は増えない。
   */
  const handleRequestNewMeals = () => {
    // **接続が切れている間は何もしない**（B-70 規則7）— 見た目の `disabled` と門の二重である。
    if (newMealsRequestedAt !== null || offline) return;

    // 時計を読むのは門だけである（`docs/testing.md` 5章。先行 `todayOf(new Date())`）。
    setNewMealsRequestedAt(Date.now());
    setNewMealsFailed(false);

    void requestNewMeals().then((outcome) => {
      setNewMealsRequestedAt(null);

      if (outcome.outcome === 'suggested') {
        setSuggestion({
          outcome: 'suggested',
          suggestion: outcome.suggestion,
          pantryChanged: false,
        });
        setMealListReloadCount((count) => count + 1);
        return;
      }

      if (
        outcome.outcome === 'insufficientStockItems' ||
        outcome.outcome === 'generationLimitReached' ||
        outcome.outcome === 'noIngredientInPantry'
      ) {
        setSuggestion(outcome);
        return;
      }

      setNewMealsFailed(true);
    });
  };

  // **`'unknown'` をログイン画面に倒さない**（規則1 / `Session.ts` 規則6）。保存されたセッションの
  // 復元は非同期で、倒すとサインイン済みの利用者にログイン画面が一瞬見える。
  if (state === 'unknown') return null;

  if (state === 'signedOut') {
    return (
      <main>
        {/* 帯はログインの画面にも出す（B-70 規則5）。ログインの操作は止めない（設計 10章 前提2）。 */}
        {offline && <OfflineBanner />}
        {/* ログインとアカウント作成の出し分けは中の部品が持つ（B-73 設計 6章 規則14・18）。 */}
        <SignedOutScreen
          onSignIn={(email, password) => session.signIn(email, password)}
          onSignUp={(email, password) => session.signUp(email, password)}
        />
      </main>
    );
  }

  // **サインイン済みで招待のトークンを持ち越していれば、タブの器の代わりに参加の確認だけを出す**
  // （B-77 規則6 / FR-45）。帯は確認にも出す（B-70 規則5）。確認は「戻る」の口を登録しない
  // — 戻るはアプリを離れ、トークンは残るので開き直せば確認が出る（同 規則15）。
  if (invitationToken !== null) {
    return (
      <main>
        {offline && <OfflineBanner />}
        <HouseholdJoinScreen
          onJoin={() => joinWithInvitation(invitationToken)}
          onDecline={declineInvitation}
          onClose={() => setInvitationToken(null)}
          offline={offline}
        />
      </main>
    );
  }

  // **器を mount するのはこの枝だけである。** ただし**開くのが既定のタブに戻る根拠は
  // mount ではない**（ADR-066 結果1 で置き換わった。B-38 設計 6章 規則9）— 選んでいるタブは
  // 門が持つようになり、門はサインアウトの間も生き続けるので、**上の効果が明示的に
  // `DEFAULT_TAB` へ戻す**（2.3 の `login --> meals`）。
  //
  // **在庫を取りに行く効果は門に残したままである**（同 規則11 / B-22 設計 規則10）。タブを
  // 移っても上の効果は走り直さず、取れていた在庫も失敗の結末もそのまま保たれる —
  // 取り直すのは登録が通った回（B-24）と、消えたと読めた回（B-23）だけである。
  //
  // 在庫はサーバから取った結末をそのまま渡す（B-22）。並べ替えも帯分けも `PantryList` の側の
  // 純粋関数が行う。
  //
  // **一覧と登録の出し分けは `PantryTab` が持つ**（B-39 設計 規則1・4）。門は在庫タブの中身を
  // 1つ渡すだけで、いまどちらの画面が出ているかを知らない — 知ると、上の「在庫を取りに行く
  // 効果」と画面の遷移が同じ場所に混ざる。**取り直しても登録の画面は閉じない。**
  //
  // **在庫タブにログアウトを置かない**（B-56c 規則12）。ログアウトへの経路は設定画面の1つだけで
  // ある（`docs/screen-design.md` 2.1・8章）。
  //
  // **設定画面を組むのも門である**（B-56c 規則1）。組んだものは器（`TabbedScreen`）の `settings`
  // に渡し、器が選んでいたタブの中身の代わりに描く（B-60 規則7）。`features/` は
  // `features/identity/` を import しない。
  //
  // **開いている献立の詳細は1つだけ組み、出どころのタブにだけ渡す**（B-54b 規則9）。もう片方の
  // タブは一覧のままであり、履歴から開いた詳細が献立タブに漏れない（逆も同じ）。
  const openMealDetail =
    openMeal === null ? null : (
      <MealDetail
        meal={mealDetail}
        onClose={handleCloseMeal}
        onAddCookingRecord={handleAddCookingRecord}
        recording={recordingCooking}
        recordFailureNotice={recordFailureNotice}
        recorded={cookingRecorded}
        offline={offline}
      />
    );

  return (
    <main>
      {/* 帯は `<main>` の最初の子で、器より前に出す（B-70 規則4）。 */}
      {offline && <OfflineBanner />}
      <TabbedScreen
        // 選んでいるタブは門が持つ（ADR-066 決定2）。器へは値と、押されたことを受ける口を
        // 渡すだけで、**運ばれてくるのは `TabId` だけ**である（同 決定3）。
        selectedTab={selectedTab}
        // **設定を開いている間にタブを押すと、設定を閉じてそのタブを出す**（B-60 設計 6章
        // 規則8）。押したのが開く前に選んでいたタブでも同じである。
        onSelectTab={(tab) => {
          setSettingsOpen(false);
          setSelectedTab(tab);
        }}
        // **設定は4つ目の行き先である**（B-60 規則7）。組むのは門で、器はタブの中身の代わりに
        // 描くだけである。開閉で `selectedTab` も開いている献立も変えない（同 規則9）— 閉じれば
        // 開く前に選んでいたタブ（詳細を開いていれば詳細）に戻る。
        settings={
          settingsOpen ? (
            <SettingsScreen
              onSignOut={() => session.signOut()}
              onClose={() => setSettingsOpen(false)}
              onDeleteHouseholdData={deleteHouseholdDataAndSignOut}
              offline={offline}
              memberCount={memberCount}
              webOrigin={webOrigin}
              onCreateHouseholdInvitation={createHouseholdInvitation}
              onLeaveHousehold={leaveHouseholdAndReload}
              clipboard={clipboard}
            />
          ) : null
        }
        onOpenSettings={() => setSettingsOpen(true)}
        // **削除を送っている間は帯を止める**（B-60b 規則1）。確認を出しているだけの間・
        // オフラインの間は止めない（同 規則5）。
        disabled={deletingHouseholdData}
        meals={
          <MealsTab
            suggestion={suggestion}
            today={todayOf(new Date())}
            onRequestNewMeals={handleRequestNewMeals}
            newMealsRequestedAt={newMealsRequestedAt}
            newMealsFailed={newMealsFailed}
            // **在庫タブへ送る**（`docs/screen-design.md` D-7 / B-49c 規則9 / ADR-066 決定2）。
            // 門がするのは `'pantry'` にすることだけで、**「在庫が足りないから在庫タブへ」
            // という意味は `MealsTab` が持つ**（同 決定3）。
            //
            // **移しても何も取り直さない**（同 結果3 / D-8）— 提案も在庫一覧も食材名も
            // 触らない。取り直す経路は在庫の登録・削除が通った回に既にある。
            onGoToPantry={() => setSelectedTab('pantry')}
            onOpenMeal={openMealFrom('meals')}
            // **詳細を組むのは門である**（設計 規則17）。器は渡されたものを描くかどうかだけを
            // 決める（先行 `PantryTab` の一覧 ⇄ 登録）。
            mealDetail={openMeal?.from === 'meals' ? openMealDetail : null}
            offline={offline}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        }
        pantry={
          <PantryTab
            stockItems={stockItems}
            today={todayOf(new Date())}
            onDelete={deleteAndReload}
            onRegister={registerAndReload}
            onUpdate={updateAndReload}
            ingredientNames={ingredientNames}
            offline={offline}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        }
        history={
          // 履歴から開いた詳細も献立タブと同じ `MealDetail` を同じ口で出す（B-54b 規則11）。
          <HistoryTab
            meals={mealList}
            onOpenMeal={openMealFrom('history')}
            mealDetail={openMeal?.from === 'history' ? openMealDetail : null}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        }
      />
    </main>
  );
}
