// 画面確認用のスクリーンショットを撮る開発用スクリプト
// 使い方: node scripts/screenshot.mjs --base http://localhost:5173 --role hr --out /tmp/shots /members /org
//   --role: admin | hr | manager | member | none（デモログインのアカウント）
//   --width: 画面幅（既定 1440）  --full: ページ全体を撮る
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return false;
  args.splice(i, 1);
  return true;
};
const base = opt("base", "http://localhost:5173");
const role = opt("role", "hr");
const out = opt("out", "test-results/shots");
const width = Number(opt("width", "1440"));
const full = flag("full");
const paths = args.length ? args : ["/"];
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width, height: 900 },
  locale: "ja-JP",
  timezoneId: "Asia/Tokyo",
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text()}`);
});
const ids = { admin: 1, hr: 2, manager: 3, member: 4 };
if (role !== "none") {
  const r = await page.request.post(`${base}/api/auth/demo-login`, { data: { userId: ids[role] } });
  if (!r.ok()) console.error(`demo login failed: ${r.status()}`);
}
for (const p of paths) {
  await page.goto(base + p, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  const name = `${role}-${width}-${p.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "root"}.png`;
  await page.screenshot({ path: `${out}/${name}`, fullPage: full });
  console.log(`${out}/${name}`);
}
if (errors.length) console.log(`ERRORS:\n${errors.join("\n")}`);
await browser.close();
