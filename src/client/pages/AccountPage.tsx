import { useMutation } from "@tanstack/react-query";
import { Info, UserRound } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { ROLE_LABELS } from "../../shared/constants";
import { Face } from "../components/Face";
import { Badge, Button, Field, Input, KeyValue, PageHeader, Panel, useToast } from "../components/ui";
import { ApiError, errorMessage, post } from "../lib/api";
import { useAuth } from "../lib/queries";

const MIN_PASSWORD = 10;

export default function AccountPage() {
  const me = useAuth();
  const m = me.member;
  return (
    <div>
      <PageHeader title="アカウント" description="ログインに使うアカウントの情報と、パスワードの変更です。" />
      <div className="grid max-w-5xl gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel title="アカウント情報" className="self-start">
          <div className="mb-4 flex items-center gap-3">
            {m ? (
              <Face member={m} size={56} />
            ) : (
              <span className="flex size-14 items-center justify-center rounded-md bg-ai-100 text-ai-700">
                <UserRound className="size-6" aria-hidden />
              </span>
            )}
            <div className="min-w-0">
              <p className="truncate text-base font-bold">{me.user.displayName}</p>
              <p className="text-xs text-ink-3">{me.companyName}</p>
            </div>
          </div>
          <KeyValue
            items={[
              { label: "メールアドレス", value: <span className="break-all">{me.user.email}</span> },
              { label: "表示名", value: me.user.displayName },
              { label: "ロール", value: <Badge tone="ai">{ROLE_LABELS[me.user.role]}</Badge> },
              {
                label: "ひもづく社員",
                value: m ? (
                  <Link to={`/members/${m.id}`} className="font-bold text-ai-700 hover:underline">
                    {m.lastName} {m.firstName}
                    <span className="ml-1.5 text-xs font-normal text-ink-3">
                      {m.departmentName ?? "所属なし"}
                    </span>
                  </Link>
                ) : (
                  <span className="text-ink-3">なし</span>
                ),
              },
            ]}
          />
          <p className="mt-4 text-xs text-ink-3">
            メールアドレス・表示名・ロールの変更は、システム管理者に依頼してください。
            {m && "プロフィールや顔写真は、ひもづく社員のページから編集できます。"}
          </p>
        </Panel>
        <PasswordPanel />
      </div>
    </div>
  );
}

function PasswordPanel() {
  const me = useAuth();
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [touched, setTouched] = useState(false);
  const [demoBlocked, setDemoBlocked] = useState(false);

  const nextError =
    touched && next.length < MIN_PASSWORD ? `新しいパスワードは${MIN_PASSWORD}文字以上にしてください` : null;
  const sameError = touched && next && next === current ? "現在と異なるパスワードにしてください" : null;
  const confirmError = touched && confirmText !== next ? "確認用のパスワードが一致しません" : null;
  const currentError = touched && !current ? "現在のパスワードを入力してください" : null;

  const change = useMutation({
    mutationFn: () => post("/auth/password", { currentPassword: current, newPassword: next }),
    onSuccess: () => {
      setCurrent("");
      setNext("");
      setConfirmText("");
      setTouched(false);
      toast("パスワードを変更しました");
    },
    onError: (e) => {
      if (me.demoMode && e instanceof ApiError && e.status === 403) setDemoBlocked(true);
    },
  });

  const submit = () => {
    setTouched(true);
    if (!current || next.length < MIN_PASSWORD || next === current || confirmText !== next) return;
    change.mutate();
  };

  return (
    <Panel title="パスワードの変更" className="self-start">
      {demoBlocked ? (
        <div className="flex gap-2.5 rounded-md bg-ai-50 px-3 py-3 text-sm text-ink-2" role="status">
          <Info className="mt-0.5 size-4 shrink-0 text-ai-600" aria-hidden />
          <p>
            デモアカウントのパスワードは変更できません。デモでは、ログイン画面からいつでもこのアカウントに入れます。
          </p>
        </div>
      ) : (
        <form
          className="grid gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {change.error && (
            <p className="rounded-md bg-beni-100 px-3 py-2 text-sm text-beni" role="alert">
              {errorMessage(change.error)}
            </p>
          )}
          <input type="email" name="username" autoComplete="username" value={me.user.email} readOnly hidden />
          <Field label="現在のパスワード" required htmlFor="pw-current" error={currentError}>
            <Input
              id="pw-current"
              type="password"
              autoComplete="current-password"
              value={current}
              aria-invalid={currentError ? true : undefined}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </Field>
          <Field
            label="新しいパスワード"
            required
            htmlFor="pw-new"
            error={nextError ?? sameError}
            help={`${MIN_PASSWORD}文字以上。ほかのサービスと同じものは避けてください。`}
          >
            <Input
              id="pw-new"
              type="password"
              autoComplete="new-password"
              maxLength={128}
              value={next}
              aria-invalid={nextError || sameError ? true : undefined}
              onChange={(e) => setNext(e.target.value)}
            />
          </Field>
          <Field label="新しいパスワード（確認）" required htmlFor="pw-confirm" error={confirmError}>
            <Input
              id="pw-confirm"
              type="password"
              autoComplete="new-password"
              maxLength={128}
              value={confirmText}
              aria-invalid={confirmError ? true : undefined}
              onChange={(e) => setConfirmText(e.target.value)}
            />
          </Field>
          <div>
            <Button type="submit" variant="primary" loading={change.isPending}>
              パスワードを変更
            </Button>
          </div>
        </form>
      )}
    </Panel>
  );
}
