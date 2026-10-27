import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ScrollText, Search, X } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { formatDateTimeJa } from "../../../shared/dates";
import type { AuditLog, Paged } from "../../../shared/types";
import { Button, EmptyState, ErrorBox, Input, Loading, Pagination, Select } from "../../components/ui";
import { get, qs } from "../../lib/api";
import { SectionHeader } from "./common";

const PAGE_SIZE = 50;

/** 操作の種類（action の前方一致で絞り込む） */
const ACTION_GROUPS: { value: string; label: string }[] = [
  { value: "login", label: "ログイン" },
  { value: "password", label: "パスワード変更" },
  { value: "user", label: "ユーザー" },
  { value: "member", label: "社員" },
  { value: "sheet", label: "シート" },
  { value: "department", label: "部署" },
  { value: "master", label: "役職・等級・雇用形態" },
  { value: "skill", label: "スキル" },
  { value: "position", label: "ポジション" },
  { value: "evaluation", label: "評価" },
  { value: "survey", label: "アンケート" },
  { value: "one_on_one", label: "1on1・面談" },
  { value: "request", label: "変更申請" },
  { value: "placement", label: "配置" },
  { value: "list", label: "社員リスト" },
  { value: "board", label: "チームボード" },
  { value: "announcement", label: "お知らせ" },
  { value: "settings", label: "会社設定" },
];

const ACTION_LABELS: Record<string, string> = {
  login: "ログイン",
  "password.change": "パスワード変更",
  "user.create": "ユーザー追加",
  "user.update": "ユーザー更新",
  "user.delete": "ユーザー削除",
  "user.password.reset": "パスワード再設定",
  "member.create": "社員登録",
  "member.update": "社員情報の更新",
  "member.update.self": "本人による更新",
  "member.delete": "社員削除",
  "member.import": "CSV取り込み",
  "member.export": "CSV出力",
  "member.photo.update": "顔写真の更新",
  "member.photo.delete": "顔写真の削除",
  "member.skills.update": "スキルの更新",
  "sheet.create": "シート作成",
  "sheet.update": "シート設定の変更",
  "sheet.delete": "シート削除",
  "sheet.reorder": "シートの並べ替え",
  "sheet.field.create": "項目の追加",
  "sheet.field.update": "項目の変更",
  "sheet.field.delete": "項目の削除",
  "sheet.record.create": "シートの追加",
  "sheet.record.update": "シートの更新",
  "sheet.record.delete": "シートの削除",
  "department.create": "部署追加",
  "department.update": "部署更新",
  "department.delete": "部署削除",
  "department.reorder": "部署の並べ替え",
  "skill.create": "スキル追加",
  "skill.update": "スキル更新",
  "skill.delete": "スキル削除",
  "position.create": "ポジション作成",
  "position.update": "ポジション更新",
  "position.delete": "ポジション削除",
  "evaluation.submit": "評価の提出",
  "evaluation.remand": "評価の差し戻し",
  "evaluation.period.create": "評価期間の作成",
  "evaluation.period.status": "評価期間の状態変更",
  "evaluation.period.delete": "評価期間の削除",
  "evaluation.sheet.delete": "評価シートの削除",
  "evaluation.template.create": "評価制度の作成",
  "evaluation.template.update": "評価制度の更新",
  "survey.create": "アンケート作成",
  "survey.update": "アンケート更新",
  "survey.publish": "アンケート配信",
  "survey.close": "アンケート締切",
  "survey.reopen": "アンケート再開",
  "survey.delete": "アンケート削除",
  "one_on_one.create": "面談記録の作成",
  "one_on_one.delete": "面談記録の削除",
  "request.create": "変更申請",
  "request.approve": "申請の承認",
  "request.reject": "申請の却下",
  "placement.create": "配置案の作成",
  "placement.apply": "配置の反映",
  "placement.delete": "配置案の削除",
  "list.create": "社員リスト作成",
  "list.delete": "社員リスト削除",
  "board.create": "チームボード作成",
  "board.delete": "チームボード削除",
  "announcement.create": "お知らせ投稿",
  "announcement.update": "お知らせ更新",
  "announcement.delete": "お知らせ削除",
  "settings.update": "会社設定の変更",
};

const MASTER_LABELS: Record<string, string> = {
  job_titles: "役職",
  grades: "等級",
  employment_types: "雇用形態",
};
const VERB_LABELS: Record<string, string> = { create: "追加", update: "更新", delete: "削除" };

