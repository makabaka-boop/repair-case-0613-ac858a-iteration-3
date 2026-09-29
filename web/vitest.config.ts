/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// 独立于 vite.config.ts，避免 globals 泄漏到 Playwright 的配置加载环境。
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    exclude: ["node_modules", "dist", "e2e/**", "playwright.config.ts"],
  },
});
