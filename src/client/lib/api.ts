export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public fieldErrors?: Record<string, string>,
  ) {
    super(message);
  }
}

type Options = { method?: string; json?: unknown; body?: BodyInit; headers?: Record<string, string> };

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

export async function api<T>(path: string, opts: Options = {}): Promise<T> {
  const headers: Record<string, string> = { ...opts.headers };
  let body = opts.body;
  if (opts.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.json);
  }
  const res = await fetch(`/api${path}`, {
    method: opts.method ?? (body ? "POST" : "GET"),
    headers,
    body,
    credentials: "same-origin",
  });
  if (res.status === 401 && !path.startsWith("/auth/login")) onUnauthorized?.();
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const err = (data ?? {}) as { error?: string; fieldErrors?: Record<string, string> };
    throw new ApiError(res.status, err.error ?? `エラーが発生しました（${res.status}）`, err.fieldErrors);
  }
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const get = <T>(path: string) => api<T>(path);
export const post = <T>(path: string, json?: unknown) => api<T>(path, { method: "POST", json: json ?? {} });
export const put = <T>(path: string, json?: unknown) => api<T>(path, { method: "PUT", json: json ?? {} });
export const patch = <T>(path: string, json?: unknown) => api<T>(path, { method: "PATCH", json: json ?? {} });
export const del = <T>(path: string) => api<T>(path, { method: "DELETE" });

export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return "エラーが発生しました";
}

/** ファイルとしてダウンロードさせる */
export function downloadText(filename: string, text: string, mime = "text/csv;charset=utf-8") {
  const BOM = String.fromCharCode(0xfeff);
  const blob = new Blob([mime.startsWith("text/csv") ? `${BOM}${text}` : text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  // すぐに消すとブラウザによってはファイル名が反映されないため、少し待ってから片付ける
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 2000);
}
