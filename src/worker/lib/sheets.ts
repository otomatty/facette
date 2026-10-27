import type { AccessLevel, FieldType } from "../../shared/constants";
import { resolveSheetAccess } from "../../shared/permissions";
import type { FieldValue, Sheet, SheetField, SheetRecord } from "../../shared/types";
import { type AuthContext, memberInScope } from "./context";
import { all, parseJson } from "./db";

type SheetRow = {
  id: number;
  name: string;
  description: string;
  kind: "single" | "multi";
  sort_order: number;
  self_access: AccessLevel;
};
type FieldRow = {
  id: number;
  sheet_id: number;
  label: string;
  type: FieldType;
  options: string;
  required: number;
  help_text: string;
  sort_order: number;
};
type PermRow = { sheet_id: number; role: "hr" | "manager" | "member"; access: AccessLevel };

export type RecordRow = {
  id: number;
  sheet_id: number;
  member_id: number;
  data: string;
  sort_order: number;
  updated_at: string;
};

export function toField(r: FieldRow): SheetField {
  return {
    id: r.id,
    sheetId: r.sheet_id,
    label: r.label,
    type: r.type,
    options: parseJson<string[]>(r.options, []),
    required: r.required === 1,
    helpText: r.help_text,
    sortOrder: r.sort_order,
  };
}

export function toRecord(r: RecordRow): SheetRecord {
  return {
    id: r.id,
    sheetId: r.sheet_id,
    memberId: r.member_id,
    data: parseJson<Record<string, FieldValue>>(r.data, {}),
    sortOrder: r.sort_order,
    updatedAt: r.updated_at,
  };
}

export async function loadSheets(db: D1Database): Promise<Sheet[]> {
  const [sheets, fields, perms] = await Promise.all([
    all<SheetRow>(db, "SELECT * FROM sheets ORDER BY sort_order, id"),
    all<FieldRow>(db, "SELECT * FROM sheet_fields ORDER BY sort_order, id"),
    all<PermRow>(db, "SELECT * FROM sheet_permissions"),
  ]);
  return sheets.map((s) => {
    const p = { hr: "none", manager: "none", member: "none" } as Sheet["permissions"];
    for (const r of perms) if (r.sheet_id === s.id) p[r.role] = r.access;
    return {
      id: s.id,
      name: s.name,
      description: s.description,
      kind: s.kind,
      sortOrder: s.sort_order,
      selfAccess: s.self_access,
      permissions: p,
      fields: fields.filter((f) => f.sheet_id === s.id).map(toField),
    };
  });
}

export function sheetAccess(
  a: AuthContext,
  sheet: Sheet,
  member: { id: number; department_id: number | null },
): AccessLevel {
  return resolveSheetAccess({
    role: a.user.role,
    roleAccess: sheet.permissions,
    selfAccess: sheet.selfAccess,
    isSelf: a.user.memberId === member.id,
    inScope: memberInScope(a, member),
  });
}

/**
 * 管轄外の社員も含めて「全社員に対して」閲覧できるか。
 * 一覧の列表示や検索条件に使う。マネージャーの場合は範囲内のみ閲覧可（"scope"）。
 */
export function sheetVisibility(a: AuthContext, sheet: Sheet): "all" | "scope" | "none" {
  if (a.user.role === "admin") return "all";
  if (sheet.permissions.member !== "none") return "all";
  if (a.user.role === "hr" && sheet.permissions.hr !== "none") return "all";
  if (a.user.role === "manager" && sheet.permissions.manager !== "none") return "scope";
  return "none";
}

/** 全社員に対して編集できるか（CSV の一括取り込みに使う） */
export function sheetEditableForAll(a: AuthContext, sheet: Sheet): boolean {
  if (a.user.role === "admin") return true;
  return a.user.role === "hr" && sheet.permissions.hr === "edit";
}
