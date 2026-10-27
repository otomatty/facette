import { expect, type Page } from "@playwright/test";

export const ROLES = {
  admin: "システム管理者",
  hr: "人事担当",
  manager: "マネージャー",
  member: "一般社員",
} as const;

/** ログイン画面のデモアカウントからログインする */
export async function loginAs(page: Page, role: keyof typeof ROLES) {
  await page.goto("/login");
  await page.getByRole("button", { name: new RegExp(ROLES[role]) }).click();
  await expect(page.getByRole("navigation", { name: "メインメニュー" })).toBeVisible();
}
