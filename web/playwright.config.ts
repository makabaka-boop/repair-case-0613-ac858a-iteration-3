import { defineConfig, devices } from "@playwright/test";

// 贯通测试需要前后端真实联调：
// - webServer（可含多条）在 CI 下自动拉起 uvicorn 与 vite dev；
// - 本地已运行时复用之（reuseExistingServer）。
// vite dev 的 /api 代理到 FastAPI（见 vite.config.ts）。
const CI = !!process.env.CI;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: CI
    ? [
        {
          command: "python3 -m uvicorn app.main:app --host 127.0.0.1 --port 8000",
          cwd: "../api",
          url: "http://localhost:8000/health",
          timeout: 30_000,
          reuseExistingServer: true,
        },
        {
          command: "npm run dev -- --host 127.0.0.1",
          url: "http://localhost:5173",
          timeout: 30_000,
          reuseExistingServer: true,
        },
      ]
    : undefined,
});
