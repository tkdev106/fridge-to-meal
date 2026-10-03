# 認証のメールのテンプレート

Supabase Auth が送るメールの件名と本文。**正はこのディレクトリ**で、本番へはダッシュボードに貼って反映する
（リポジトリから本番の設定へ流す仕組みは置いていない。下の「config.toml を置かない理由」）。

| メール | ダッシュボードの名前 | 本文 | 件名 |
| --- | --- | --- | --- |
| アカウント作成の確認 | Confirm signup | `confirmation.html` | `【fridge to meal】メールアドレスの確認` |

## 本文の作り

- 主要なメールクライアント（Gmail・Apple Mail・Outlook）で崩れないよう、**表組みとインラインの CSS だけ**で組む。
  `<style>` も外部の画像も書体も使わない（画像はブロックされることがあり、書体は読まれない）
- 幅は最大 560px で、狭い画面では画面の幅に合わせて縮む。色は `apps/web/src/global.css` のトークンの値を写す
- 中身の順は、サービス名 → 見出し → 何のメールか → 確認の操作（ボタン）→ ボタンが押せないときの URL →
  有効期限 → 宛先と、心当たりがない場合の扱い
- 使う変数は `{{ .ConfirmationURL }}`（確認のリンク）と `{{ .Email }}`（宛先）の2つ。確認のリンクを開くと
  Supabase が確かめたうえで Site URL（`https://fridge-to-meal.tkdev106.workers.dev`）へ戻し、web がそのまま
  サインインする（`signUp` は `emailRedirectTo` を渡していないので、戻り先は Site URL になる）
- 有効期限の長さは本文に書かない。長さはダッシュボードの設定（Email OTP Expiration）が決め、本文と食い違わせないため

## 本番へ反映する手順

1. Supabase のダッシュボードで本番のプロジェクトを開き、**Authentication → Emails → Templates → Confirm signup** を開く
2. **Subject** に上の表の件名を入れる
3. **Body**（Source）に `confirmation.html` の中身をすべて貼る
4. 保存し、プレビューで見た目を確かめる。アカウント作成の画面から自分宛てに1通送って、受信箱でも確かめる

テンプレートが編集できない（欄が押せない）ときは、下の「既定の送信の制約」に当たっている。

## ダッシュボードで変える項目

| 項目 | 場所 | 値 | 前提 |
| --- | --- | --- | --- |
| 件名 | Authentication → Emails → Templates → Confirm signup → Subject | `【fridge to meal】メールアドレスの確認` | テンプレートが編集できること |
| 本文 | 同じ画面の Body | `confirmation.html` | 同上 |
| 差出人の名前 | Authentication → Emails → SMTP Settings → Sender name | `fridge to meal` | **カスタム SMTP** |
| 差出人のアドレス | 同じ画面の Sender email | 送信に使うサービスで認証したアドレス | **カスタム SMTP** |
| 戻り先 | Authentication → URL Configuration → Site URL | `https://fridge-to-meal.tkdev106.workers.dev` | ADR-082 結果1 の手順で設定する（Redirect URLs も同じ） |

## 既定の送信の制約

カスタム SMTP を設定していない Supabase は、Supabase の共用の送信で送る。共用の送信には次の制約がある。

- **送れる宛先はプロジェクトの組織のメンバーだけ**。それ以外のアドレスでアカウントを作ると、確認のメールは送られない
- 送れる通数は少なく、Supabase の都合で変わる
- **差出人は Supabase のもの**で、名前もアドレスも変えられない
- **2026-06-03 以降に作った無料プランのプロジェクトは、テンプレートを編集できない**（既定の文面のまま送られる）。
  有料プラン、またはカスタム SMTP を設定したプロジェクトは編集できる
  （出典: https://supabase.com/changelog/46599-changes-to-email-template-customisation-on-free-tier 、
  https://supabase.com/docs/guides/auth/auth-smtp ）

差出人を `fridge to meal` にすること、組織の外の人が登録できることは、カスタム SMTP を設定して初めてできる。

## config.toml を置かない理由

Supabase の CLI は `supabase/config.toml` の `[auth.email.template.confirmation]` でテンプレートを持てるが、
次の理由で置いていない。

- `config.toml` のテンプレートが効くのは CLI が立てるローカルの Supabase だけで、本番のダッシュボードの
  テンプレートは変わらない。このリポジトリのローカル環境は Postgres だけで、Auth を立てていない（ADR-029 決定4 / ADR-030）
- 本番へ流すには `supabase config push` が要るが、これはファイルにある認証の設定で本番を上書きするため、ダッシュボードで
  決めた値（パスワードの最小文字数・Site URL など）をファイルに写し損ねると本番の値が戻る
