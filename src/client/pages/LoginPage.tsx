import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Navigate, useSearchParams } from "react-router";
import { ROLE_LABELS } from "../../shared/constants";
import type { DemoAccount } from "../../shared/types";
import { BrandMark } from "../components/AppShell";
import { avatarDataUrl } from "../components/avatar";
import { Button, Field, Input } from "../components/ui";
import { errorMessage, get, post } from "../lib/api";
import { queryClient, useMe } from "../lib/queries";

const ROLE_HINT: Record<string, string> = {
  admin: "シート設計・ユーザー管理まで全機能",
  hr: "人材データ・評価・アンケートの運用",
  manager: "自部署メンバーの評価・1on1・配置検討",
  member: "自分のプロフィール・自己評価・回答",
};

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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const demo = useQuery({
    queryKey: ["demo-accounts"],
    queryFn: () => get<{ accounts: DemoAccount[] }>("/auth/demo-accounts"),
  });

  // ログイン状態になると下の Navigate が next へ移動させる
  const onSuccess = () => queryClient.resetQueries({ queryKey: ["me"] });
  const login = useMutation({ mutationFn: () => post("/auth/login", { email, password }), onSuccess });
  const demoLogin = useMutation({
    mutationFn: (userId: number) => post("/auth/demo-login", { userId }),
    onSuccess,
  });

  if (me.data) return <Navigate to={next} replace />;
  const accounts = demo.data?.accounts ?? [];

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
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              login.mutate();
            }}
          >
            <Field label="メールアドレス" htmlFor="email">
              <Input
                id="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </Field>
            <Field label="パスワード" htmlFor="password">
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </Field>
            {login.error && (
              <p className="rounded-md bg-beni-100 px-3 py-2 text-sm text-beni" role="alert">
                {errorMessage(login.error)}
              </p>
            )}
            <Button type="submit" variant="primary" className="w-full" loading={login.isPending}>
              ログイン
            </Button>
          </form>

          {accounts.length > 0 && (
            <div className="mt-10">
              <h2 className="text-sm font-bold">デモアカウントで試す</h2>
              <p className="mt-1 mb-3 text-xs text-ink-3">
                ロールごとに見える情報とできる操作が変わります。パスワードはすべて facette-demo です。
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
