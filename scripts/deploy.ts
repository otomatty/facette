/**
 * 手元から本番かデモへデプロイする（ふだんは main への push で CI がデプロイする）。
 *
 *   pnpm deploy:production   # ビルド → 確認 → 本番 D1 にマイグレーション → Worker（facette）をデプロイ
 *   pnpm deploy:demo         # ビルド → 確認 → デモ用 D1 にマイグレーションとデモデータの入れ直し → Worker（facette-demo）をデプロイ
 *
 * 環境は CLOUDFLARE_ENV で選ぶ（Vite のプラグインを使っているため、wrangler deploy --env は使えない）。
 * 本番のデータベースにデモデータを入れる手順はない。
 */
import { execSync } from "node:child_process";

const target = process.argv[2];
if (target !== "production" && target !== "demo") {
  console.error("使い方: node scripts/deploy.ts <production|demo>");
  process.exit(1);
}

const env = { ...process.env, CLOUDFLARE_ENV: target };
const run = (cmd: string) => {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: "inherit", env });
};

run("pnpm build");
run(`node scripts/check-deploy-config.ts ${target}`);
run("pnpm wrangler d1 migrations apply DB --remote");
if (target === "demo") {
  run("node scripts/generate-seed.ts");
  run("pnpm wrangler d1 execute DB --remote --file=seed/seed.sql --yes");
}
run("pnpm wrangler deploy");
