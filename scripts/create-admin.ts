/**
 * 本番環境の最初のシステム管理者を作る SQL を出力する。
 *
 *   node scripts/create-admin.ts --email you@example.com --name "山田 太郎" > admin.sql
 *   pnpm wrangler d1 execute DB --remote --file=admin.sql
 *
 * パスワードは自動で生成して標準エラーに表示する（環境変数 FACETTE_ADMIN_PASSWORD で指定も可）。
 * 生成した SQL ファイルにはパスワードのハッシュだけが入る。実行後は削除してよい。
 */
import { pbkdf2Sync, randomBytes } from "node:crypto";
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

const password = process.env.FACETTE_ADMIN_PASSWORD ?? randomBytes(12).toString("base64url");
if (password.length < 10) {
  console.error("パスワードは10文字以上にしてください");
  process.exit(1);
}

const salt = randomBytes(16);
const hash = pbkdf2Sync(password, salt, 100_000, 32, "sha256");
const passwordHash = `pbkdf2_sha256$100000$${salt.toString("base64")}$${hash.toString("base64")}`;
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

process.stdout.write(
  `INSERT INTO users (email, display_name, password_hash, role, active, is_demo)
VALUES (${q(email)}, ${q(name)}, ${q(passwordHash)}, 'admin', 1, 0)
ON CONFLICT(email) DO UPDATE SET password_hash = excluded.password_hash, role = 'admin', active = 1, is_demo = 0,
  failed_logins = 0, locked_until = NULL;
`,
);
if (!process.env.FACETTE_ADMIN_PASSWORD) {
  console.error(`\n${email} の初期パスワード: ${password}\nログイン後、アカウント画面で変更してください。`);
}
