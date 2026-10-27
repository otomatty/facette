import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers";

test("未ログインならログイン画面へ移動し、ログイン後に元のページへ戻る", async ({ page }) => {
  await page.goto("/members");
  await expect(page).toHaveURL(/\/login\?next=%2Fmembers/);
  await page.getByLabel("メールアドレス").fill("hr@example.com");
  await page.getByLabel("パスワード").fill("facette-demo");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page).toHaveURL(/\/members$/);
  await expect(page.getByRole("heading", { name: "メンバー" })).toBeVisible();
});

test("誤ったパスワードではエラーを表示する", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("メールアドレス").fill("hr@example.com");
  await page.getByLabel("パスワード").fill("wrong-password");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("正しくありません");
});

test("ロールによってメニューが変わり、ログアウトできる", async ({ page }) => {
  await loginAs(page, "member");
  const nav = page.getByRole("navigation", { name: "メインメニュー" });
  await expect(nav.getByRole("link", { name: "メンバー" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "配置シミュレーション" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "管理設定" })).toHaveCount(0);
  await page.getByRole("button", { name: /一般社員/ }).click();
  await page.getByRole("menuitem", { name: "ログアウト" }).click();
  await expect(page).toHaveURL(/\/login/);
});
