import { zValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import type { ZodType } from "zod";

/** zod でリクエストを検証し、失敗時は日本語のエラーメッセージで 400 を返す */
export function validate<T extends ZodType, Target extends keyof ValidationTargets>(
  target: Target,
  schema: T,
) {
  return zValidator(target, schema, (result, c) => {
    if (!result.success) {
      const issues = result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
      return c.json({ error: issues[0]?.message ?? "入力内容に誤りがあります", issues }, 400);
    }
  });
}
