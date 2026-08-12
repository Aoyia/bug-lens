import assert from "node:assert/strict";
import test from "node:test";
import { h } from "preact";
import render from "preact-render-to-string";
import { InteractionsTab } from "../src/components/preview/InteractionsTab.tsx";
import type { InteractionRecord } from "../src/shared/protocol.ts";

function mockRecord(overrides: Partial<InteractionRecord>): InteractionRecord {
  return {
    id: crypto.randomUUID(),
    sessionId: "test-session",
    kind: "click",
    status: "confirmed",
    createdAt: Date.now(),
    page: { url: "https://www.google.com/webhp", title: "Google", frameId: 0 },
    input: { pointerType: "mouse", button: 0, isTrusted: true },
    coordinates: {
      clientX: 100,
      clientY: 100,
      pageX: 100,
      pageY: 100,
      scrollX: 0,
      scrollY: 0,
      devicePixelRatio: 2,
      viewport: { width: 800, height: 600 },
    },
    element: {
      tagName: "button",
      id: "submit-btn",
      classNames: ["primary"],
      attributes: {},
      boundingBox: { x: 10, y: 10, width: 200, height: 40 },
      locators: [],
    },
    screenshot: { status: "pending" },
    ...overrides,
  };
}

const ORIGIN = 1_700_000_000_000;

function renderTab(
  records: InteractionRecord[],
  startedAtEpochMs?: number
): string {
  return render(
    h(InteractionsTab, {
      snapshot: {
        all: records,
        included: records,
        hasMedia: true,
        startedAtEpochMs,
      },
      editable: false,
    })
  );
}

test("InteractionsTab 有 startedAtEpochMs 时主卡片时间显示相对录制起点的 MM:SS.mmm", () => {
  const records = [mockRecord({ id: "r1", createdAt: ORIGIN + 1_234 })];
  const html = renderTab(records, ORIGIN);
  // 相对时间：00:01.234（与 NetworkTab/StreamTab/ConsoleTab 的时间语言一致）
  assert.ok(
    html.includes("00:01.234"),
    `期望相对时间 00:01.234，实际: ${html}`
  );
});

test("InteractionsTab 多步骤卡片的时间范围同样使用相对时间", () => {
  const element = {
    tagName: "button",
    id: "submit-btn",
    classNames: ["primary"],
    attributes: {},
    boundingBox: { x: 10, y: 10, width: 200, height: 40 },
    locators: [],
  };
  const records = [
    mockRecord({
      id: "r1",
      createdAt: ORIGIN,
      element,
      coordinates: {
        clientX: 50,
        clientY: 50,
        pageX: 50,
        pageY: 50,
        scrollX: 0,
        scrollY: 0,
        devicePixelRatio: 2,
        viewport: { width: 800, height: 600 },
      },
    }),
    mockRecord({
      id: "r2",
      createdAt: ORIGIN + 2_500,
      element,
      coordinates: {
        clientX: 60,
        clientY: 60,
        pageX: 60,
        pageY: 60,
        scrollX: 0,
        scrollY: 0,
        devicePixelRatio: 2,
        viewport: { width: 800, height: 600 },
      },
    }),
  ];
  const html = renderTab(records, ORIGIN);
  assert.ok(
    html.includes("00:00.000") && html.includes("00:02.500"),
    `期望相对时间范围 00:00.000 ~ 00:02.500，实际: ${html}`
  );
});

test("InteractionsTab 无 startedAtEpochMs 时回退绝对时间且不崩溃", () => {
  const records = [mockRecord({ id: "r1", createdAt: ORIGIN + 1_234 })];
  const html = renderTab(records);
  assert.ok(!html.includes("00:01.234"), "无起点时不应显示相对时间");
  assert.ok(html.includes("00:00.000") === false, "无起点时不应显示 00:00.000");
});

test("InteractionsTab 时间早于录制起点时回退绝对时间且不崩溃", () => {
  const records = [mockRecord({ id: "r1", createdAt: ORIGIN - 5_000 })];
  const html = renderTab(records, ORIGIN);
  assert.ok(!html.includes("00:00.000"), "早于起点的时间不应显示相对时间");
  assert.ok(html.length > 0, "渲染不应为空");
});
