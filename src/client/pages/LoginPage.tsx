import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { useMemo } from "react";
import { Navigate, useSearchParams } from "react-router";
import { ROLE_LABELS } from "../../shared/constants";
import type { LoginOptions } from "../../shared/types";
import { BrandMark } from "../components/AppShell";
import { avatarDataUrl } from "../components/avatar";
import { Button, Spinner } from "../components/ui";
import { errorMessage, get, post } from "../lib/api";
import { queryClient, useMe } from "../lib/queries";

const ROLE_HINT: Record<string, string> = {
  admin: "シート設計・ユーザー管理まで全機能",
  hr: "人材データ・評価・アンケートの運用",
  manager: "自部署メンバーの評価・1on1・配置検討",
  member: "自分のプロフィール・自己評価・回答",
};

/** Google ログインから戻ってきたときのエラー（Better Auth のエラーコード） */
const LOGIN_ERRORS: Record<string, string> = {
  signup_disabled:
    "この Google アカウントのメールアドレスは登録されていません。システム管理者にユーザーの登録を依頼してください。",
  account_disabled: "このアカウントは無効になっています。システム管理者にお問い合わせください。",
  account_not_linked:
    "この Google アカウントのメールアドレスは Google で確認されていないため、ログインできません。",
  access_denied: "Google でのログインがキャンセルされました。",
};

function loginErrorMessage(code: string): string {
  return LOGIN_ERRORS[code] ?? "Google でログインできませんでした。もう一度お試しください。";
}

function GoogleLogo() {
  return (
    <svg viewBox="0 0 48 48" className="size-5" aria-hidden>
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

function FaceWall() {
  const seeds = useMemo(
    () => Array.from({ length: 72 }, (_, i) => 7919 * (i + 3) + (i % 3 === 0 ? 1 : 0)),
    [],
  );
  return (
    <div className="absolute inset-0 grid grid-cols-6 gap-2 p-2 opacity-90 xl:grid-cols-8" aria-hidden>
      {seeds.map((s) => (
        <img key={s} src={avatarDataUrl(s)} alt="" className="aspect-square w-full rounded-md" />
      ))}
    </div>
  );
}

export function LoginPage() {
  const me = useMe();
  const [params] = useSearchParams();
  const rawNext = params.get("next") || "/";
  // オープンリダイレクトを防ぐため、同一サイト内のパスのみ許可する
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";
  const callbackError = params.get("error");
  const options = useQuery({
    queryKey: ["login-options"],
    queryFn: () => get<LoginOptions>("/auth/login-options"),
  });

  const googleLogin = useMutation({
    mutationFn: () =>
      post<{ url: string }>("/auth/sign-in/social", {
        provider: "google",
        callbackURL: next,
        errorCallbackURL: `/login?next=${encodeURIComponent(next)}`,
      }),
    // Google の画面へ移動し、ログインが終わると next へ戻ってくる
    onSuccess: ({ url }) => window.location.assign(url),
  });
  // ログイン状態になると下の Navigate が next へ移動させる
  const demoLogin = useMutation({
    mutationFn: (userId: number) => post("/auth/demo-login", { userId }),
    onSuccess: () => queryClient.resetQueries({ queryKey: ["me"] }),
  });

  if (me.data) return <Navigate to={next} replace />;
  const opts = options.data;
  const accounts = opts?.demoAccounts ?? [];
  // デモ用のサイトでは、Google ログインを設定していなければ Google の欄を出さない（本番は常に出す）
  const showGoogle = options.isError || (opts !== undefined && (!opts.demoMode || opts.google));

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden overflow-hidden bg-ai-900 lg:block">
        <FaceWall />
        <div className="absolute inset-0 bg-gradient-to-t from-ai-950 via-ai-950/75 to-ai-900/30" />
        <div className="absolute right-12 bottom-14 left-12 text-white">
          <p className="text-[34px] leading-snug font-bold">
            顔と名前から、
            <br />
            組織が見えてくる。
          </p>
          <p className="mt-4 max-w-md text-[15px] leading-relaxed text-ai-100">
            社員一人ひとりの経歴・スキル・評価を顔写真とひもづけて管理し、配置や育成の判断につなげるタレントマネジメントです。
          </p>
        </div>
      </div>

      <div className="flex items-center justify-center bg-white px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3">
            <BrandMark className="size-10" />
            <div>
              <div className="text-xl font-bold tracking-wide">Facette</div>
              <div className="text-xs text-ink-3">タレントマネジメント</div>
            </div>
          </div>
          <h1 className="mb-6 text-lg font-bold">ログイン</h1>
          {callbackError && (
            <p className="mb-4 rounded-md bg-beni-100 px-3 py-2 text-sm text-beni" role="alert">
              {loginErrorMessage(callbackError)}
            </p>
          )}
          {options.isPending && (
            <div className="flex h-11 items-center justify-center">
              <Spinner />
            </div>
          )}

          {showGoogle && (
            <div className="space-y-4">
              {googleLogin.error && (
                <p className="rounded-md bg-beni-100 px-3 py-2 text-sm text-beni" role="alert">
                  {errorMessage(googleLogin.error)}
                </p>
              )}
              <Button
                className="h-11 w-full gap-2.5"
                icon={<GoogleLogo />}
                loading={googleLogin.isPending || googleLogin.isSuccess}
                disabled={opts?.google === false}
                onClick={() => googleLogin.mutate()}
              >
                Google でログイン
              </Button>
              <p className="text-xs leading-relaxed text-ink-3">
                {opts?.google === false
                  ? "Google ログインが設定されていません。システム管理者にお問い合わせください。"
                  : "システム管理者が登録したメールアドレスの Google アカウントでログインできます。"}
              </p>
            </div>
          )}

          {opts?.demoUrl && (
            <div className="mt-10 border-t border-line-2 pt-6">
              <a
                href={opts.demoUrl}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md border border-line bg-white text-sm font-bold text-ink transition-colors hover:border-ai-200 hover:bg-ai-50"
              >
                デモモードで利用する
                <ArrowRight className="size-4" aria-hidden />
              </a>
              <p className="mt-2 text-xs leading-relaxed text-ink-3">
                サンプルの社員データで、ロールごとの画面と操作を試せます。デモ用のサイトへ移動し、本番のデータには触れません。
              </p>
            </div>
          )}

          {accounts.length > 0 && (
            <div className={showGoogle ? "mt-10" : undefined}>
              <h2 className="text-sm font-bold">デモアカウントで試す</h2>
              <p className="mt-1 mb-3 text-xs leading-relaxed text-ink-3">
                ロールごとに見える情報とできる操作が変わります。デモ用のデータは本番とは別で、毎日早朝（日本時間）とアップデートのときに初期化されます。
              </p>
              <ul className="divide-y divide-line-2 overflow-hidden rounded-lg border border-line">
                {accounts.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => demoLogin.mutate(a.id)}
                      disabled={demoLogin.isPending}
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-ai-50 disabled:opacity-60"
                    >
                      {a.avatarSeed !== null ? (
                        <img src={avatarDataUrl(a.avatarSeed)} alt="" className="size-10 rounded-md" />
                      ) : (
                        <span className="size-10 rounded-md bg-ai-100" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="text-sm font-bold">{ROLE_LABELS[a.role]}</span>
                          <span className="truncate text-xs text-ink-3">{a.displayName}</span>
                        </span>
                        <span className="block truncate text-xs text-ink-2">{ROLE_HINT[a.role]}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {demoLogin.error && <p className="mt-2 text-sm text-beni">{errorMessage(demoLogin.error)}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
