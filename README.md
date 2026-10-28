# Facette

顔写真で社員を一覧し、人材情報・評価・配置をまとめて扱うタレントマネジメントの Web アプリです。Cloudflare Workers（静的アセット＋API）と D1 の上で動きます。

## できること

| 領域                 | 機能                                                                                                                                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 人材データベース     | 顔一覧／リスト表示、氏名・かな・社員番号の検索、部署・役職・等級・雇用形態・性別・入社日・スキル・社員リスト・シート項目での絞り込み、表示列の追加、CSV 出力・取り込み（検証付き）、顔写真の一括登録                |
| メンバー比較         | 最大5名の基本情報・評価結果・スキル・シートの内容を横に並べて比較、値が異なる項目だけの表示                                                                                                                         |
| プロフィールブック   | 名札（顔写真・所属・連絡先）、カスタムシートのタブ（単一／複数レコード）、スキル、評価履歴、1on1、異動履歴、同じ部署のメンバー、顔写真のアップロード                                                                |
| シート設計           | 項目（テキスト・数値・日付・選択・複数選択・チェック・URL）の追加・並べ替え、ロール別（人事／マネージャー／一般社員／本人）の閲覧・編集権限                                                                         |
| 組織ツリー           | 本部ごとの列で部署と顔を表示、部署の長を名前付きで表示、社員の検索・ハイライト                                                                                                                                      |
| 配置シミュレーション | 組織図上の顔をドラッグして異動案を作成（自動保存）、部署ごとの増減、役職の変更、本番への反映（異動履歴を記録）、複製                                                                                                |
| 配置バランス図       | 任意の2軸（タレント評価・評価ランク・等級・年齢など）に顔を配置。シートの項目軸はドラッグで値を更新                                                                                                                 |
| 評価ワークフロー     | テンプレート（目標＋行動評価、配分、ランク基準）、評価期間、目標設定→自己評価→一次→二次→最終確定、差し戻し、進捗管理、CSV 出力                                                                                      |
| アンケート           | 単一／複数選択・5段階・推奨度（NPS）・自由記述、回答画面のプレビュー、部署指定の配信、締切日での自動締切と再開、匿名集計（回答3件未満は結果を非表示、少人数の部署の内訳も非表示）、パルスサーベイのひな形、CSV 出力 |
| 1on1・面談記録       | 上長による記録、本人への共有、コンディション（本人には非表示）                                                                                                                                                      |
| スキル・ポジション   | スキルマップ、ポジションの要件と候補者のマッチ度                                                                                                                                                                    |
| 社員リスト           | 任意のメンバーのまとまりを作成・共有                                                                                                                                                                                |
| 分析・ダッシュボード | 社員データグラフ（任意の軸×内訳のクロス集計）、指標（従業員数・平均年齢・女性管理職比率・離職率など）のパネル                                                                                                       |
| 申請                 | 本人が閲覧のみのシートの変更を申請し、人事が承認すると反映                                                                                                                                                          |
| チームキャンバス     | メンバーの顔を自由に並べてグループ分けするボード                                                                                                                                                                    |
| 管理                 | ユーザーとロール、シート設計、マスタ（部署・役職・等級・雇用形態）、スキル、お知らせ（上部固定は3件まで）、操作ログ、会社名                                                                                         |

ロールは「システム管理者」「人事担当」「マネージャー（自部署配下が管轄）」「一般社員」の4つです。権限の判定は `src/shared/permissions.ts` にまとめ、API 側で必ず検査します。

## 構成

```
src/
  worker/      Hono による API（/api/*）。routes/ に機能ごとのルート、lib/ に認証・権限・DB の共通処理
  client/      React（Vite）の画面。components/ に共通部品、pages/ に画面
  shared/      API と画面で共有する型・定数・計算（評価点、CSV、日付、権限）
migrations/    D1 のスキーマ
scripts/       デモデータ生成（generate-seed.ts）、画面確認用スクリーンショット
tests/worker/  Workers ランタイム上で動く API の結合テスト（Vitest）
e2e/           Playwright による画面の E2E テスト
```

