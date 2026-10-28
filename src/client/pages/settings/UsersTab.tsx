import { useMutation, useQuery } from "@tanstack/react-query";
import { Pencil, Plus, Trash2, UserCog } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { ROLE_LABELS, ROLES, type Role } from "../../../shared/constants";
import { formatDateTimeJa } from "../../../shared/dates";
import { type Capabilities, capabilitiesFor } from "../../../shared/permissions";
import type { AppUser, MemberSummary } from "../../../shared/types";
import { Face } from "../../components/Face";
import { MemberPicker } from "../../components/pickers";
import {
  Badge,
  Button,
  Checkbox,
  cx,
  EmptyState,
  ErrorBox,
  Field,
  IconButton,
  Input,
  Loading,
  Modal,
  Select,
  useConfirm,
  useToast,
} from "../../components/ui";
import { del, errorMessage, get, patch, post } from "../../lib/api";
import { queryClient, useAuth } from "../../lib/queries";
import { AccountAvatar, FormError, SectionHeader } from "./common";

const CAP_LABELS: Record<keyof Capabilities, string> = {
  manageMembers: "社員の登録・編集・CSV入出力",
  manageMasters: "組織・役職などのマスタ管理",
  manageSheets: "シートの設計",
  manageUsers: "ユーザーとロールの管理",
  viewAuditLogs: "操作ログの閲覧",
  manageEvaluations: "評価制度・評価期間の運用",
  manageSurveys: "アンケートの作成・集計",
  usePlacement: "配置シミュレーション",
  applyPlacement: "配置の本番反映",
  viewAnalytics: "分析・ダッシュボード",
  manageAnnouncements: "お知らせの投稿",
  manageTalent: "スキル・ポジションの管理",
  reviewRequests: "変更申請の承認",
  writeOneOnOnes: "1on1・面談の記録",
};

const ROLE_SCOPE: Record<Role, string> = {
  admin: "全社員",
  hr: "全社員",
  manager: "自部署と配下の部署",
  member: "自分",
};

/** 各ロールが1つ下のロールに加えてできること（permissions.ts から求める） */
function roleGuide() {
  const order = [...ROLES].reverse(); // member → manager → hr → admin
  return order
    .map((role, i) => {
      const caps = capabilitiesFor(role);
      const lower = i > 0 ? capabilitiesFor(order[i - 1]!) : null;
      const added = (Object.keys(CAP_LABELS) as (keyof Capabilities)[]).filter((k) => caps[k] && !lower?.[k]);
      return { role, lowerRole: i > 0 ? order[i - 1]! : null, added };
    })
    .reverse();
}

