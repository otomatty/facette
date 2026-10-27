import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, Shuffle } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { formatDateJa, formatDateTimeJa } from "../../../shared/dates";
import type { PlacementScenario } from "../../../shared/types";
import {
  Badge,
  Button,
  EmptyState,
  ErrorBox,
  Field,
  Input,
  Loading,
  Modal,
  PageHeader,
  Textarea,
  useToast,
} from "../../components/ui";
import { errorMessage, get, post } from "../../lib/api";
import { queryClient, useAuth } from "../../lib/queries";

export default function PlacementListPage() {
  const me = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", effectiveDate: "" });
  const { data, isLoading, error } = useQuery({
    queryKey: ["placement"],
    queryFn: () => get<{ items: PlacementScenario[] }>("/placement"),
  });
  const create = useMutation({
    mutationFn: () =>
      post<{ id: number }>("/placement", { ...form, effectiveDate: form.effectiveDate || null }),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["placement"] });
      toast("シミュレーションを作成しました");
      navigate(`/placement/${r.id}`);
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const items = data?.items ?? [];
  const drafts = items.filter((s) => s.status === "draft");
  const applied = items.filter((s) => s.status === "applied");

  return (
    <div>
      <PageHeader
        title="配置シミュレーション"
        description={
          me.capabilities.applyPlacement
            ? "組織図の上で顔をドラッグして異動案をつくり、決まったら本番の所属に反映します。"
            : "組織図の上で顔をドラッグして異動案を検討できます。本番への反映は人事担当が行います。"
        }
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>
            新しいシミュレーション
          </Button>
        }
      />
      {isLoading && <Loading />}
      {error && <ErrorBox error={error} />}
      {data && items.length === 0 && (
        <div className="rounded-lg border border-line bg-white">
          <EmptyState
            icon={<Shuffle className="size-10" />}
            title="シミュレーションはまだありません"
            action={
              <Button variant="primary" onClick={() => setOpen(true)}>
                最初のシミュレーションを作る
              </Button>
            }
          >
            現在の組織をコピーした作業用の組織図ができます。本番のデータは反映するまで変わりません。
          </EmptyState>
        </div>
      )}
      {[
        { title: "検討中", list: drafts },
        { title: "反映済み", list: applied },
      ].map(
        (g) =>
          g.list.length > 0 && (
            <section key={g.title} className="mb-6">
              <h2 className="mb-2 text-sm font-bold text-ink-2">{g.title}</h2>
              <ul className="divide-y divide-line-2 overflow-hidden rounded-lg border border-line bg-white">
                {g.list.map((s) => (
                  <li key={s.id}>
                    <Link
                      to={`/placement/${s.id}`}
                      className="flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-3.5 hover:bg-ai-50"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold">{s.name}</span>
                          {s.status === "applied" ? (
                            <Badge tone="wakaba">反映済み</Badge>
                          ) : (
                            <Badge tone="ai">検討中</Badge>
                          )}
                        </div>
                        {s.description && (
                          <p className="mt-0.5 truncate text-[13px] text-ink-2">{s.description}</p>
                        )}
                      </div>
                      <dl className="flex gap-6 text-right text-[13px]">
                        <div>
                          <dt className="text-[11px] text-ink-3">異動</dt>
                          <dd className="tabular font-bold">{s.moveCount}名</dd>
                        </div>
                        <div>
                          <dt className="text-[11px] text-ink-3">発令日</dt>
                          <dd>{s.effectiveDate ? formatDateJa(s.effectiveDate) : "未定"}</dd>
                        </div>
                        <div className="hidden sm:block">
                          <dt className="text-[11px] text-ink-3">
                            {s.status === "applied" ? "反映" : "更新"}
                          </dt>
                          <dd className="tabular text-ink-2">
                            {formatDateTimeJa(s.appliedAt ?? s.updatedAt)}
                          </dd>
                        </div>
                        <div className="hidden md:block">
                          <dt className="text-[11px] text-ink-3">作成者</dt>
                          <dd className="text-ink-2">{s.createdByName ?? "—"}</dd>
                        </div>
                      </dl>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ),
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="新しいシミュレーション"
        footer={
          <>
            <Button onClick={() => setOpen(false)}>キャンセル</Button>
            <Button
              variant="primary"
              disabled={!form.name.trim()}
              loading={create.isPending}
              onClick={() => create.mutate()}
            >
              作成して開く
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="名前" required htmlFor="pl-name">
            <Input
              id="pl-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="例：来年4月の組織改編案"
              autoFocus
            />
          </Field>
          <Field label="発令予定日" htmlFor="pl-date" help="反映したときの異動履歴の日付になります">
            <Input
              id="pl-date"
              type="date"
              value={form.effectiveDate}
              onChange={(e) => setForm({ ...form, effectiveDate: e.target.value })}
              className="max-w-48"
            />
          </Field>
          <Field label="メモ" htmlFor="pl-desc">
            <Textarea
              id="pl-desc"
              rows={3}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
