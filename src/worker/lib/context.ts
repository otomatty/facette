import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import type { Role } from "../../shared/constants";
import { type Capabilities, capabilitiesFor } from "../../shared/permissions";
import type { Auth } from "./auth";
import { all } from "./db";

export type AuthUser = {
  id: number;
  email: string;
  displayName: string;
  role: Role;
  memberId: number | null;
  isDemo: boolean;
};

export type DeptRow = {
  id: number;
  name: string;
  parent_id: number | null;
  sort_order: number;
  code: string | null;
};

export type AuthContext = {
  user: AuthUser;
  caps: Capabilities;
  /** 閲覧者本人の部署 ID */
  memberDepartmentId: number | null;
  /** 管轄範囲。all=true なら全社。それ以外は departmentIds に含まれる部署の社員と本人 */
  scope: { all: boolean; departmentIds: Set<number> };
};

export type AppEnv = {
  Bindings: Env;
  Variables: { auth: AuthContext | null; betterAuth?: Auth; departments?: DeptRow[] };
};

export type AppContext = Context<AppEnv>;

export async function loadDepartments(c: AppContext): Promise<DeptRow[]> {
  const cached = c.get("departments");
  if (cached) return cached;
  const rows = await all<DeptRow>(
    c.env.DB,
    "SELECT id, name, parent_id, sort_order, code FROM departments ORDER BY sort_order, id",
  );
  c.set("departments", rows);
  return rows;
}

/** 部署とその配下の部署 ID 一覧 */
export function subtreeIds(departments: DeptRow[], rootId: number): number[] {
  const children = new Map<number, number[]>();
  for (const d of departments) {
    if (d.parent_id === null) continue;
    const list = children.get(d.parent_id) ?? [];
    list.push(d.id);
    children.set(d.parent_id, list);
  }
  const out: number[] = [];
  const stack = [rootId];
  const seen = new Set<number>();
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    for (const ch of children.get(id) ?? []) stack.push(ch);
  }
  return out;
}

/** ルートから部署までのパス */
export function departmentPath(departments: DeptRow[], id: number | null): { id: number; name: string }[] {
  const byId = new Map(departments.map((d) => [d.id, d]));
  const path: { id: number; name: string }[] = [];
  let cur = id === null ? undefined : byId.get(id);
  const seen = new Set<number>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    path.unshift({ id: cur.id, name: cur.name });
    cur = cur.parent_id === null ? undefined : byId.get(cur.parent_id);
  }
  return path;
}

export async function buildAuthContext(c: AppContext, user: AuthUser): Promise<AuthContext> {
  const caps = capabilitiesFor(user.role);
  let memberDepartmentId: number | null = null;
  if (user.memberId) {
    const rows = await all<{ department_id: number | null }>(
      c.env.DB,
      "SELECT department_id FROM members WHERE id = ?",
      user.memberId,
    );
    memberDepartmentId = rows[0]?.department_id ?? null;
  }
  const all_ = user.role === "admin" || user.role === "hr";
  const departmentIds = new Set<number>();
  if (user.role === "manager" && memberDepartmentId !== null) {
    const depts = await loadDepartments(c);
    for (const id of subtreeIds(depts, memberDepartmentId)) departmentIds.add(id);
  }
  return { user, caps, memberDepartmentId, scope: { all: all_, departmentIds } };
}

export function auth(c: AppContext): AuthContext {
  const a = c.get("auth");
  if (!a) throw new HTTPException(401, { message: "ログインしてください" });
  return a;
}

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  auth(c);
  await next();
});

export function requireCap(cap: keyof Capabilities) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const a = auth(c);
    if (!a.caps[cap]) throw new HTTPException(403, { message: "この操作を行う権限がありません" });
    await next();
  });
}

export function forbid(message = "この操作を行う権限がありません"): never {
  throw new HTTPException(403, { message });
}

export function notFound(message = "対象が見つかりません"): never {
  throw new HTTPException(404, { message });
}

export function badRequest(message: string): never {
  throw new HTTPException(400, { message });
}

/** 社員が閲覧者の管轄範囲内か（本人は常に範囲内） */
export function memberInScope(a: AuthContext, member: { id: number; department_id: number | null }): boolean {
  if (a.scope.all) return true;
  if (a.user.memberId === member.id) return true;
  return member.department_id !== null && a.scope.departmentIds.has(member.department_id);
}

export function parseId(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) notFound();
  return n;
}
