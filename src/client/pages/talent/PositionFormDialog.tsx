import { useMutation } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { SKILL_LEVEL_LABELS } from "../../../shared/constants";
import type { JobPosition } from "../../../shared/types";
import { DepartmentSelect } from "../../components/pickers";
import {
  Button,
  Field,
  IconButton,
  Input,
  Modal,
  Segmented,
  Select,
  Textarea,
  useToast,
} from "../../components/ui";
import { errorMessage, patch, post } from "../../lib/api";
import { queryClient, useSkills } from "../../lib/queries";

type Requirement = { key: number; skillId: number | null; minLevel: number; weight: number };

type PositionForm = {
  name: string;
  departmentId: number | null;
  mission: string;
  description: string;
  headcount: string;
  status: "open" | "closed";
  requirements: Requirement[];
};

let nextKey = 1;

/** ポジションの作成・編集ダイアログ */
export function PositionFormDialog({
  open,
  onClose,
  position,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  position?: JobPosition;
  onSaved?: (id: number) => void;
}) {
  const toast = useToast();
  const skills = useSkills();
  const [form, setForm] = useState<PositionForm>(() => ({
    name: position?.name ?? "",
    departmentId: position?.departmentId ?? null,
    mission: position?.mission ?? "",
    description: position?.description ?? "",
    headcount: String(position?.headcount ?? 1),
    status: position?.status ?? "open",
    requirements: (position?.requirements ?? []).map((r) => ({
      key: nextKey++,
      skillId: r.skillId,
      minLevel: r.minLevel,
      weight: r.weight,
    })),
  }));
  const [touched, setTouched] = useState(false);

  const categories = useMemo(() => {
    const g = new Map<string, { id: number; name: string }[]>();
    for (const s of skills.data ?? []) g.set(s.category, [...(g.get(s.category) ?? []), s]);
    return [...g.entries()];
  }, [skills.data]);

  const headcount = Number(form.headcount);
  const errors = {
    name: !form.name.trim() ? "ポジション名を入力してください" : null,
    headcount:
      !Number.isInteger(headcount) || headcount < 1 || headcount > 999
        ? "人数は1〜999の整数で入力してください"
        : null,
    requirements: form.requirements.some((r) => r.skillId === null)
      ? "必要スキルのスキルを選んでください"
      : new Set(form.requirements.map((r) => r.skillId)).size !== form.requirements.length
        ? "同じスキルが重複しています"
        : null,
  };
  const hasError = Object.values(errors).some(Boolean);

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name: form.name.trim(),
        departmentId: form.departmentId,
        mission: form.mission.trim(),
        description: form.description.trim(),
        headcount,
        status: form.status,
        requirements: form.requirements.map((r) => ({
          skillId: r.skillId!,
          minLevel: r.minLevel,
          weight: r.weight,
        })),
      };
      if (position) {
        await patch(`/positions/${position.id}`, body);
        return position.id;
      }
      return (await post<{ id: number }>("/positions", body)).id;
    },
    onSuccess: (id) => {
      queryClient.invalidateQueries({ queryKey: ["positions"] });
      queryClient.invalidateQueries({ queryKey: ["position", id] });
      toast(position ? "ポジションを保存しました" : "ポジションを作成しました");
      onClose();
      onSaved?.(id);
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });

  const setReq = (key: number, patchValue: Partial<Requirement>) =>
    setForm({
      ...form,
      requirements: form.requirements.map((r) => (r.key === key ? { ...r, ...patchValue } : r)),
    });

  const usedIds = form.requirements.map((r) => r.skillId);
  const show = (e: string | null) => (touched ? e : null);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={position ? "ポジションを編集" : "ポジションを作成"}
      footer={
        <>
          <Button onClick={onClose}>キャンセル</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            onClick={() => {
              setTouched(true);
              if (!hasError) save.mutate();
            }}
          >
            {position ? "保存" : "作成"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="ポジション名"
          required
          htmlFor="pos-name"
          error={show(errors.name)}
          className="sm:col-span-2"
        >
          <Input
            id="pos-name"
            value={form.name}
            maxLength={60}
            aria-invalid={show(errors.name) ? true : undefined}
            placeholder="例：テックリード"
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            autoFocus
          />
        </Field>
        <Field label="部署" htmlFor="pos-dept">
          <DepartmentSelect
            id="pos-dept"
            value={form.departmentId}
            onChange={(v) => setForm({ ...form, departmentId: v })}
            placeholder="指定しない"
          />
        </Field>
        <div className="grid grid-cols-[120px_1fr] gap-4">
          <Field label="人数" required htmlFor="pos-headcount" error={show(errors.headcount)}>
            <Input
              id="pos-headcount"
              type="number"
              inputMode="numeric"
              min={1}
              max={999}
              value={form.headcount}
              aria-invalid={show(errors.headcount) ? true : undefined}
              onChange={(e) => setForm({ ...form, headcount: e.target.value })}
            />
          </Field>
          <Field label="状態">
            <div className="pt-0.5">
              <Segmented
                label="状態"
                value={form.status}
                onChange={(v) => setForm({ ...form, status: v })}
                options={[
                  { value: "open", label: "募集中" },
                  { value: "closed", label: "募集終了" },
                ]}
              />
            </div>
          </Field>
        </div>
        <Field
          label="ミッション"
          htmlFor="pos-mission"
          className="sm:col-span-2"
          help="このポジションで達成してほしいこと"
        >
          <Textarea
            id="pos-mission"
            rows={2}
            maxLength={400}
            value={form.mission}
            onChange={(e) => setForm({ ...form, mission: e.target.value })}
          />
        </Field>
        <Field label="職務内容" htmlFor="pos-desc" className="sm:col-span-2">
          <Textarea
            id="pos-desc"
            rows={4}
            maxLength={4000}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </Field>

        <fieldset className="sm:col-span-2">
          <legend className="mb-1.5 text-[13px] font-bold text-ink-2">必要スキル</legend>
          <p className="mb-2 text-xs text-ink-3">
            候補者のマッチ度は、必要レベルに対する保有レベルの充足度を重みで平均して求めます。重みが大きいスキルほど重視されます。
          </p>
          {form.requirements.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead className="text-left text-xs text-ink-3">
                  <tr>
                    <th className="pb-1 font-normal">スキル</th>
                    <th className="w-44 pb-1 pl-2 font-normal">必要レベル</th>
                    <th className="w-24 pb-1 pl-2 font-normal">重み</th>
                    <th className="w-9" />
                  </tr>
                </thead>
                <tbody>
                  {form.requirements.map((r, i) => (
                    <tr key={r.key}>
                      <td className="py-1">
                        <Select
                          aria-label={`${i + 1}行目のスキル`}
                          value={r.skillId ?? ""}
                          aria-invalid={touched && r.skillId === null ? true : undefined}
                          onChange={(e) =>
                            setReq(r.key, { skillId: e.target.value ? Number(e.target.value) : null })
                          }
                        >
                          <option value="">スキルを選択</option>
                          {categories.map(([cat, list]) => (
                            <optgroup key={cat} label={cat}>
                              {list.map((s) => (
                                <option
                                  key={s.id}
                                  value={s.id}
                                  disabled={s.id !== r.skillId && usedIds.includes(s.id)}
                                >
                                  {s.name}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </Select>
                      </td>
                      <td className="py-1 pl-2">
                        <Select
                          aria-label={`${i + 1}行目の必要レベル`}
                          value={r.minLevel}
                          onChange={(e) => setReq(r.key, { minLevel: Number(e.target.value) })}
                        >
                          {[1, 2, 3, 4, 5].map((n) => (
                            <option key={n} value={n}>
                              Lv{n} {SKILL_LEVEL_LABELS[n]}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="py-1 pl-2">
                        <Select
                          aria-label={`${i + 1}行目の重み`}
                          value={r.weight}
                          onChange={(e) => setReq(r.key, { weight: Number(e.target.value) })}
                        >
                          {[1, 2, 3, 4, 5].map((n) => (
                            <option key={n} value={n}>
                              {n}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="py-1 pl-1 text-right">
                        <IconButton
                          label={`${i + 1}行目を削除`}
                          onClick={() =>
                            setForm({
                              ...form,
                              requirements: form.requirements.filter((x) => x.key !== r.key),
                            })
                          }
                        >
                          <Trash2 className="size-4" />
                        </IconButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {show(errors.requirements) && (
            <p className="mt-1 text-xs text-beni" role="alert">
              {errors.requirements}
            </p>
          )}
          <Button
            size="sm"
            className="mt-2"
            icon={<Plus className="size-3.5" />}
            disabled={form.requirements.length >= 30}
            onClick={() =>
              setForm({
                ...form,
                requirements: [
                  ...form.requirements,
                  { key: nextKey++, skillId: null, minLevel: 3, weight: 1 },
                ],
              })
            }
          >
            必要スキルを追加
          </Button>
        </fieldset>
      </div>
    </Modal>
  );
}
