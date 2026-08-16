import assert from "node:assert/strict";
import test from "node:test";
import { h } from "preact";
import render from "preact-render-to-string";
import { StreamTab } from "../src/components/preview/StreamTab.tsx";
import { getLocale } from "../src/shared/i18n.ts";
import type {
  ConsoleEntry,
  RecordingOptions,
  RecordingSession,
} from "../src/shared/protocol.ts";

const ORIGIN = 1_700_000_000_000;

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

function mockConsoleEntry(overrides: Partial<ConsoleEntry>): ConsoleEntry {
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

function renderTab(
  session: RecordingSession | undefined,
  consoleEntries: ConsoleEntry[]
): string {
  return render(
    h(StreamTab, {
      snapshot: {
        session,
        interactions: [],
        consoleEntries,
        networkEntries: [],
      },
    })
  );
}

test("StreamTab 有 startedAtEpochMs 时节点时间显示相对录制起点的 MM:SS.mmm", () => {
  const entries = [mockConsoleEntry({ id: "c1", createdAt: ORIGIN + 1_234 })];
  const session = mockSession({
    createdAtEpochMs: ORIGIN - 1_000,
    startedAtEpochMs: ORIGIN,
  });
  const html = renderTab(session, entries);
  // 相对时间：00:01.234（与 Console/Network/Interactions 的时间语言一致）
  assert.ok(
    html.includes("00:01.234"),
    `期望相对时间 00:01.234，实际: ${html}`
  );
});

test("StreamTab 节点时间早于录制起点时回退到绝对时间，不显示空白", () => {
  const createdAt = ORIGIN - 500;
  const entries = [mockConsoleEntry({ id: "c1", createdAt })];
  const session = mockSession({
    createdAtEpochMs: ORIGIN,
    startedAtEpochMs: ORIGIN,
  });
  const html = renderTab(session, entries);
  const expected = new Date(createdAt).toLocaleTimeString(getLocale());
  assert.ok(
    html.includes(expected),
    `期望时间列回退到绝对时间 ${expected}，实际: ${html}`
  );
});
