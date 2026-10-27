import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";
import {
  GENDER_LABELS,
  type Gender,
  MEMBER_STATUS_LABELS,
  type MemberStatus,
} from "../../../shared/constants";
import type { MemberDetail, MemberSummary } from "../../../shared/types";
import { DepartmentSelect } from "../../components/pickers";
import { Button, Field, Input, Modal, Select, Textarea, useToast } from "../../components/ui";
import { errorMessage, patch, post } from "../../lib/api";
import { queryClient, useMasters } from "../../lib/queries";

type Form = {
  employeeCode: string;
  lastName: string;
  firstName: string;
  lastNameKana: string;
  firstNameKana: string;
  email: string;
  gender: Gender;
  birthDate: string;
  hireDate: string;
  leaveDate: string;
  status: MemberStatus;
  departmentId: number | null;
  jobTitleId: number | null;
  gradeId: number | null;
  employmentTypeId: number | null;
  phone: string;
  workLocation: string;
  bio: string;
};

function fromMember(m?: MemberDetail): Form {
  return {
    employeeCode: m?.employeeCode ?? "",
    lastName: m?.lastName ?? "",
    firstName: m?.firstName ?? "",
    lastNameKana: m?.lastNameKana ?? "",
    firstNameKana: m?.firstNameKana ?? "",
    email: m?.email ?? "",
    gender: m?.gender ?? "unknown",
    birthDate: m?.birthDate ?? "",
    hireDate: m?.hireDate ?? "",
    leaveDate: m?.leaveDate ?? "",
    status: m?.status ?? "active",
    departmentId: m?.departmentId ?? null,
    jobTitleId: m?.jobTitleId ?? null,
    gradeId: m?.gradeId ?? null,
    employmentTypeId: m?.employmentTypeId ?? null,
    phone: m?.phone ?? "",
    workLocation: m?.workLocation ?? "",
    bio: m?.bio ?? "",
  };
}

export function MemberFormDialog({
  open,
  onClose,
  member,
}: {
  open: boolean;
  onClose: () => void;
  member?: MemberDetail;
}) {
  const [form, setForm] = useState<Form>(() => fromMember(member));
  const masters = useMasters();
  const toast = useToast();
  const navigate = useNavigate();
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const save = useMutation({
    mutationFn: () =>
      member ? patch<MemberDetail>(`/members/${member.id}`, form) : post<MemberSummary>("/members", form),
    onSuccess: (m) => {
      queryClient.invalidateQueries({ queryKey: ["members"] });
      queryClient.invalidateQueries({ queryKey: ["member", m.id] });
      queryClient.invalidateQueries({ queryKey: ["masters"] });
      toast(member ? "基本情報を保存しました" : `${m.lastName} ${m.firstName}さんを登録しました`);
      onClose();
      if (!member) navigate(`/members/${m.id}`);
    },
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={member ? "基本情報を編集" : "社員を追加"}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>キャンセル</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            {member ? "保存" : "登録"}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
        className="grid gap-4 sm:grid-cols-2"
      >
        {save.error && (
          <p className="rounded-md bg-beni-100 px-3 py-2 text-sm text-beni sm:col-span-2" role="alert">
            {errorMessage(save.error)}
          </p>
        )}
        <Field label="社員番号" required htmlFor="f-code">
          <Input
            id="f-code"
            value={form.employeeCode}
            onChange={(e) => set("employeeCode", e.target.value)}
          />
        </Field>
        <Field label="メールアドレス" htmlFor="f-email">
          <Input
            id="f-email"
            type="email"
            value={form.email}
            onChange={(e) => set("email", e.target.value)}
          />
        </Field>
        <Field label="姓" required htmlFor="f-last">
          <Input id="f-last" value={form.lastName} onChange={(e) => set("lastName", e.target.value)} />
        </Field>
        <Field label="名" required htmlFor="f-first">
          <Input id="f-first" value={form.firstName} onChange={(e) => set("firstName", e.target.value)} />
        </Field>
        <Field label="姓（かな）" htmlFor="f-lastk">
          <Input
            id="f-lastk"
            value={form.lastNameKana}
            onChange={(e) => set("lastNameKana", e.target.value)}
          />
        </Field>
        <Field label="名（かな）" htmlFor="f-firstk">
          <Input
            id="f-firstk"
            value={form.firstNameKana}
            onChange={(e) => set("firstNameKana", e.target.value)}
          />
        </Field>
        <Field label="部署" htmlFor="f-dept">
          <DepartmentSelect
            id="f-dept"
            value={form.departmentId}
            onChange={(v) => set("departmentId", v)}
            placeholder="未所属"
          />
        </Field>
        <Field label="役職" htmlFor="f-jt">
          <Select
            id="f-jt"
            value={form.jobTitleId ?? ""}
            onChange={(e) => set("jobTitleId", e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">未設定</option>
            {masters.data?.jobTitles.map((j) => (
              <option key={j.id} value={j.id}>
                {j.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="等級" htmlFor="f-grade">
          <Select
            id="f-grade"
            value={form.gradeId ?? ""}
            onChange={(e) => set("gradeId", e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">未設定</option>
            {masters.data?.grades.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="雇用形態" htmlFor="f-et">
          <Select
            id="f-et"
            value={form.employmentTypeId ?? ""}
            onChange={(e) => set("employmentTypeId", e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">未設定</option>
            {masters.data?.employmentTypes.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="性別" htmlFor="f-gender">
          <Select id="f-gender" value={form.gender} onChange={(e) => set("gender", e.target.value as Gender)}>
            {Object.entries(GENDER_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="生年月日" htmlFor="f-birth">
          <Input
            id="f-birth"
            type="date"
            value={form.birthDate}
            onChange={(e) => set("birthDate", e.target.value)}
          />
        </Field>
        <Field label="入社日" htmlFor="f-hire">
          <Input
            id="f-hire"
            type="date"
            value={form.hireDate}
            onChange={(e) => set("hireDate", e.target.value)}
          />
        </Field>
        <Field label="在籍状況" htmlFor="f-status">
          <Select
            id="f-status"
            value={form.status}
            onChange={(e) => set("status", e.target.value as MemberStatus)}
          >
            {Object.entries(MEMBER_STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        {form.status === "retired" && (
          <Field label="退職日" htmlFor="f-leave">
            <Input
              id="f-leave"
              type="date"
              value={form.leaveDate}
              onChange={(e) => set("leaveDate", e.target.value)}
            />
          </Field>
        )}
        <Field label="勤務地" htmlFor="f-loc">
          <Input id="f-loc" value={form.workLocation} onChange={(e) => set("workLocation", e.target.value)} />
        </Field>
        <Field label="電話番号" htmlFor="f-phone">
          <Input id="f-phone" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
        </Field>
        <Field label="ひとこと" htmlFor="f-bio" className="sm:col-span-2">
          <Textarea id="f-bio" rows={3} value={form.bio} onChange={(e) => set("bio", e.target.value)} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
