import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import type { AppEnv } from "./lib/context";
import { sessionMiddleware } from "./lib/session";
import { authRoutes } from "./routes/auth";
import { masterRoutes } from "./routes/masters";
import { memberRoutes } from "./routes/members";
import { sheetRoutes } from "./routes/sheets";

const app = new Hono<AppEnv>().basePath("/api");

app.use(secureHeaders({ crossOriginResourcePolicy: "same-origin" }));

// CSRF 対策: 状態を変更するリクエストは同一オリジンからのみ受け付ける
app.use(async (c, next) => {
  const method = c.req.method;
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    const origin = c.req.header("origin");
    const self = new URL(c.req.url).origin;
    if (origin && origin !== self) {
      return c.json({ error: "許可されていない送信元からのリクエストです" }, 403);
    }
    const ct = c.req.header("content-type") ?? "";
    if (/application\/x-www-form-urlencoded|multipart\/form-data|text\/plain/i.test(ct)) {
      return c.json({ error: "サポートされていない形式です" }, 415);
    }
  }
  await next();
});

app.use(sessionMiddleware);

app.get("/health", (c) => c.json({ ok: true }));

app.route("/auth", authRoutes);
app.route("/masters", masterRoutes);
app.route("/members", memberRoutes);
app.route("/sheets", sheetRoutes);

app.notFound((c) => c.json({ error: "API が見つかりません" }, 404));

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message || "エラーが発生しました" }, err.status);
  }
  console.error(err);
  return c.json({ error: "サーバーでエラーが発生しました。時間をおいて再度お試しください" }, 500);
});

export default app;
