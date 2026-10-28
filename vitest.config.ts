import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [
          cloudflareTest(async () => {
            const migrations = await readD1Migrations("./migrations");
            return {
              wrangler: { configPath: "./wrangler.jsonc" },
              miniflare: {
                bindings: {
                  TEST_MIGRATIONS: migrations,
                  BETTER_AUTH_SECRET: "test-secret-for-better-auth-0123456789",
                  GOOGLE_CLIENT_ID: "test-client-id.apps.googleusercontent.com",
                  GOOGLE_CLIENT_SECRET: "test-client-secret",
                },
              },
            };
          }),
        ],
        test: {
          name: "worker",
          include: ["tests/worker/**/*.test.ts"],
          setupFiles: ["./tests/worker/setup.ts"],
        },
      },
      {
        plugins: [react()],
        test: {
          name: "client",
          environment: "happy-dom",
          include: ["src/client/**/*.test.{ts,tsx}", "src/shared/**/*.test.ts"],
        },
      },
    ],
  },
});
