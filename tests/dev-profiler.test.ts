import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { DevProfiler } from "../src/shared/dev-profiler.ts";

describe("DevProfiler - 开发期性能度量工具测试", () => {
  test("DevProfiler.time 在禁用状态下返回无害的空函数", () => {
    DevProfiler.setEnabled(false);
    assert.equal(DevProfiler.isEnabled(), false);

    const endTimer = DevProfiler.time("test-disabled");
    const duration = endTimer({ key: "val" });
    assert.equal(duration, 0);
  });

  test("DevProfiler.time 在启用状态下正确计算耗时", async () => {
    DevProfiler.setEnabled(true);
    assert.equal(DevProfiler.isEnabled(), true);

    const endTimer = DevProfiler.time("test-enabled");
    await new Promise((resolve) => setTimeout(resolve, 30));
    const duration = endTimer();

    assert.ok(duration >= 25, `duration 应大于等于 25ms，实际: ${duration}ms`);
  });

  test("DevProfiler.printSummaryTable 正确计算耗时并在控制台输出", () => {
    DevProfiler.setEnabled(true);

    const metrics = [
      { step: "步骤一", durationMs: 100, size: "1 MB" },
      { step: "步骤二", durationMs: 200, size: "2 MB" },
    ];

    // 验证调用无报错
    DevProfiler.printSummaryTable("测试流水线", metrics);
    assert.ok(true);
  });
});
