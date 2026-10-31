import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LoginOptions } from "../../shared/types";
import { queryClient } from "../lib/queries";
import { LoginPage } from "./LoginPage";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** ログインしていない状態で、ログイン画面の表示に使う情報だけを返す */
function renderLogin(options: LoginOptions) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith("/api/auth/login-options")) return json(options);
    return json({ error: "ログインしてください" }, 401);
  });
  const router = createMemoryRouter([{ path: "/login", element: <LoginPage /> }], {
    initialEntries: ["/login"],
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.restoreAllMocks();
});

describe("ログイン画面", () => {
  it("本番では Google ログインと、デモ用サイトへのリンクだけを出す", async () => {
    renderLogin({
      google: true,
      demoMode: false,
      demoAccounts: [],
      demoUrl: "https://demo.facette.saedgewell.com",
    });
    const link = await screen.findByRole("link", { name: /デモモードで利用する/ });
    expect(link.getAttribute("href")).toBe("https://demo.facette.saedgewell.com");
    expect(screen.getByRole("button", { name: "Google でログイン" })).toBeTruthy();
    expect(screen.queryByText("デモアカウントで試す")).toBeNull();
  });

  it("デモ用サイトではデモアカウントの一覧だけを出す", async () => {
    renderLogin({
      google: false,
      demoMode: true,
      demoAccounts: [
        {
          id: 1,
          email: "admin@example.com",
          displayName: "管理 一郎",
          role: "admin",
          memberId: null,
          avatarSeed: null,
          subtitle: null,
        },
      ],
      demoUrl: null,
    });
    expect(await screen.findByRole("button", { name: /システム管理者/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Google でログイン" })).toBeNull();
    expect(screen.queryByRole("link", { name: /デモモードで利用する/ })).toBeNull();
  });

  it("ローカル開発で Google を設定していれば、デモアカウントと並べて Google ログインも出す", async () => {
    renderLogin({ google: true, demoMode: true, demoAccounts: [], demoUrl: null });
    expect(await screen.findByRole("button", { name: "Google でログイン" })).toBeTruthy();
  });
});
