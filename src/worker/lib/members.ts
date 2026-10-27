import type { Gender, MemberStatus } from "../../shared/constants";
import { canViewSensitive } from "../../shared/permissions";
import type { MemberSummary } from "../../shared/types";
import { type AuthContext, memberInScope } from "./context";
import { all, first, placeholders } from "./db";

export type MemberRow = {
  id: number;
  employee_code: string;
  last_name: string;
  first_name: string;
  last_name_kana: string;
  first_name_kana: string;
  email: string | null;
  gender: Gender;
  birth_date: string | null;
  hire_date: string | null;
  leave_date: string | null;
  status: MemberStatus;
  department_id: number | null;
  job_title_id: number | null;
  grade_id: number | null;
  employment_type_id: number | null;
  phone: string | null;
  work_location: string | null;
  bio: string;
  photo_updated_at: string | null;
  avatar_seed: number;
  department_name: string | null;
  job_title_name: string | null;
  grade_name: string | null;
  employment_type_name: string | null;
  created_at: string;
  updated_at: string;
};

export const MEMBER_SELECT = `
  SELECT m.*, d.name AS department_name, jt.name AS job_title_name, g.name AS grade_name,
         et.name AS employment_type_name
    FROM members m
    LEFT JOIN departments d ON d.id = m.department_id
    LEFT JOIN job_titles jt ON jt.id = m.job_title_id
    LEFT JOIN grades g ON g.id = m.grade_id
    LEFT JOIN employment_types et ON et.id = m.employment_type_id`;

export function photoUrl(row: Pick<MemberRow, "id" | "photo_updated_at">): string | null {
  if (!row.photo_updated_at) return null;
  return `/api/members/${row.id}/photo?v=${encodeURIComponent(row.photo_updated_at)}`;
}

export function toSummary(a: AuthContext, row: MemberRow): MemberSummary {
  const isSelf = a.user.memberId === row.id;
  const sensitive = canViewSensitive(a.user.role, isSelf, memberInScope(a, row));
  return {
    id: row.id,
    employeeCode: row.employee_code,
    lastName: row.last_name,
    firstName: row.first_name,
    lastNameKana: row.last_name_kana,
    firstNameKana: row.first_name_kana,
    departmentId: row.department_id,
    departmentName: row.department_name,
    jobTitleId: row.job_title_id,
    jobTitleName: row.job_title_name,
    status: row.status,
    hireDate: row.hire_date,
    workLocation: row.work_location,
    photoUrl: photoUrl(row),
    avatarSeed: row.avatar_seed,
    gender: sensitive ? row.gender : null,
    gradeId: sensitive ? row.grade_id : null,
    gradeName: sensitive ? row.grade_name : null,
    employmentTypeId: sensitive ? row.employment_type_id : null,
    employmentTypeName: sensitive ? row.employment_type_name : null,
    birthDate: sensitive ? row.birth_date : null,
  };
}

export async function getMemberRow(db: D1Database, id: number): Promise<MemberRow | null> {
  return first<MemberRow>(db, `${MEMBER_SELECT} WHERE m.id = ?`, id);
}

/** 複数社員をまとめて取得して id → summary の Map にする */
export async function summariesByIds(
  db: D1Database,
  a: AuthContext,
  ids: (number | null | undefined)[],
): Promise<Map<number, MemberSummary>> {
  const unique = [...new Set(ids.filter((x): x is number => typeof x === "number"))];
  const map = new Map<number, MemberSummary>();
  for (let i = 0; i < unique.length; i += 90) {
    const chunk = unique.slice(i, i + 90);
    const rows = await all<MemberRow>(
      db,
      `${MEMBER_SELECT} WHERE m.id IN (${placeholders(chunk.length)})`,
      ...chunk,
    );
    for (const r of rows) map.set(r.id, toSummary(a, r));
  }
  return map;
}
