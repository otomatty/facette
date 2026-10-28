import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers";

test("未ログインならログイン画面へ移動し、ログイン後に元のページへ戻る", async ({ page }) => {
  await page.goto("/members");
  await expect(page).toHaveURL(/\/login\?next=%2Fmembers/);
  await page.getByRole("button", { name: /人事担当/ }).click();
  await expect(page).toHaveURL(/\/members$/);
  await expect(page.getByRole("heading", { name: "メンバー" })).toBeVisible();
});

test("Google でログインを押すと、Google の認可画面へ移動する", async ({ page }) => {
  // 外部へは出ず、Google へのリクエストが送られることだけを確かめる
  await page.route("https://accounts.google.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<p>Google</p>" }),
  );
  await page.goto("/login?next=%2Fsurveys");
  const request = page.waitForRequest(/^https:\/\/accounts\.google\.com\//);
  await page.getByRole("button", { name: "Google でログイン" }).click();
  const url = new URL((await request).url());
  expect(url.searchParams.get("redirect_uri")).toMatch(/\/api\/auth\/callback\/google$/);
});

test("登録されていない Google アカウントで戻ってきたときはエラーを表示する", async ({ page }) => {
  await page.goto("/login?error=signup_disabled");
  await expect(page.getByRole("alert")).toContainText("登録されていません");
  await expect(page.getByLabel("パスワード")).toHaveCount(0);
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
