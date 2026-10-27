import { expect, type Page, test } from "@playwright/test";
import { loginAs, ROLES } from "./helpers";

/** 画面の表示中に起きたエラー（フォントなど外部リソースの読み込み失敗は除く） */
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    if (/Failed to load resource|ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|fonts\.(googleapis|gstatic)/.test(m.text()))
      return;
    errors.push(`console: ${m.text()}`);
  });
  page.on("response", (r) => {
    if (r.url().includes("/api/") && r.status() >= 500) errors.push(`${r.status()} ${r.url()}`);
  });
  return errors;
}

async function expectHealthyPage(page: Page, path: string) {
  await expect(page.getByRole("heading", { level: 1 }).first(), path).toBeVisible();
  await expect(page.getByText("画面を表示できませんでした"), path).toHaveCount(0);
  await expect(page.getByText("ページが見つかりません"), path).toHaveCount(0);
  // 読み込み中の表示が消えるのを待ってから、エラー表示がないことを確かめる
  await expect(page.getByText("読み込んでいます"), path).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByRole("alert"), path).toHaveCount(0);
}

for (const role of Object.keys(ROLES) as (keyof typeof ROLES)[]) {
  test(`${ROLES[role]}：メニューのすべての画面がエラーなく表示される`, async ({ page }) => {
    test.setTimeout(120_000);
    const errors = watchErrors(page);
    await loginAs(page, role);
    const nav = page.getByRole("navigation", { name: "メインメニュー" });
    const hrefs = await nav
      .getByRole("link")
      .evaluateAll((links) => links.map((a) => (a as HTMLAnchorElement).getAttribute("href") ?? ""));
    const paths = [...new Set(hrefs.filter((h) => h.startsWith("/")))];
    expect(paths.length).toBeGreaterThan(3);
    for (const path of [...paths, "/account"]) {
      await page.goto(path);
      await expectHealthyPage(page, path);
    }
    // 一覧から詳細画面も開いてみる
    for (const [list, prefix] of [
      ["/members", "/members/"],
      ["/surveys", "/surveys/"],
      ["/evaluations", "/evaluations/"],
    ] as const) {
      await page.goto(list);
      await expectHealthyPage(page, list);
      const link = page.locator(`main a[href^="${prefix}"]`).filter({ hasNotText: /^$/ });
      const found = await link
        .first()
        .waitFor({ timeout: 5_000 })
        .then(() => true)
        .catch(() => false);
      expect(found, `${list} に詳細へのリンクがない`).toBe(true);
      const href = await link.first().getAttribute("href");
      await page.goto(href!);
      await expectHealthyPage(page, href!);
    }
    expect(errors).toEqual([]);
  });
}

test.describe("スマートフォン幅", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("主な画面で横スクロールが発生しない", async ({ page }) => {
    test.setTimeout(120_000);
    await loginAs(page, "hr");
    const paths = [
      "/",
      "/members",
      "/members?view=list",
      "/org",
      "/lists",
      "/skills",
      "/positions",
      "/placement",
      "/evaluations",
      "/surveys",
      "/surveys/1",
      "/one-on-ones",
      "/requests",
      "/dashboard",
      "/analytics",
      "/settings",
      "/account",
    ];
    const overflows: string[] = [];
    for (const path of paths) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      await expect(page.getByText("読み込んでいます")).toHaveCount(0, { timeout: 15_000 });
      const { scroll, client } = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
      if (scroll > client + 1) overflows.push(`${path}: ${scroll} > ${client}`);
    }
    expect(overflows).toEqual([]);
  });
});