function actionLabel(action: string): string {
  const known = ACTION_LABELS[action];
  if (known) return known;
  const m = /^master\.([a-z_]+)\.(create|update|delete)$/.exec(action);
  if (m) return `${MASTER_LABELS[m[1]!] ?? "マスタ"}${VERB_LABELS[m[2]!]}`;
  return action;
}

export function AuditTab() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const action = params.get("action") ?? "";
  const page = Number(params.get("page") ?? 1) || 1;
  const [qInput, setQInput] = useState(q);

  const logs = useQuery({
    queryKey: ["audit-logs", q, action, page],
    queryFn: () => get<Paged<AuditLog>>(`/audit-logs${qs({ q, action, page, pageSize: PAGE_SIZE })}`),
    placeholderData: keepPreviousData,
  });

  const setParam = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(updates)) {
      if (!v) next.delete(k);
      else next.set(k, v);
    }
    if (!("page" in updates)) next.delete("page");
    setParams(next, { replace: true });
  };

  const items = logs.data?.items ?? [];
  const filtered = !!(q || action);

  return (
    <div>
      <SectionHeader
        title="操作ログ"
        description="ログインやデータの変更など、だれがいつ何をしたかの記録です。新しい順に表示します。"
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <form
          className="relative min-w-56 flex-1 sm:max-w-sm"
          onSubmit={(e) => {
            e.preventDefault();
            setParam({ q: qInput.trim() });
          }}
        >
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-3" />
          <Input
            type="search"
            aria-label="内容・ユーザー名で検索"
            placeholder="内容・ユーザー名で検索"
            value={qInput}
            className="pl-8"
            onChange={(e) => setQInput(e.target.value)}
            onBlur={() => qInput.trim() !== q && setParam({ q: qInput.trim() })}
          />
        </form>
        <Select
          aria-label="操作の種類"
          className="w-48"
          value={action}
          onChange={(e) => setParam({ action: e.target.value })}
        >
          <option value="">すべての操作</option>
          {ACTION_GROUPS.map((g) => (
            <option key={g.value} value={g.value}>
              {g.label}
            </option>
          ))}
        </Select>
        {filtered && (
          <Button
            size="sm"
            variant="ghost"
            icon={<X className="size-4" />}
            onClick={() => {
              setQInput("");
              setParam({ q: null, action: null });
            }}
          >
            条件をクリア
          </Button>
        )}
        <p className="ml-auto text-sm text-ink-2" aria-live="polite">
          <span className="tabular font-bold text-ink">{logs.data?.total ?? "—"}</span> 件
          {logs.isFetching && !logs.isLoading && <span className="ml-2 text-xs text-ink-3">更新中</span>}
        </p>
      </div>

      {logs.isLoading && <Loading />}
      {logs.error && <ErrorBox error={logs.error} onRetry={() => logs.refetch()} />}
      {logs.data && items.length === 0 && (
        <div className="rounded-lg border border-line bg-white">
          <EmptyState
            icon={<ScrollText className="size-10" />}
            title={filtered ? "条件に合う記録がありません" : "記録はまだありません"}
          >
            {filtered
              ? "検索語や操作の種類を変えてお試しください。"
              : "ログインや変更の操作をすると、ここに記録されます。"}
          </EmptyState>
        </div>
      )}
      {items.length > 0 && (
        <div className="relative overflow-x-auto rounded-lg border border-line bg-white">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b border-line bg-canvas/60 text-left text-xs text-ink-3">
              <tr>
                <th className="w-36 px-3 py-2 font-normal">日時</th>
                <th className="w-36 px-3 py-2 font-normal">ユーザー</th>
                <th className="w-40 px-3 py-2 font-normal">操作</th>
                <th className="px-3 py-2 font-normal">内容</th>
                <th className="w-32 px-3 py-2 font-normal">IP アドレス</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-2">
              {items.map((l) => (
                <tr key={l.id} className="align-top hover:bg-ai-50/60">
                  <td className="tabular px-3 py-2 whitespace-nowrap text-ink-2">
                    {formatDateTimeJa(l.createdAt)}
                  </td>
                  <td className="px-3 py-2">{l.userName || <span className="text-ink-3">—</span>}</td>
                  <td className="px-3 py-2">
                    <span className="block">{actionLabel(l.action)}</span>
                  </td>
                  <td className="px-3 py-2 break-words text-ink-2">{l.summary}</td>
                  <td className="tabular px-3 py-2 text-xs whitespace-nowrap text-ink-3">{l.ip ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {logs.data && (
        <div className="mt-4">
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={logs.data.total}
            onChange={(p) => {
              setParam({ page: p === 1 ? null : String(p) });
              window.scrollTo(0, 0);
            }}
          />
        </div>
      )}
    </div>
  );
}
