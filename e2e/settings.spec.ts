import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers";

test.describe("管理設定", () => {
  test("人事が投稿したお知らせが一般社員のホームに表示される", async ({ page, browser }) => {
    const title = `E2E お知らせ ${Date.now()}`;
    await loginAs(page, "hr");
    await page.goto("/settings/announcements");
    await page.getByRole("button", { name: "お知らせを投稿" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox", { name: "タイトル" }).fill(title);
    await dialog.getByRole("textbox", { name: "本文" }).fill("E2E テストから投稿しました。");
    await dialog.getByRole("button", { name: "投稿する" }).click();
    await expect(page.getByText(title)).toBeVisible();

    const ctx = await browser.newContext({ locale: "ja-JP", timezoneId: "Asia/Tokyo" });
    const member = await ctx.newPage();
    await loginAs(member, "member");
    await expect(member.getByText(title)).toBeVisible();
    await ctx.close();

    // 後片付け
    await page.getByRole("button", { name: `「${title}」を削除` }).click();
    await page.getByRole("dialog").getByRole("button", { name: "削除" }).click();
    await expect(page.getByText(title)).toHaveCount(0);
  });

  test("人事には権限のある設定だけが表示され、一般社員は管理設定を使えない", async ({ page }) => {
    await loginAs(page, "hr");
    await page.goto("/settings/users");
    // ユーザー管理の権限がないため、見られるタブへ移動する
    await expect(page).not.toHaveURL(/\/settings\/users/);
    await expect(page.getByRole("link", { name: /ユーザー/ })).toHaveCount(0);

    await loginAs(page, "member");
    await expect(page.getByRole("link", { name: "管理設定" })).toHaveCount(0);
  });
});
