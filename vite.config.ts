import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // FACETTE_STATE_DIR を指定するとローカル D1 などの保存先を切り替えられる（並行作業用）
    cloudflare({
      persistState: process.env.FACETTE_STATE_DIR ? { path: process.env.FACETTE_STATE_DIR } : true,
    }),
  ],
  build: {
    chunkSizeWarningLimit: 900,
  },
});
