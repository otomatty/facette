import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers";

test.describe("評価", () => {
  test("本人が自己評価を提出すると、一次評価者の番になる", async ({ page }) => {
    await loginAs(page, "member");
    await page.goto("/evaluations");
    await page.locator('main a[href^="/evaluations/sheets/"]').first().click();
    await expect(page.getByText("自己評価の点数とコメントを入力して提出してください")).toBeVisible();

    // 未入力のまま提出すると止められる
    await page.getByRole("button", { name: "提出する" }).first().click();
    await expect(page.getByText(/入力してください|未入力/).first()).toBeVisible();

    const radios = page.getByRole("radio", { name: "3点" });
    const n = await radios.count();
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i++) await radios.nth(i).check({ force: true });
    const selects = page.locator("main select[aria-label]");
    for (let i = 0; i < (await selects.count()); i++) await selects.nth(i).selectOption("3");

    await page.getByRole("button", { name: "提出する" }).first().click();
    const dialog = page.getByRole("dialog");
    if (await dialog.isVisible().catch(() => false)) {
      await dialog.getByRole("button", { name: "提出する" }).click();
    }
    await expect(page.getByText("提出しました")).toBeVisible();
    await expect(page.getByText(/一次評価者.*の評価を待っています/)).toBeVisible();
  });
});