function RoleGuide() {
  const rows = roleGuide();
  return (
    <section className="mb-5 rounded-lg border border-line bg-white" aria-labelledby="role-guide">
      <h3 id="role-guide" className="border-b border-line-2 px-4 py-2.5 text-[13px] font-bold">
        ロールでできること
      </h3>
      <dl className="divide-y divide-line-2">
        {rows.map((r) => (
          <div key={r.role} className="grid gap-x-4 gap-y-1 px-4 py-2.5 sm:grid-cols-[9rem_1fr]">
            <dt className="text-sm font-bold">
              {ROLE_LABELS[r.role]}
              <span className="block text-xs font-normal text-ink-3">対象：{ROLE_SCOPE[r.role]}</span>
            </dt>
            <dd className="text-[13px] text-ink-2">
              {r.lowerRole ? (
                <>
                  <span className="text-ink-3">{ROLE_LABELS[r.lowerRole]}のできることに加えて</span>
                  <span className="mt-1 flex flex-wrap gap-1">
                    {r.added.map((k) => (
                      <span key={k} className="rounded bg-line-2 px-1.5 py-0.5 text-xs text-ink">
                        {CAP_LABELS[k]}
                      </span>
                    ))}
                  </span>
                </>
              ) : (
                "自分のプロフィールの確認と編集、自己評価、アンケートへの回答、シートの変更申請ができます。他の社員は全社に公開された情報だけを閲覧できます。"
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function UsersTab() {
  const me = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<AppUser | "new" | null>(null);
  const users = useQuery({
    queryKey: ["users"],
    queryFn: async () => (await get<{ items: AppUser[] }>("/users")).items,
  });
  const remove = useMutation({
    mutationFn: (u: AppUser) => del(`/users/${u.id}`),
    onSuccess: (_, u) => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      toast(`${u.displayName}さんのユーザーを削除しました`);
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });

  const items = users.data ?? [];
  const activeCount = items.filter((u) => u.active).length;

  return (
    <div>
      <SectionHeader
        title="ユーザー"
        description="Facette にログインできるアカウントです。ロールで使える機能と、見られる社員の範囲が決まります。"
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>
            ユーザーを追加
          </Button>
        }
      />
      <RoleGuide />

      {users.isLoading && <Loading />}
      {users.error && <ErrorBox error={users.error} onRetry={() => users.refetch()} />}
      {users.data && items.length === 0 && (
        <div className="rounded-lg border border-line bg-white">
          <EmptyState icon={<UserCog className="size-10" />} title="ユーザーがいません">
            ユーザーを追加すると、ここに表示されます。
          </EmptyState>
        </div>
      )}
      {items.length > 0 && (
        <>
          <p className="mb-2 text-sm text-ink-2">
            <span className="tabular text-lg font-bold text-ink">{items.length}</span> 件
            <span className="tabular ml-3 text-xs text-ink-3">有効 {activeCount}件</span>
          </p>
          <div className="relative overflow-x-auto rounded-lg border border-line bg-white">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="border-b border-line bg-canvas/60 text-left text-xs text-ink-3">
                <tr>
                  <th className="px-3 py-2 font-normal">ユーザー</th>
                  <th className="px-3 py-2 font-normal">ロール</th>
                  <th className="px-3 py-2 font-normal">ひもづく社員</th>
                  <th className="px-3 py-2 font-normal">状態</th>
                  <th className="px-3 py-2 font-normal">最終ログイン</th>
                  <th className="w-28 px-3 py-2">
                    <span className="sr-only">操作</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-2">
                {items.map((u) => {
                  const self = u.id === me.user.id;
                  return (
                    <tr key={u.id} className={cx("hover:bg-ai-50/60", !u.active && "text-ink-3")}>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2.5">
                          {u.member ? (
                            <Face member={u.member} size={34} className={cx(!u.active && "opacity-60")} />
                          ) : (
                            <AccountAvatar size={34} />
                          )}
                          <span className="min-w-0">
                            <span className="flex items-center gap-1.5 font-bold">
                              {u.displayName}
                              {self && <Badge tone="ai">あなた</Badge>}
                            </span>
                            <span className="block truncate text-xs text-ink-3">{u.email}</span>
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{ROLE_LABELS[u.role]}</td>
                      <td className="px-3 py-2">
                        {u.member ? (
                          <Link to={`/members/${u.member.id}`} className="hover:text-ai-700 hover:underline">
                            {u.member.lastName} {u.member.firstName}
                            <span className="ml-1.5 text-xs text-ink-3">{u.member.departmentName}</span>
                          </Link>
                        ) : (
                          <span className="text-ink-3">なし</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {u.active ? <Badge tone="wakaba">有効</Badge> : <Badge>無効</Badge>}
                      </td>
                      <td className="tabular px-3 py-2 whitespace-nowrap text-ink-2">
                        {u.lastLoginAt ? formatDateTimeJa(u.lastLoginAt) : "未ログイン"}
                      </td>
                      <td className="px-2 py-1 text-right whitespace-nowrap">
                        <IconButton label={`${u.displayName}さんを編集`} onClick={() => setEditing(u)}>
                          <Pencil className="size-4" />
                        </IconButton>
                        {!self && (
                          <IconButton
                            label={`${u.displayName}さんを削除`}
                            className="hover:bg-beni-100 hover:text-beni"
                            onClick={async () => {
                              if (
                                await confirm({
                                  title: `${u.displayName}さんのユーザーを削除しますか？`,
                                  message:
                                    "このユーザーが作った社員リスト・保存したグラフ・ダッシュボードも削除され、元に戻せません。ひもづく社員の情報は残ります。ログインできないようにするだけなら、編集で「無効」にしてください。",
                                  confirmLabel: "削除",
                                  danger: true,
                                })
                              )
                                remove.mutate(u);
                            }}
                          >
                            <Trash2 className="size-4" />
                          </IconButton>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {editing && (
        <UserFormDialog
          user={editing === "new" ? null : editing}
          users={items}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

type UserForm = {
  email: string;
  displayName: string;
  role: Role;
  member: MemberSummary | null;
  active: boolean;
};

function UserFormDialog({
  user,
  users,
  onClose,
}: {
  user: AppUser | null;
  users: AppUser[];
  onClose: () => void;
}) {
  const me = useAuth();
  const toast = useToast();
  const self = user?.id === me.user.id;
  const [form, setForm] = useState<UserForm>({
    email: user?.email ?? "",
    displayName: user?.displayName ?? "",
    role: user?.role ?? "member",
    member: user?.member ?? null,
    active: user?.active ?? true,
  });
  const set = <K extends keyof UserForm>(k: K, v: UserForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const linkedIds = users
    .filter((u) => u.id !== user?.id && u.memberId !== null)
    .map((u) => u.memberId as number);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        email: form.email.trim(),
        displayName: form.displayName.trim(),
        role: form.role,
        memberId: form.member?.id ?? null,
        active: form.active,
      };
      return user ? patch(`/users/${user.id}`, body) : post("/users", body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      if (self) queryClient.invalidateQueries({ queryKey: ["me"] });
      toast(user ? "ユーザーを保存しました" : `${form.displayName.trim()}さんのユーザーを追加しました`);
      onClose();
    },
  });
  const submit = () => save.mutate();

  return (
    <Modal
      open
      onClose={onClose}
      title={user ? "ユーザーを編集" : "ユーザーを追加"}
      footer={
        <>
          <Button onClick={onClose}>キャンセル</Button>
          <Button variant="primary" loading={save.isPending} onClick={submit}>
            {user ? "保存" : "追加"}
          </Button>
        </>
      }
    >
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <FormError error={save.error} />
        <Field
          label="ひもづく社員"
          htmlFor="u-member"
          help="社員にひもづけると、本人として自分のプロフィールや評価を扱えます。"
        >
          <MemberPicker
            id="u-member"
            value={form.member}
            excludeIds={linkedIds}
            onChange={(m) =>
              setForm((f) => ({
                ...f,
                member: m,
                displayName: m && !f.displayName.trim() ? `${m.lastName} ${m.firstName}` : f.displayName,
              }))
            }
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="表示名" required htmlFor="u-name">
            <Input
              id="u-name"
              value={form.displayName}
              maxLength={60}
              onChange={(e) => set("displayName", e.target.value)}
            />
          </Field>
          <Field label="ロール" required htmlFor="u-role" help={self ? "自分のロールは変更できません" : null}>
            <Select
              id="u-role"
              value={form.role}
              disabled={self}
              onChange={(e) => set("role", e.target.value as Role)}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field
          label="メールアドレス"
          required
          htmlFor="u-email"
          help={
            user
              ? "このアドレスの Google アカウントでログインします。変更すると、ログイン中の端末からログアウトされます。"
              : "このアドレスの Google アカウントでログインします（Google Workspace のアドレスも使えます）。"
          }
        >
          <Input
            id="u-email"
            type="email"
            autoComplete="off"
            value={form.email}
            onChange={(e) => set("email", e.target.value)}
          />
        </Field>
        <div>
          <Checkbox
            label="有効（ログインできる）"
            checked={form.active}
            disabled={self}
            onChange={(e) => set("active", e.target.checked)}
          />
          <p className="mt-1 text-xs text-ink-3">
            {self
              ? "自分自身を無効にすることはできません。"
              : "無効にすると、ログイン中の端末からもログアウトされます。"}
          </p>
        </div>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
