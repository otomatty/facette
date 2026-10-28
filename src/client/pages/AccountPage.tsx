import { UserRound } from "lucide-react";
import { Link } from "react-router";
import { ROLE_LABELS } from "../../shared/constants";
import { Face } from "../components/Face";
import { Badge, KeyValue, PageHeader, Panel } from "../components/ui";
import { useAuth } from "../lib/queries";

export default function AccountPage() {
  const me = useAuth();
  const m = me.member;
  return (
    <div>
      <PageHeader title="アカウント" description="ログインに使うアカウントの情報です。" />
      <div className="max-w-2xl">
        <Panel title="アカウント情報">
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
              { label: "ログイン方法", value: "Google アカウント" },
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
      </div>
    </div>
  );
}
