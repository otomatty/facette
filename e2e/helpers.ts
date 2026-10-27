import { expect, type Page } from "@playwright/test";

export const ROLES = {
  admin: "システム管理者",
  hr: "人事担当",
  manager: "マネージャー",
  member: "一般社員",
} as const;

/** ログイン画面のデモアカウントからログインする */
export async function loginAs(page: Page, role: keyof typeof ROLES) {
  // ログイン済みだとログイン画面がホームへ移動するため、いったんセッションを消す
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByRole("button", { name: new RegExp(ROLES[role]) }).click();
  // スマートフォン幅ではメニューが折りたたまれるため、画面の切り替わりで判定する
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
}
