import type { AppContext } from "./context";
import { run } from "./db";

/** 操作ログを記録する（失敗しても本処理は止めない） */
export async function audit(
  c: AppContext,
  action: string,
  summary: string,
  target?: { type: string; id?: number | null },
): Promise<void> {
  const a = c.get("auth");
  try {
    await run(
      c.env.DB,
      "INSERT INTO audit_logs (user_id, user_name, action, target_type, target_id, summary, ip) VALUES (?, ?, ?, ?, ?, ?, ?)",
      a?.user.id ?? null,
      a?.user.displayName ?? "",
      action,
      target?.type ?? "",
      target?.id ?? null,
      summary.slice(0, 500),
      c.req.header("cf-connecting-ip") ?? null,
    );
  } catch (e) {
    console.error("audit log failed", e);
  }
}
