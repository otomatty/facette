import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, Shapes } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { formatDateTimeJa } from "../../../shared/dates";
import type { TeamBoardSummary } from "../../../shared/types";
import { FaceStack } from "../../components/Face";
import {
  Badge,
  Button,
  Checkbox,
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
import { queryClient } from "../../lib/queries";

export default function BoardsPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", shared: false });
  const { data, isLoading, error } = useQuery({
    queryKey: ["boards"],
    queryFn: () => get<{ items: TeamBoardSummary[] }>("/boards"),
  });
  const create = useMutation({
    mutationFn: () => post<{ id: number }>("/boards", form),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["boards"] });
      toast("キャンバスを作成しました");
      navigate(`/boards/${r.id}`);
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const mine = (data?.items ?? []).filter((b) => b.isOwner);
  const shared = (data?.items ?? []).filter((b) => !b.isOwner);

  return (
    <div>
      <PageHeader
        title="チームキャンバス"
        description="社員の顔を自由に並べ、グループやメモを書き込んでチーム編成を考えるためのボードです。本番の所属は変わりません。"
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>
            新しいキャンバス
          </Button>
        }
      />
      {isLoading && <Loading />}
      {error && <ErrorBox error={error} />}
      {data && data.items.length === 0 && (
        <div className="rounded-lg border border-line bg-white">
          <EmptyState
            icon={<Shapes className="size-10" />}
            title="キャンバスはまだありません"
            action={
              <Button variant="primary" onClick={() => setOpen(true)}>
                最初のキャンバスを作る
              </Button>
            }
          >
            プロジェクトの体制案や、次世代リーダーの育成計画などを顔で並べて検討できます。
          </EmptyState>
        </div>
      )}
      {[
        { title: "自分のキャンバス", list: mine },
        { title: "共有されたキャンバス", list: shared },
      ].map(
        (g) =>
          g.list.length > 0 && (
            <section key={g.title} className="mb-6">
              <h2 className="mb-2 text-sm font-bold text-ink-2">{g.title}</h2>
              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {g.list.map((b) => (
                  <li key={b.id}>
                    <Link
                      to={`/boards/${b.id}`}
                      className="block h-full rounded-lg border border-line bg-white p-4 transition-colors hover:border-ai-300"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-bold">{b.name}</h3>
                        {b.shared && <Badge tone="ai">共有</Badge>}
                      </div>
                      {b.description && (
                        <p className="mt-1 line-clamp-2 text-[13px] text-ink-2">{b.description}</p>
                      )}
                      <div className="mt-3 flex items-center justify-between gap-3">
                        <FaceStack members={b.previewMembers} max={6} />
                        <span className="tabular text-xs text-ink-3">
                          {b.memberCount}名、グループ{b.groupCount}つ
                        </span>
                      </div>
                      <p className="mt-2 text-[11px] text-ink-3">
                        {formatDateTimeJa(b.updatedAt)} 更新（{b.ownerName}）
                      </p>
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
        title="新しいキャンバス"
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
          <Field label="名前" required htmlFor="bd-name">
            <Input
              id="bd-name"
              value={form.name}
              autoFocus
              placeholder="例：新規事業チームの体制案"
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <Field label="説明" htmlFor="bd-desc">
            <Textarea
              id="bd-desc"
              rows={2}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </Field>
          <Checkbox
            label="ほかの社員にも公開する（閲覧のみ）"
            checked={form.shared}
            onChange={(e) => setForm({ ...form, shared: e.target.checked })}
          />
        </div>
      </Modal>
    </div>
  );
}
