import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testIgnore: process.env.RUN_STRESS === "true" ? [] : ["**/30min*.spec.ts"],
  timeout: 90_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // 业务核心契约：原生系统级快捷键依赖操作系统唯一的桌面焦点，默认单 Worker 串行执行确保 100% 绝对稳定
  workers: Number(process.env.E2E_WORKERS) || 1,
  reporter: "list",
  use: {
    headless: false,
    trace: "retain-on-failure",
    video: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
    },
  ],
});
