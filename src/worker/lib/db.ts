export type Bindable = string | number | null | ArrayBuffer | Uint8Array | boolean;

function norm(params: Bindable[]): (string | number | null | ArrayBuffer)[] {
  return params.map((p) => {
    if (typeof p === "boolean") return p ? 1 : 0;
    if (p instanceof Uint8Array)
      return p.buffer.slice(p.byteOffset, p.byteOffset + p.byteLength) as ArrayBuffer;
    if (p === undefined) return null;
    return p;
  });
}

export function stmt(db: D1Database, sql: string, ...params: Bindable[]): D1PreparedStatement {
  return db.prepare(sql).bind(...norm(params));
}

export async function all<T = Record<string, unknown>>(
  db: D1Database,
  sql: string,
  ...params: Bindable[]
): Promise<T[]> {
  const res = await stmt(db, sql, ...params).all<T>();
  return res.results ?? [];
}

export async function first<T = Record<string, unknown>>(
  db: D1Database,
  sql: string,
  ...params: Bindable[]
): Promise<T | null> {
  return (await stmt(db, sql, ...params).first<T>()) ?? null;
}

export async function run(db: D1Database, sql: string, ...params: Bindable[]): Promise<D1Result> {
  return stmt(db, sql, ...params).run();
}

/** INSERT を実行して採番された ID を返す */
export async function insert(db: D1Database, sql: string, ...params: Bindable[]): Promise<number> {
  const res = await run(db, sql, ...params);
  return Number(res.meta.last_row_id);
}

/** IN 句用のプレースホルダ "?,?,?" */
export function placeholders(n: number): string {
  return Array.from({ length: n }, () => "?").join(",");
}

export function parseJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

/** D1 の batch は1回あたりのステートメント数に制限があるため分割して実行 */
export async function batchChunks(
  db: D1Database,
  statements: D1PreparedStatement[],
  size = 80,
): Promise<void> {
  for (let i = 0; i < statements.length; i += size) {
    await db.batch(statements.slice(i, i + size));
  }
}

/**
 * ids の並びどおりに sort_order を 1 から振り直す。
 * 行数が多くてもクエリ 1 回で済むよう、並び順は JSON 配列で渡す。
 */
export async function reorderRows(
  db: D1Database,
  table: "sheets" | "sheet_fields" | "departments" | "dashboard_panels",
  ids: number[],
  scope?: { column: "sheet_id" | "user_id"; value: number },
): Promise<void> {
  if (!ids.length) return;
  const json = JSON.stringify(ids);
  await run(
    db,
    `UPDATE ${table} SET sort_order = (SELECT min(CAST(j.key AS INTEGER)) + 1 FROM json_each(?) j WHERE j.value = ${table}.id)
      WHERE id IN (SELECT value FROM json_each(?))${scope ? ` AND ${scope.column} = ?` : ""}`,
    json,
    json,
    ...(scope ? [scope.value] : []),
  );
}
