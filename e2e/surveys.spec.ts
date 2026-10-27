import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers";

test.describe("アンケート", () => {
  test("人事が作成・配信し、社員が回答すると集計に反映される", async ({ page, browser }) => {
    const title = `E2E パルス ${Date.now()}`;
    await loginAs(page, "hr");
    await page.goto("/surveys");
    await page.getByRole("link", { name: "アンケートを作成" }).click();
    await page.getByRole("textbox", { name: "タイトル" }).fill(title);
    await page.getByRole("button", { name: "パルスサーベイのひな形" }).click();
    await expect(page.getByText("5問", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "作成する" }).first().click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);

    await page.getByRole("button", { name: "配信する" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "配信する" }).click();
    await expect(page.getByText(/名に配信しました/)).toBeVisible();
    await expect(page.getByRole("button", { name: "締め切る" })).toBeVisible();

    // 一般社員：ホームの「やること」から回答する
    const ctx = await browser.newContext({ locale: "ja-JP", timezoneId: "Asia/Tokyo" });
    const member = await ctx.newPage();
    await loginAs(member, "member");
    await member.getByRole("link", { name: new RegExp(`「${title}」に回答してください`) }).click();
    await expect(member.getByRole("heading", { level: 1 })).toContainText(title);
    // 未入力のまま送信すると必須エラーになる
    await member.getByRole("button", { name: "送信する" }).click();
    await expect(member.getByRole("alert").first()).toBeVisible();

    const groups = member.getByRole("group");
    await groups.nth(0).getByRole("radio", { name: "4" }).check({ force: true });
    await groups.nth(1).getByRole("radio", { name: "5（そう思う）" }).check({ force: true });
    await groups.nth(2).getByRole("radio", { name: "3" }).check({ force: true });
    await groups.nth(3).getByRole("radio", { name: "9" }).check({ force: true });
    await groups.nth(4).getByRole("textbox").fill("E2E からの回答です");
    await member.getByRole("button", { name: "送信する" }).click();
    await expect(member.getByText("回答を送信しました")).toBeVisible();
    await ctx.close();

    // 人事：回答数が 1 件になり、自由記述が匿名で表示される
    await page.reload();
    await expect(page.getByText("E2E からの回答です")).toBeVisible();
    await expect(page.getByText(/^1\s*件$/).first()).toBeVisible();
  });
});
