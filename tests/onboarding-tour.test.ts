import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("onboarding-tour includes automated test bypass check for navigator.webdriver and storage flags", () => {
  const tourCode = readFileSync(resolve(process.cwd(), "src/guide/onboarding-tour.ts"), "utf8");

  // 1. 确保包含对 navigator.webdriver 的检测以自动化测试跳过
  assert.ok(
    tourCode.includes("navigator.webdriver"),
    "Must check navigator.webdriver to skip onboarding tour in automated testing environment"
  );

  // 2. 确保包含 skipOnboardingGuide / hasCompletedGuide 的存储检查
  assert.ok(
    tourCode.includes("skipOnboardingGuide"),
    "Must support skipOnboardingGuide storage flag for automated testing"
  );
  assert.ok(
    tourCode.includes("hasCompletedGuide"),
    "Must preserve hasCompletedGuide storage flag check"
  );
});
