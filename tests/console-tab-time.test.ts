import assert from "node:assert/strict";
import test from "node:test";
import { h } from "preact";
import render from "preact-render-to-string";
import { ConsoleTab } from "../src/components/preview/ConsoleTab.tsx";
import type {
  ConsoleEntry,
  RecordingOptions,
  RecordingSession,
} from "../src/shared/protocol.ts";

const ORIGIN = 1_700_000_000_000;

function mockEntry(overrides: Partial<ConsoleEntry>): ConsoleEntry {
  return {
    id: "c1",
    sessionId: "s1",
    createdAt: ORIGIN + 1_234,
    level: "log",
    text: "Application initialized",
    source: "app.js",
    ...overrides,
  };
}

function mockSession(timeline: RecordingSession["timeline"]): RecordingSession {
  return {
    id: "s1",
    schemaVersion: 2,
    extensionVersion: "0.6.0",
    status: "COMPLETED",
    target: {
      tabId: 1,
      initialUrl: "https://example.com",
      initialTitle: "Example",
    },
    options: {} as RecordingOptions,
    timeline,
    quality: {
      overall: "complete",
      interactionCount: 0,
      confirmedInteractionCount: 0,
      primaryScreenshotCount: 0,
      fallbackScreenshotCount: 0,
      unavailableScreenshotCount: 0,
      consoleEntryCount: 1,
      networkEntryCount: 0,
      issues: [],
    },
    nonce: "n",
  };
}

function renderTab(
  session: RecordingSession | undefined,
  entries: ConsoleEntry[]
): string {
  return render(
    h(ConsoleTab, {
      snapshot: {
        session,
        all: entries,
        included: entries,
      },
      editable: false,
    })
  );
}

test("ConsoleTab 有 startedAtEpochMs 时行时间显示相对录制起点的 MM:SS.mmm", () => {
  const entries = [mockEntry({ id: "c1", createdAt: ORIGIN + 1_234 })];
  const session = mockSession({
    createdAtEpochMs: ORIGIN - 1_000,
    startedAtEpochMs: ORIGIN,
  });
  const html = renderTab(session, entries);
  // 相对时间：00:01.234（与 NetworkTab/StreamTab/InteractionsTab 的时间语言一致）
  assert.ok(
    html.includes("00:01.234"),
    `期望相对时间 00:01.234，实际: ${html}`
  );
});

test("ConsoleTab 无 startedAtEpochMs 时以 createdAtEpochMs 为时间原点", () => {
  const entries = [mockEntry({ id: "c1", createdAt: ORIGIN + 5_000 })];
  const session = mockSession({ createdAtEpochMs: ORIGIN });
  const html = renderTab(session, entries);
  assert.ok(
    html.includes("00:05.000"),
    `期望相对时间 00:05.000，实际: ${html}`
  );
});

test("ConsoleTab 无会话时间原点时回退到绝对时间，不丢信息", () => {
  const createdAt = ORIGIN + 1_234;
  const entries = [mockEntry({ id: "c1", createdAt })];
  const html = renderTab(undefined, entries);
  const expected = new Date(createdAt).toLocaleTimeString();
  assert.ok(
    html.includes(expected),
    `期望回退绝对时间 ${expected}，实际: ${html}`
  );
});

test("ConsoleTab 日志早于录制起点时回退到绝对时间，不显示负数", () => {
  const createdAt = ORIGIN - 500;
  const entries = [mockEntry({ id: "c1", createdAt })];
  const session = mockSession({
    createdAtEpochMs: ORIGIN,
    startedAtEpochMs: ORIGIN,
  });
  const html = renderTab(session, entries);
  const expected = new Date(createdAt).toLocaleTimeString();
  assert.ok(
    html.includes(expected),
    `期望回退绝对时间 ${expected}，实际: ${html}`
  );
});
