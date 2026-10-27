import { useMutation } from "@tanstack/react-query";
import { Pencil, Plus, Search, Sparkles, Trash2 } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { Link } from "react-router";
import type { Skill } from "../../../shared/types";
import {
  Button,
  EmptyState,
  ErrorBox,
  Field,
  IconButton,
  Input,
  Loading,
  Modal,
  Textarea,
  useConfirm,
  useToast,
} from "../../components/ui";
import { del, errorMessage, patch, post } from "../../lib/api";
import { queryClient, useSkills } from "../../lib/queries";
import { FormError, SectionHeader } from "./common";

function invalidateSkills() {
  queryClient.invalidateQueries({ queryKey: ["skills"] });
  queryClient.invalidateQueries({ queryKey: ["member"] });
  queryClient.invalidateQueries({ queryKey: ["positions"] });
}

export function SkillsTab() {
  const skills = useSkills();
  const toast = useToast();
  const confirm = useConfirm();
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Skill | "new" | null>(null);
  const items = skills.data ?? [];
  const groups = useMemo(() => {
    const k = q.trim().toLowerCase();
    const filtered = k
      ? items.filter((s) => `${s.name} ${s.category} ${s.description}`.toLowerCase().includes(k))
      : items;
    const map = new Map<string, Skill[]>();
    for (const s of filtered) map.set(s.category, [...(map.get(s.category) ?? []), s]);
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], "ja"));
  }, [items, q]);
  const categories = useMemo(
    () => [...new Set(items.map((s) => s.category))].sort((a, b) => a.localeCompare(b, "ja")),
    [items],
  );

  const remove = useMutation({
    mutationFn: (s: Skill) => del(`/skills/${s.id}`),
    onSuccess: (_, s) => {
      invalidateSkills();
      toast(`スキル「${s.name}」を削除しました`);
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });

  return (
    <div>
      <SectionHeader
        title="スキル"
        description={
          <>
            社員が保有スキルとして登録できる項目です。保有状況は
            <Link to="/skills" className="mx-0.5 text-ai-700 underline">
              スキルマップ
            </Link>
            で確認できます。
          </>
        }
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>
            スキルを追加
          </Button>
        }
      />
      {skills.isLoading && <Loading />}
      {skills.error && <ErrorBox error={skills.error} onRetry={() => skills.refetch()} />}
      {skills.data && items.length === 0 && (
        <div className="rounded-lg border border-line bg-white">
          <EmptyState icon={<Sparkles className="size-10" />} title="スキルがありません">
            スキルを追加すると、社員が自分の保有スキルとして登録できるようになります。
          </EmptyState>
        </div>
      )}
      {items.length > 0 && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <div className="relative w-full max-w-xs">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-3" />
              <Input
                aria-label="スキルを絞り込む"
                placeholder="スキル名・カテゴリで絞り込む"
                value={q}
                className="pl-8"
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <p className="tabular text-sm text-ink-2">
              {categories.length}カテゴリ、{items.length}スキル
            </p>
          </div>
          {groups.length === 0 ? (
            <div className="rounded-lg border border-line bg-white">
              <EmptyState title="条件に合うスキルがありません">別のことばで絞り込んでください。</EmptyState>
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {groups.map(([category, list]) => (
                <section key={category} className="self-start rounded-lg border border-line bg-white">
                  <h3 className="flex items-center justify-between border-b border-line-2 px-4 py-2 text-sm font-bold">
                    {category}
                    <span className="tabular text-xs font-normal text-ink-3">{list.length}件</span>
                  </h3>
                  <ul className="divide-y divide-line-2">
                    {list.map((s) => (
                      <li key={s.id} className="flex items-center gap-2 py-1.5 pr-1.5 pl-4">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">{s.name}</span>
                          {s.description && (
                            <span className="block truncate text-xs text-ink-3">{s.description}</span>
                          )}
                        </span>
                        <span className="tabular shrink-0 text-xs text-ink-2">保有 {s.holderCount}名</span>
                        <IconButton label={`${s.name}を編集`} onClick={() => setEditing(s)}>
                          <Pencil className="size-4" />
                        </IconButton>
                        <IconButton
                          label={`${s.name}を削除`}
                          className="hover:bg-beni-100 hover:text-beni"
                          onClick={async () => {
                            if (
                              await confirm({
                                title: `スキル「${s.name}」を削除しますか？`,
                                message:
                                  s.holderCount > 0
                                    ? `${s.holderCount}名の保有スキルの登録と、ポジションの要件からも削除され、元に戻せません。`
                                    : "ポジションの要件に含まれている場合は、そこからも削除されます。",
                                confirmLabel: "削除",
                                danger: true,
                              })
                            )
                              remove.mutate(s);
                          }}
                        >
                          <Trash2 className="size-4" />
                        </IconButton>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </>
      )}
      {editing && (
        <SkillDialog
          skill={editing === "new" ? null : editing}
          categories={categories}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function SkillDialog({
  skill,
  categories,
  onClose,
}: {
  skill: Skill | null;
  categories: string[];
  onClose: () => void;
}) {
  const toast = useToast();
  const listId = useId();
  const [name, setName] = useState(skill?.name ?? "");
  const [category, setCategory] = useState(skill?.category ?? "");
  const [description, setDescription] = useState(skill?.description ?? "");
  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), category: category.trim(), description: description.trim() };
      return skill ? patch(`/skills/${skill.id}`, body) : post("/skills", body);
    },
    onSuccess: () => {
      invalidateSkills();
      toast(skill ? `スキル「${name.trim()}」を保存しました` : `スキル「${name.trim()}」を追加しました`);
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={skill ? "スキルを編集" : "スキルを追加"}
      footer={
        <>
          <Button onClick={onClose}>キャンセル</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            {skill ? "保存" : "追加"}
          </Button>
        </>
      }
    >
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <FormError error={save.error} />
        <Field label="スキル名" required htmlFor="sk-name">
          <Input
            id="sk-name"
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </Field>
        <Field label="カテゴリ" required htmlFor="sk-cat" help="既存のカテゴリから選ぶか、新しく入力します。">
          <Input
            id="sk-cat"
            list={listId}
            value={category}
            maxLength={30}
            onChange={(e) => setCategory(e.target.value)}
          />
          <datalist id={listId}>
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label="説明" htmlFor="sk-desc">
          <Textarea
            id="sk-desc"
            rows={2}
            maxLength={200}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
