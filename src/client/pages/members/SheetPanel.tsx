import { useMutation } from "@tanstack/react-query";
import { FilePenLine, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { formatDateTimeJa } from "../../../shared/dates";
import type { FieldValue, MemberSheetView, SheetRecord } from "../../../shared/types";
import { FieldInput, FieldValueView } from "../../components/pickers";
import { Badge, Button, EmptyState, Field, Modal, Textarea, useConfirm, useToast } from "../../components/ui";
import { ApiError, del, errorMessage, patch, post, put } from "../../lib/api";
import { queryClient } from "../../lib/queries";

function RecordForm({
  view,
  initial,
  errors,
  onChange,
}: {
  view: MemberSheetView;
  initial: Record<string, FieldValue>;
  errors: Record<string, string>;
  onChange: (d: Record<string, FieldValue>) => void;
}) {
  return (
    <div className="grid gap-4">
      {view.sheet.fields.map((f) => (
        <Field
          key={f.id}
          label={f.label}
          required={f.required}
          help={f.helpText}
          error={errors[String(f.id)]}
          htmlFor={`sf-${f.id}`}
        >
          <FieldInput
            id={`sf-${f.id}`}
            field={f}
            value={initial[String(f.id)]}
            error={errors[String(f.id)]}
            onChange={(v) => onChange({ ...initial, [String(f.id)]: v })}
          />
        </Field>
      ))}
    </div>
  );
}

export function SheetPanel({ memberId, view }: { memberId: number; view: MemberSheetView }) {
  const toast = useToast();
  const confirm = useConfirm();
  const editable = view.access === "edit";
  const [editing, setEditing] = useState<{
    record: SheetRecord | null;
    data: Record<string, FieldValue>;
  } | null>(null);
  const [requesting, setRequesting] = useState<{ data: Record<string, FieldValue>; reason: string } | null>(
    null,
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["member", memberId, "sheets"] });

  const save = useMutation({
    mutationFn: () => {
      if (!editing) throw new Error();
      if (view.sheet.kind === "single")
        return put(`/members/${memberId}/sheets/${view.sheet.id}`, { data: editing.data });
      if (editing.record)
        return patch(`/members/${memberId}/sheets/${view.sheet.id}/records/${editing.record.id}`, {
          data: editing.data,
        });
      return post(`/members/${memberId}/sheets/${view.sheet.id}/records`, { data: editing.data });
    },
    onSuccess: () => {
      invalidate();
      setEditing(null);
      setErrors({});
      toast(`「${view.sheet.name}」を保存しました`);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.fieldErrors) setErrors(e.fieldErrors);
      else toast(errorMessage(e), "error");
    },
  });
  const remove = useMutation({
    mutationFn: (recordId: number) => del(`/members/${memberId}/sheets/${view.sheet.id}/records/${recordId}`),
    onSuccess: () => {
      invalidate();
      toast("削除しました");
    },
  });
  const request = useMutation({
    mutationFn: () =>
      post("/requests", { sheetId: view.sheet.id, data: requesting?.data, reason: requesting?.reason }),
    onSuccess: () => {
      setRequesting(null);
      setErrors({});
      queryClient.invalidateQueries({ queryKey: ["requests"] });
      toast("変更を申請しました。人事が確認後に反映されます");
    },
    onError: (e) => {
      if (e instanceof ApiError && e.fieldErrors) setErrors(e.fieldErrors);
      else toast(errorMessage(e), "error");
    },
  });

  const single = view.sheet.kind === "single";
  const record = view.records[0];

  return (
    <section className="rounded-lg border border-line bg-white">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line-2 px-5 py-3">
        <div>
          <h2 className="flex items-center gap-2 text-[15px] font-bold">
            {view.sheet.name}
            <Badge tone={editable ? "wakaba" : "neutral"}>{editable ? "編集できます" : "閲覧のみ"}</Badge>
          </h2>
          {view.sheet.description && <p className="mt-0.5 text-xs text-ink-3">{view.sheet.description}</p>}
        </div>
        <div className="flex gap-2">
          {single && editable && (
            <Button
              size="sm"
              icon={<Pencil className="size-3.5" />}
              onClick={() => setEditing({ record: record ?? null, data: { ...(record?.data ?? {}) } })}
            >
              編集
            </Button>
          )}
          {!single && editable && (
            <Button
              size="sm"
              variant="primary"
              icon={<Plus className="size-3.5" />}
              onClick={() => setEditing({ record: null, data: {} })}
            >
              追加
            </Button>
          )}
          {view.canRequestChange && (
            <Button
              size="sm"
              icon={<FilePenLine className="size-3.5" />}
              onClick={() => setRequesting({ data: { ...(record?.data ?? {}) }, reason: "" })}
            >
              変更を申請
            </Button>
          )}
        </div>
      </header>

      <div className="p-5">
        {single ? (
          <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
            {view.sheet.fields.map((f) => (
              <div key={f.id} className={f.type === "textarea" ? "sm:col-span-2" : undefined}>
                <dt className="mb-0.5 text-xs text-ink-3">{f.label}</dt>
                <dd className="text-sm">
                  <FieldValueView field={f} value={record?.data[String(f.id)]} />
                </dd>
              </div>
            ))}
            {record && (
              <p className="text-[11px] text-ink-3 sm:col-span-2">
                最終更新 {formatDateTimeJa(record.updatedAt)}
              </p>
            )}
          </dl>
        ) : view.records.length === 0 ? (
          <EmptyState title="まだ登録されていません" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-line text-left text-xs text-ink-3">
                <tr>
                  {view.sheet.fields.map((f) => (
                    <th key={f.id} className="py-2 pr-4 font-normal">
                      {f.label}
                    </th>
                  ))}
                  {editable && <th className="w-20" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-line-2">
                {view.records.map((r) => (
                  <tr key={r.id}>
                    {view.sheet.fields.map((f) => (
                      <td key={f.id} className="py-2 pr-4 align-top">
                        <FieldValueView field={f} value={r.data[String(f.id)]} />
                      </td>
                    ))}
                    {editable && (
                      <td className="py-1 text-right whitespace-nowrap">
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label="編集"
                          onClick={() => setEditing({ record: r, data: { ...r.data } })}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label="削除"
                          onClick={async () => {
                            if (
                              await confirm({
                                title: "この行を削除しますか？",
                                confirmLabel: "削除",
                                danger: true,
                              })
                            )
                              remove.mutate(r.id);
                          }}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        open={!!editing}
        onClose={() => {
          setEditing(null);
          setErrors({});
        }}
        title={`${view.sheet.name}を${editing?.record || single ? "編集" : "追加"}`}
        footer={
          <>
            <Button onClick={() => setEditing(null)}>キャンセル</Button>
            <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
              保存
            </Button>
          </>
        }
      >
        {editing && (
          <RecordForm
            view={view}
            initial={editing.data}
            errors={errors}
            onChange={(data) => setEditing({ ...editing, data })}
          />
        )}
      </Modal>

      <Modal
        open={!!requesting}
        onClose={() => {
          setRequesting(null);
          setErrors({});
        }}
        title={`「${view.sheet.name}」の変更を申請`}
        footer={
          <>
            <Button onClick={() => setRequesting(null)}>キャンセル</Button>
            <Button
              variant="primary"
              loading={request.isPending}
              disabled={!requesting?.reason.trim()}
              onClick={() => request.mutate()}
            >
              申請する
            </Button>
          </>
        }
      >
        {requesting && (
          <div className="space-y-5">
            <p className="text-sm text-ink-2">
              変更したい項目を書き換えて申請してください。人事担当が承認すると反映されます。
            </p>
            <RecordForm
              view={view}
              initial={requesting.data}
              errors={errors}
              onChange={(data) => setRequesting({ ...requesting, data })}
            />
            <Field label="申請理由" required htmlFor="req-reason">
              <Textarea
                id="req-reason"
                rows={2}
                value={requesting.reason}
                onChange={(e) => setRequesting({ ...requesting, reason: e.target.value })}
                placeholder="例：引っ越しのため"
              />
            </Field>
          </div>
        )}
      </Modal>
    </section>
  );
}