- 認証は [Better Auth](https://www.better-auth.com/) による Google ログインのみです（パスワードは扱いません）。システム管理者が「管理設定 > ユーザー」に登録したメールアドレスと一致する Google アカウントだけがログインでき、初回ログイン時にユーザーへひもづきます。未登録のアカウントでの新規登録はできません。設定は `src/worker/lib/auth.ts` にあります。
- セッションは署名付きの HttpOnly / SameSite=Lax の Cookie で、有効期限は14日（使っている間は延長）です。ユーザーを無効にしたり、メールアドレスを変更したりすると、その人のセッションは無効になります（メールアドレスを変えた場合は Google アカウントのひもづけも外れ、新しいアドレスでログインし直します）。
- 状態を変える API は同一オリジン以外とフォーム形式のリクエストを拒否します（CSRF 対策）。
- 本人に非公開のシート（タレント評価など）や、自分の評価シート・面談記録のコンディションは、人事担当やマネージャーであっても自分の分は見られません（検索・CSV・変更申請の審査も同じ）。
- 匿名アンケートは回答者を保存せず、回答日時も日付単位で記録します。回答が3件そろうまで集計結果を出しません。
- 複数の行を書き換える処理は D1 の batch（トランザクション）でまとめて実行し、途中で失敗しても中途半端な状態を残しません。

## 開発

Node.js 22.22 以上と pnpm を使います。

```sh
pnpm install
cp .dev.vars.example .dev.vars   # 秘密鍵と Google の OAuth クライアントを設定する
pnpm db:reset:local    # ローカル D1 にスキーマとデモデータを投入
pnpm dev               # http://localhost:5173
```

`.dev.vars` の `BETTER_AUTH_SECRET` は必須です（`openssl rand -base64 32` などで生成）。Google でログインするには、[Google Cloud Console](https://console.cloud.google.com/apis/credentials) で OAuth クライアント（ウェブアプリケーション）を作り、承認済みのリダイレクト URI に `http://localhost:5173/api/auth/callback/google` を追加して、クライアント ID とシークレットを `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` に設定してください。デモモードの間は、Google の設定がなくてもデモアカウントで操作できます。

デモアカウント（デモモードの間、ログイン画面からワンクリックで入れます）

| ロール         | メール              |
| -------------- | ------------------- |
| システム管理者 | admin@example.com   |
| 人事担当       | hr@example.com      |
| マネージャー   | manager@example.com |
| 一般社員       | member@example.com  |

### 品質チェック

```sh
pnpm lint        # Biome（整形・Lint）
pnpm typecheck   # TypeScript
pnpm test        # Vitest（Workers ランタイム上の API テスト＋共通ロジック）
pnpm build       # 本番ビルド
pnpm e2e         # Playwright（ローカル D1 を初期化してビルド・起動し、画面を操作。.dev.vars の GOOGLE_* に何か値が必要）
pnpm verify      # 上記すべて
```

コミット時には `.githooks/pre-commit` で Lint と型チェックが走ります（`pnpm install` 時に自動で有効化）。

## CI/CD（GitHub Actions）

`.github/workflows/ci.yml`

1. **quality**: Lint → 型チェック → ユニット／API テスト → ビルド
2. **e2e**: Playwright（失敗時はレポートとトレースを保存）
3. **deploy**（main への push・手動実行）: D1 マイグレーション適用 → `wrangler deploy`。本番 D1 にユーザーが1人もいない初回は、デモデータを自動で投入します。手動実行で `seed` を有効にすると、いつでもデモデータを入れ直せます（既存データは消えます）
4. **preview**（プルリクエスト）: プレビュー用のバージョンをアップロード

リポジトリの Secrets に `CLOUDFLARE_API_TOKEN`（Workers と D1 の編集権限）と `CLOUDFLARE_ACCOUNT_ID` を登録してください。あわせて `BETTER_AUTH_SECRET`・`GOOGLE_CLIENT_ID`・`GOOGLE_CLIENT_SECRET` を登録すると、デプロイ時に Worker のシークレットとして設定されます（登録しない場合は、下の `wrangler secret put` で Worker に直接設定してください）。デモモードを切るときは、リポジトリの Variables に `DEMO_MODE` = `false` を登録します（未登録なら `true`）。

## デプロイ（手元から）

Google Cloud Console の OAuth クライアントに、本番の承認済みのリダイレクト URI（`https://<公開しているドメイン>/api/auth/callback/google`）を追加しておきます。

```sh
pnpm wrangler login
pnpm wrangler secret put BETTER_AUTH_SECRET     # 初回のみ：秘密鍵（openssl rand -base64 32 などで生成）
pnpm wrangler secret put GOOGLE_CLIENT_ID       # 初回のみ：Google の OAuth クライアント
pnpm wrangler secret put GOOGLE_CLIENT_SECRET
pnpm run deploy                 # ビルド → 本番 D1 にマイグレーション → Worker をデプロイ
pnpm db:seed:file && pnpm wrangler d1 execute DB --remote --file=seed/seed.sql   # 初回のみ：デモデータ
```

### デモモードと本番運用

`DEMO_MODE` が `"true"` のあいだは、ログイン画面にデモアカウントが表示され、誰でもワンクリックで入れます（デモアカウントの変更・無効化・削除はできません）。実データで運用するときは次の手順でデモモードを切ってください。

1. 自分用の管理者を作る（デモデータを入れていない場合もこれで最初の管理者を作れます）。指定したメールアドレスの Google アカウントでログインします

   ```sh
   node scripts/create-admin.ts --email you@example.com --name "山田 太郎" > admin.sql
   pnpm wrangler d1 execute DB --remote --file=admin.sql && rm admin.sql
   ```

2. `DEMO_MODE` を `"false"` にしてデプロイする（`wrangler.jsonc` を書き換えるか、GitHub の Variables に `DEMO_MODE=false`）。デモアカウントではログインできなくなり、すでにログイン中のデモアカウントのセッションも使えなくなります。
3. デモデータを消して実データを入れる場合は、管理設定と CSV 取り込みを使います。ほかのメンバーも「管理設定 > ユーザー」に Google アカウントのメールアドレスで登録すると、ログインできるようになります。
