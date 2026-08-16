import assert from "node:assert/strict";
import test from "node:test";
import { h } from "preact";
import render from "preact-render-to-string";
import { FrameworkStateTab } from "../src/components/preview/FrameworkStateTab.tsx";
import type { FrameworkStateEvidence } from "../src/shared/protocol.ts";
import { getLocale } from "../src/shared/i18n.ts";

const ORIGIN = 1_700_000_000_000;

function mockState(
  overrides: Partial<FrameworkStateEvidence> = {}
): FrameworkStateEvidence {
  return {
    id: "fs1",
    sessionId: "s1",
    trigger: "start",
    capturedAtEpochMs: ORIGIN + 2_500,
    page: {
      url: "https://example.com/app",
      title: "App",
    },
    ...overrides,
  };
}

test("FrameworkStateTab 在有 startedAtEpochMs 时渲染相对时间", () => {
  const state = mockState({ capturedAtEpochMs: ORIGIN + 2_500 });
  const html = render(
    h(FrameworkStateTab, {
      states: [state],
      startedAtEpochMs: ORIGIN,
    })
  );

  assert.ok(
    html.includes("00:02.500"),
    `期望包含相对时间 00:02.500，实际为: ${html}`
  );
});

test("FrameworkStateTab 无 startedAtEpochMs 时使用 getLocale() 格式化绝对时间", () => {
  const capturedAt = ORIGIN + 1_000;
  const state = mockState({ capturedAtEpochMs: capturedAt });
  const html = render(
    h(FrameworkStateTab, {
      states: [state],
    })
  );

  const expectedTime = new Date(capturedAt).toLocaleTimeString(getLocale());
  assert.ok(
    html.includes(expectedTime),
    `期望包含以 getLocale() 格式化的绝对时间 ${expectedTime}，实际为: ${html}`
  );
});
