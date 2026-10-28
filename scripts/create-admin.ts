/**
 * 本番環境の最初のシステム管理者を作る SQL を出力する。
 *
 *   node scripts/create-admin.ts --email you@example.com --name "山田 太郎" > admin.sql
 *   pnpm wrangler d1 execute DB --remote --file=admin.sql
 *
 * ログインは Google アカウントで行う。指定したメールアドレスの Google アカウントでログインすると、
 * このユーザーにひもづく。すでに同じメールアドレスのユーザーがいれば、管理者に変更する。
 */
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    name: { type: "string" },
  },
});

const email = values.email?.trim();
const name = values.name?.trim() || "システム管理者";
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('使い方: node scripts/create-admin.ts --email you@example.com [--name "山田 太郎"]');
  process.exit(1);
}

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

process.stdout.write(
  `INSERT INTO users (email, display_name, role, active, is_demo)
VALUES (${q(email)}, ${q(name)}, 'admin', 1, 0)
ON CONFLICT(email) DO UPDATE SET role = 'admin', active = 1, is_demo = 0;
`,
);
console.error(`\n${email} の Google アカウントでログインしてください。`);
