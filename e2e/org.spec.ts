import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers";

test("組織ツリーに部署と顔が表示され、社員を探せる", async ({ page }) => {
  await loginAs(page, "member");
  await page.goto("/org");
  await expect(page.locator("[data-dept-id]").first()).toBeVisible();
  expect(await page.locator("[data-dept-id]").count()).toBeGreaterThan(15);
  await page.getByLabel("ツリーの中で社員を探す").fill("やまだ");
  await expect(page.getByText(/名が該当/)).toBeVisible();
  await page.getByRole("button", { name: "本部だけ表示" }).click();
  await expect(page.locator('[data-dept-id="11"]')).toHaveCount(0);
});

test.describe("配置シミュレーション", () => {
  test("顔をドラッグして異動案を作り、本番に反映すると所属が変わる", async ({ page }) => {
    await loginAs(page, "hr");
    await page.goto("/placement");
    await page.getByRole("button", { name: "新しいシミュレーション" }).click();
    await page.getByRole("dialog").getByLabel("名前").fill("E2E テスト案");
    await page.getByRole("dialog").getByRole("button", { name: "作成して開く" }).click();
    await expect(page.getByRole("heading", { name: /E2E テスト案/ })).toBeVisible();

    const face = page.locator('[data-dept-id="6"] [data-member-id]').nth(3);
    const memberId = await face.getAttribute("data-member-id");
    await face.dragTo(page.locator('[data-dept-id="4"]'));
    await expect(page.locator('[data-dept-id="4"]').getByText("+1")).toBeVisible();
    await expect(page.getByText(/に保存しました/)).toBeVisible();

    await page.getByRole("button", { name: "本番に反映" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "本番に反映する" }).click();
    await expect(page.getByText(/1名の異動を反映しました/)).toBeVisible();

    await page.goto(`/members/${memberId}`);
    await expect(page.locator("nav[aria-label='パンくず']")).toContainText("広報部");
    await expect(page.getByText(/配置シミュレーション「E2E テスト案」による異動/)).toBeVisible();
  });

  test("顔を選んで異動先と役職を指定できる（キーボード操作の代替）", async ({ page }) => {
    await loginAs(page, "manager");
    await page.goto("/placement/2");
    await page.locator('[data-dept-id="18"] button[data-member-id]').first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("異動先の部署").selectOption({ label: "　　　東日本営業課" });
    await dialog.getByRole("button", { name: "決定" }).click();
    await page.getByRole("button", { name: /異動案/ }).click();
    await expect(page.locator("#placement-changes")).toContainText("東日本営業課");
    // マネージャーは本番反映できない
    await expect(page.getByRole("button", { name: "本番に反映" })).toHaveCount(0);
  });
});

test("配置バランス図でタレント評価の値をドラッグで変更できる", async ({ page }) => {
  await loginAs(page, "manager");
  await page.goto("/balance");
  const face = page.locator('td [draggable="true"]').first();
  const id = await face.getAttribute("data-member-id");
  const from = await face.locator("xpath=ancestor::td").getAttribute("data-cell");
  const target = page.locator(`td[data-cell]:not([data-cell="${from}"])`).first();
  const to = await target.getAttribute("data-cell");
  await face.dragTo(target);
  await expect(page.getByRole("status")).toContainText("に移しました");
  await page.reload();
  await expect(page.locator(`td[data-cell="${to}"] [data-member-id="${id}"]`)).toBeVisible();
});
