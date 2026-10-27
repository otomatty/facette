import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";
import type { MemberList } from "../../../shared/types";
import { Button, Checkbox, cx, Field, Input, Modal, Textarea, useToast } from "../../components/ui";
import { errorMessage, patch, post } from "../../lib/api";
import { queryClient } from "../../lib/queries";

/** 社員リストの色（API の color と対応） */
export const LIST_COLORS = [
  { value: "ai", label: "藍", className: "bg-ai-600" },
  { value: "yamabuki", label: "山吹", className: "bg-yamabuki" },
  { value: "wakaba", label: "若葉", className: "bg-wakaba" },
  { value: "beni", label: "紅", className: "bg-beni" },
  { value: "fuji", label: "藤", className: "bg-fuji" },
] as const;

export type ListColor = (typeof LIST_COLORS)[number]["value"];

export function listColorClass(color: string): string {
  return LIST_COLORS.find((c) => c.value === color)?.className ?? "bg-ai-600";
}

/** リストの色の印 */
export function ListColorMark({ color, className }: { color: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cx("inline-block size-3 shrink-0 rounded-sm", listColorClass(color), className)}
    />
  );
}

type ListForm = { name: string; description: string; color: ListColor; shared: boolean };

/** 社員リストの作成・編集ダイアログ */
export function ListFormDialog({
  open,
  onClose,
  list,
}: {
  open: boolean;
  onClose: () => void;
  list?: MemberList;
}) {
  const toast = useToast();
  const navigate = useNavigate();
  const [form, setForm] = useState<ListForm>(() => ({
    name: list?.name ?? "",
    description: list?.description ?? "",
    color: (LIST_COLORS.some((c) => c.value === list?.color) ? list?.color : "ai") as ListColor,
    shared: list?.shared ?? false,
  }));
  const [touched, setTouched] = useState(false);
  const nameError = touched && !form.name.trim() ? "リスト名を入力してください" : null;

  const save = useMutation({
    mutationFn: async () => {
      const body = { ...form, name: form.name.trim(), description: form.description.trim() };
      if (list) {
        await patch(`/lists/${list.id}`, body);
        return list.id;
      }
      return (await post<{ id: number }>("/lists", body)).id;
    },
    onSuccess: (id) => {
      queryClient.invalidateQueries({ queryKey: ["lists"] });
      queryClient.invalidateQueries({ queryKey: ["list", id] });
      toast(list ? "リストを保存しました" : "リストを作成しました");
      onClose();
      if (!list) navigate(`/lists/${id}`);
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });

  const submit = () => {
    setTouched(true);
    if (!form.name.trim()) return;
    save.mutate();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={list ? "リストを編集" : "リストを作成"}
      footer={
        <>
          <Button onClick={onClose}>キャンセル</Button>
          <Button variant="primary" loading={save.isPending} onClick={submit}>
            {list ? "保存" : "作成"}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="リスト名" required htmlFor="list-name" error={nameError}>
          <Input
            id="list-name"
            value={form.name}
            maxLength={60}
            aria-invalid={nameError ? true : undefined}
            placeholder="例：新規事業チーム候補"
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            autoFocus
          />
        </Field>
        <Field
          label="説明"
          htmlFor="list-desc"
          help="どんな人を集めたリストか書いておくと、共有したときに伝わります。"
        >
          <Textarea
            id="list-desc"
            rows={3}
            maxLength={400}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </Field>
        <fieldset>
          <legend className="mb-1.5 text-[13px] font-bold text-ink-2">色</legend>
          <div className="flex flex-wrap gap-2">
            {LIST_COLORS.map((c) => {
              const active = form.color === c.value;
              return (
                <label
                  key={c.value}
                  className={cx(
                    "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 text-[13px] transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ai-300",
                    active
                      ? "border-ai-600 bg-ai-50 font-bold ring-2 ring-ai-100"
                      : "border-line bg-white hover:border-ai-200",
                  )}
                >
                  <input
                    type="radio"
                    name="list-color"
                    value={c.value}
                    checked={active}
                    onChange={() => setForm({ ...form, color: c.value })}
                    className="sr-only"
                  />
                  <span className={cx("size-3.5 rounded-sm", c.className)} aria-hidden />
                  {c.label}
                </label>
              );
            })}
          </div>
        </fieldset>
        <div>
          <Checkbox
            label="社内の全員に共有する"
            checked={form.shared}
            onChange={(e) => setForm({ ...form, shared: e.target.checked })}
          />
          <p className="mt-1 pl-6 text-xs text-ink-3">
            共有したリストは全員が閲覧できます。編集できるのは作成者だけです。
          </p>
        </div>
      </form>
    </Modal>
  );
}
