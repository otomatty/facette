/**
 * ビルドした Worker の設定が、デプロイ先として正しいかを確かめる（CI と scripts/deploy.ts から呼ぶ）。
 * 本番にデモモードやデモ用のデータベースが入ったままデプロイしないためのもの。
 *
 *   CLOUDFLARE_ENV=production pnpm build
 *   node scripts/check-deploy-config.ts production
 *
 * CLOUDFLARE_ENV を付けて vite build すると、その環境だけの設定が dist/ に書き出される
 * （.wrangler/deploy/config.json がその場所を指し、wrangler deploy はそれを使う）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { experimental_readRawConfig } from "wrangler";

type Target = "production" | "demo";

const EXPECTED: Record<Target, { name: string; database: string; demoMode: string; previewUrls: boolean }> = {
  production: { name: "facette", database: "facette-production", demoMode: "false", previewUrls: false },
  demo: { name: "facette-demo", database: "facette-demo", demoMode: "true", previewUrls: true },
};

type D1 = { binding: string; database_name?: string; database_id?: string };
type BuiltConfig = {
  name?: string;
  targetEnvironment?: string;
  workers_dev?: boolean;
  preview_urls?: boolean;
  vars?: Record<string, unknown>;
  d1_databases?: D1[];
};

const target = process.argv[2];
if (target !== "production" && target !== "demo") {
  console.error("使い方: node scripts/check-deploy-config.ts <production|demo>");
  process.exit(1);
}

const redirectPath = ".wrangler/deploy/config.json";
let built: BuiltConfig;
try {
  const { configPath } = JSON.parse(readFileSync(redirectPath, "utf8")) as { configPath: string };
  built = JSON.parse(readFileSync(path.resolve(path.dirname(redirectPath), configPath), "utf8"));
} catch {
  console.error(`ビルドした設定が見つかりません。先に CLOUDFLARE_ENV=${target} を付けてビルドしてください`);
  process.exit(1);
}

// ほかの環境（トップレベルと、もう一方の環境）のデータベースを指していないかも確かめる
const { rawConfig } = experimental_readRawConfig({ config: "wrangler.jsonc" });
type RawEnv = { d1_databases?: D1[] };
const idOf = (dbs: D1[] | undefined) => dbs?.find((d) => d.binding === "DB")?.database_id;
const otherIds = [
  idOf((rawConfig as RawEnv).d1_databases),
  ...Object.entries((rawConfig.env ?? {}) as Record<string, RawEnv>)
    .filter(([name]) => name !== target)
    .map(([, env]) => idOf(env.d1_databases)),
].filter(Boolean);

const want = EXPECTED[target];
const db = built.d1_databases?.find((d) => d.binding === "DB");
const errors: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) errors.push(message);
};

check(
  built.targetEnvironment === target,
  `ビルドした環境が「${built.targetEnvironment ?? "トップレベル"}」です。CLOUDFLARE_ENV=${target} を付けてビルドし直してください`,
);
check(built.name === want.name, `Worker 名が ${built.name} です（${want.name} のはず）`);
check(
  String(built.vars?.DEMO_MODE) === want.demoMode,
  `DEMO_MODE が ${built.vars?.DEMO_MODE} です（${want.demoMode} のはず）`,
);
check(db?.database_name === want.database, `D1 が ${db?.database_name} です（${want.database} のはず）`);
check(
  Boolean(db?.database_id) && !otherIds.includes(db?.database_id),
  "D1 の database_id がほかの環境と同じです。環境ごとに別のデータベースを指定してください",
);
check(built.workers_dev === false, "workers_dev を false にしてください（公開はカスタムドメインだけにする）");
check(
  built.preview_urls === want.previewUrls,
  `preview_urls が ${built.preview_urls} です（${want.previewUrls} のはず）`,
);
if (target === "production") {
  check(
    String(built.vars?.DEMO_URL ?? "").startsWith("https://"),
    "DEMO_URL（ログイン画面のデモ用サイトへのリンク先）を https:// で設定してください",
  );
}

if (errors.length > 0) {
  const prefix = process.env.GITHUB_ACTIONS ? "::error::" : "✗ ";
  for (const e of errors) console.error(`${prefix}${e}`);
  process.exit(1);
}
console.log(`OK: ${target} → Worker ${built.name} / D1 ${db?.database_name} / DEMO_MODE=${want.demoMode}`);
