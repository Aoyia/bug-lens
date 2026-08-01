import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Chrome 插件测试建议单线程执行
  reporter: "list",
  use: {
    headless: false,
    trace: "on-first-retry",
    video: "on-first-retry"
  },
  projects: [
    {
      name: "chromium"
    }
  ]
});
