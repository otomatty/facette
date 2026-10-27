# フロントエンド実装ガイド

Facette の画面を追加・変更するときの約束ごと。既存の画面（`src/client/pages/HomePage.tsx`、`members/MembersPage.tsx`、`members/MemberProfilePage.tsx`）が手本。

## 構成

- `src/client/router.tsx` — ルーティング。各ページは `export default function ...` のコンポーネント。
- `src/client/components/ui.tsx` — 基本部品（`Button` `IconButton` `Input` `Textarea` `Select` `Checkbox` `Field` `Badge` `Panel` `PageHeader` `Tabs` `Segmented` `Modal` `useConfirm` `useToast` `Loading` `ErrorBox` `EmptyState` `Pagination` `KeyValue` `cx`）。
- `src/client/components/Face.tsx` — 顔写真まわり（`Face` `FaceTile` `MemberChip` `FaceStack` `StatusBadge` `faceSrc`）。**社員を表示するときは必ず顔を添える。**
- `src/client/components/pickers.tsx` — `DepartmentSelect` `DepartmentOptions` `MemberPicker` `FieldInput` `FieldValueView`。
- `src/client/components/charts.tsx` — `BarChart` `ColumnChart` `DonutChart` `AutoChart` `ChartTable` `Legend` `Meter` `SERIES_COLORS`。グラフは必ずこれを使う（色は固定順、表で見る切り替え付き）。
- `src/client/lib/api.ts` — `get` `post` `put` `patch` `del` `qs` `errorMessage` `downloadText` `ApiError`。
- `src/client/lib/queries.ts` — `queryClient` `useAuth()`（ログイン中ユーザー・`capabilities`）`useMasters` `useSheets` `useSkills` `useAllMembers` `buildDeptTree` `flattenDeptTree`。
- 型は `src/shared/types.ts`、定数・ラベルは `src/shared/constants.ts`、日付は `src/shared/dates.ts`（`formatDateJa` `formatDateTimeJa` `todayJst`）。
- API の仕様は `src/worker/routes/*.ts` を読む（リクエストの zod スキーマ・レスポンス型・権限チェックがそこにある）。

## データ取得

- 取得は TanStack Query の `useQuery`。キーは `["リソース名", ...]`（例 `["surveys"]`, `["survey", id]`）。
- 更新は `useMutation`。成功時に関連キーを `queryClient.invalidateQueries` し、`useToast()` で結果を伝える（例「保存しました」）。失敗時は `toast(errorMessage(e), "error")`。
- 読み込み中は `<Loading />`、エラーは `<ErrorBox error={...} onRetry={...} />`、空は `<EmptyState title="..." />`。
- 権限で出し分ける UI は `useAuth().capabilities` を見る。API 側でも必ず拒否されるので、UI はボタンを隠すだけでよい。

## デザインの約束

- 配色はテーマのトークンのみ（`ai-*` 藍、`ink` `ink-2` `ink-3` 文字、`line` `line-2` 罫線、`canvas` 背景、`yamabuki` 強調・変更点、`wakaba` 成功、`beni` 危険、`fuji` 補助）。生の16進カラーは使わない（グラフは charts.tsx に任せる）。
- 角丸は小さく（`rounded-md` / パネル `rounded-lg`）。影はダイアログやドロップダウンだけ。カードを並べてグラデーションで飾らない。
- 見出しの上に英大文字のラベルを置かない。「A・B・C」のような中黒つなぎのメタ情報、矢印付きのボタン文言、等幅フォントのラベルは使わない。
- 数字は `tabular` クラス（等幅数字）。
- ページは `<PageHeader title description actions />` から始める。一覧は `Panel` か `rounded-lg border border-line bg-white` の箱に入れる。
- 幅 1440px と 390px（スマホ）の両方で崩れないこと。表は `overflow-x-auto` で包む。

## 文言

- 利用者の言葉で、短く、能動態で。ボタンは「保存」「配信する」「提出する」など結果が分かる動詞。完了トーストも同じ動詞（「配信しました」）。
- エラーは何が起きたか・どうすればよいかを書く。謝らない。
- 空の状態は次にできることを示す（「アンケートを作成すると、ここに表示されます」など）。

## 確認方法

```sh
pnpm typecheck      # 型チェック
pnpm lint           # Biome（pnpm lint:fix で自動修正）
pnpm test           # API・共通ロジックのテスト
```

画面の確認は、自分専用のローカル状態で開発サーバーを起動して行う（他の作業と DB を共有しないため）。

```sh
cp -r .wrangler/state /tmp/facette-state-<名前>
FACETTE_STATE_DIR=/tmp/facette-state-<名前> pnpm dev --port <ポート> --strictPort
```

デモログイン: `POST /api/auth/demo-login {"userId": 1|2|3|4}`（1=システム管理者, 2=人事担当, 3=マネージャー, 4=一般社員）。
