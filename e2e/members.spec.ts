import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers";

test.describe("人材データベース", () => {
  test("顔一覧で検索・部署で絞り込み、プロフィールを開ける", async ({ page }) => {
    await loginAs(page, "hr");
    await page.getByRole("navigation", { name: "メインメニュー" }).getByRole("link", { name: "メンバー" }).click();
    const count = page.locator("p[aria-live]").locator("span").first();
    await expect(count).not.toHaveText("—");
    const all = Number(await count.textContent());
    expect(all).toBeGreaterThan(100);

    await page.getByRole("combobox").filter({ hasText: "すべての部署" }).selectOption({ label: "　　人事部" });
    await expect.poll(async () => Number(await count.textContent())).toBeLessThan(20);
    const first = page.locator("ul li a[aria-label]").first();
    const name = await first.getAttribute("aria-label");
    await first.click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(name!.split(" ")[0]!);
    await expect(page.getByRole("tab", { name: "タレント評価" })).toBeVisible();
  });

  test("リスト表示に切り替えてシートの項目を列に追加できる", async ({ page }) => {
    await loginAs(page, "hr");
    await page.goto("/members?view=list");
    await page.getByRole("button", { name: "表示項目" }).click();
    await page.getByRole("dialog").getByLabel("パフォーマンス").check();
    await page.getByRole("dialog").getByRole("button", { name: "閉じる" }).first().click();
    await expect(page.getByRole("columnheader", { name: "パフォーマンス" })).toBeVisible();
  });

  test("グローバル検索から社員のプロフィールへ移動できる", async ({ page }) => {
    await loginAs(page, "member");
    await page.getByRole("combobox", { name: "社員を検索" }).fill("やま");
    const option = page.getByRole("option").first();
    await expect(option).toBeVisible();
    await option.click();
    await expect(page).toHaveURL(/\/members\/\d+/);
  });

  test("一般社員は自分のシートを編集でき、他人の機微情報は見えない", async ({ page }) => {
    await loginAs(page, "member");
    await page.getByRole("button", { name: /一般社員/ }).click();
    await page.getByRole("menuitem", { name: "自分のプロフィール" }).click();
    await expect(page.getByText("生年月日")).toBeVisible();
    await page.getByRole("tab", { name: "自己紹介" }).click();
    await page.getByRole("button", { name: "編集" }).click();
    await page.getByRole("dialog").getByLabel("趣味").fill("自転車で遠出すること");
    await page.getByRole("dialog").getByRole("button", { name: "保存" }).click();
    await expect(page.getByText("自転車で遠出すること")).toBeVisible();
    await expect(page.getByRole("tab", { name: "タレント評価" })).toHaveCount(0);

    // 他人のプロフィールでは生年月日が表示されない
    await page.goto("/members?q=e01010");
    await page.locator("ul li a[aria-label]").first().click();
    await expect(page.getByText("入社日")).toBeVisible();
    await expect(page.getByText("生年月日")).toHaveCount(0);
  });

  test("人事は社員を追加できる", async ({ page }) => {
    await loginAs(page, "hr");
    await page.goto("/members");
    await page.getByRole("button", { name: "社員を追加" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox", { name: "社員番号" }).fill("E99999");
    await dialog.getByRole("textbox", { name: "姓", exact: true }).fill("試験");
    await dialog.getByRole("textbox", { name: "名", exact: true }).fill("一郎");
    await dialog.getByRole("combobox", { name: "部署" }).selectOption({ label: "　　人事部" });
    await dialog.getByRole("button", { name: "登録" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("試験 一郎");
  });
});
