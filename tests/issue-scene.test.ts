import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { db } from "../src/storage/db.ts";
import {
  buildIssueSequenceContext,
  defaultAnnotation,
  markIssueSceneResult,
  normalizeAnnotation,
  withIssueNarrative,
} from "../src/domain/issue-scene.ts";
import {
  IssueSceneCapture,
  readImageDimensions,
} from "../src/recording/issue-scene-capture.ts";
import type {
  ConsoleEntry,
  InteractionRecord,
  IssueScene,
  RecordingSession,
} from "../src/shared/protocol.ts";

test("domain/issue-scene functions create and normalize scene properties", () => {
  const annotation = defaultAnnotation(
    { clientX: 192, clientY: 108 },
    { width: 1920, height: 1080 }
  );
  assert.equal(annotation.point.xRatio, 0.1);
  assert.equal(annotation.point.yRatio, 0.1);

  const normalized = normalizeAnnotation({
    type: "arrow-box",
    color: "#ef233c",
    point: { xRatio: -0.5, yRatio: 1.5 },
    targetBox: { xRatio: 0, yRatio: 0, widthRatio: 2.0, heightRatio: 0.5 },
  });
  assert.equal(normalized.point.xRatio, 0);
  assert.equal(normalized.point.yRatio, 1);
  assert.equal(normalized.targetBox?.widthRatio, 1);

  const baseScene: IssueScene = {
    id: "scene-1",
    sessionId: "sess-1",
    status: "capturing",
    observedAtEpochMs: Date.now(),
    page: { url: "https://example.test", title: "Test", frameId: 0 },
    target: {
      capturedAtEpochMs: Date.now(),
      element: {
        tagName: "button",
        classNames: [],
        attributes: {},
        locators: [],
      },
      ancestors: [],
      computedStyle: {},
    },
    annotation: normalized,
    screenshot: { status: "pending" },
    issues: [],
  };

  const withNarr = withIssueNarrative(
    baseScene,
    { actual: "Button broke", expected: "Button works" },
    normalized
  );
  assert.equal(withNarr.narrative?.actual, "Button broke");
  // 旧版 string 形态经 normalizeExpected 归一为结构化期望，无法判定是否显式表达，
  // 保守标记 confidence 为 "missing"
  assert.deepEqual(withNarr.narrative?.expected, {
    text: "Button works",
    confidence: "missing",
  });

  const explicitNarr = withIssueNarrative(
    baseScene,
    {
      actual: "Button broke",
      expected: {
        text: "Button works",
        tags: ["crash"],
        confidence: "explicit",
      },
    },
    normalized
  );
  assert.deepEqual(explicitNarr.narrative?.expected, {
    text: "Button works",
    tags: ["crash"],
    confidence: "explicit",
  });

  const completed = markIssueSceneResult(withNarr, "complete");
  assert.equal(completed.status, "complete");
});

test("domain/issue-scene normalizes userAnnotations and builds target snapshot", async () => {
  const { buildTargetSnapshot, normalizeAnnotation } =
    await import("../src/domain/issue-scene.ts");

  const normalized = normalizeAnnotation({
    type: "arrow-box",
    color: "#ef233c",
    point: { xRatio: 0.5, yRatio: 0.5 },
    userAnnotations: [
      {
        type: "rect",
        color: "",
        xRatio: -0.1,
        yRatio: 0.2,
        widthRatio: 1.5,
        heightRatio: 0.4,
      },
      {
        type: "arrow",
        color: "#000",
        start: { xRatio: 0, yRatio: 0 },
        end: { xRatio: 1, yRatio: 1 },
      },
    ],
  });

  assert.equal(normalized.userAnnotations?.[0].color, "#165dff");
  assert.equal(normalized.userAnnotations?.[0].xRatio, 0);

  const snapshot = buildTargetSnapshot({
    capturedAtEpochMs: 0,
    element: {
      tagName: "button",
      classNames: [],
      attributes: {},
      locators: [],
    },
    ancestors: [
      { tagName: "div", classNames: [] },
      { tagName: "body", classNames: [] },
      { tagName: "html", classNames: [] },
      { tagName: "doc", classNames: [] },
      { tagName: "root", classNames: [] },
      { tagName: "extra", classNames: [] },
    ],
    computedStyle: { display: "block" },
  });

  assert.equal(snapshot.ancestors.length, 5);
  assert.ok(snapshot.capturedAtEpochMs > 0);
});

function interaction(
  createdAt: number,
  overrides: Partial<InteractionRecord> = {}
): InteractionRecord {
  return {
    id: `i-${createdAt}`,
    sessionId: "sess-1",
    kind: "click",
    status: "confirmed",
    createdAt,
    page: { url: "https://example.test", title: "Test", frameId: 0 },
    input: { pointerType: "mouse", button: 0, isTrusted: true },
    coordinates: {
      clientX: 10,
      clientY: 10,
      pageX: 10,
      pageY: 10,
      scrollX: 0,
      scrollY: 0,
      devicePixelRatio: 1,
      viewport: { width: 1000, height: 800 },
    },
    element: {
      tagName: "button",
      classNames: [],
      attributes: {},
      locators: [],
    },
    screenshot: { status: "disabled" },
    ...overrides,
  };
}

function consoleEntry(
  createdAt: number,
  overrides: Partial<ConsoleEntry> = {}
): ConsoleEntry {
  return {
    id: `c-${createdAt}`,
    sessionId: "sess-1",
    createdAt,
    level: "error",
    text: "boom",
    ...overrides,
  };
}

test("domain/issue-scene buildIssueSequenceContext filters window and sorts ascending", () => {
  const anchor = 100_000;
  const slice = buildIssueSequenceContext({
    anchorEpochMs: anchor,
    interactions: [
      interaction(anchor - 30_000, { kind: "click", id: "a" }),
      interaction(anchor - 5_000, { kind: "input", id: "b" }),
      interaction(anchor - 70_000, { kind: "scroll", id: "outside" }),
      interaction(anchor + 1_000, { kind: "click", id: "after" }),
    ],
  });
  assert.ok(slice);
  assert.equal(slice.interactions.length, 2);
  assert.deepEqual(
    slice.interactions.map((item) => item.id),
    ["a", "b"]
  );
  assert.equal(slice.interactions[0].offsetMs, -30_000);
  assert.equal(slice.interactions[1].offsetMs, -5_000);
  assert.equal(slice.windowMs, 60_000);
});

test("domain/issue-scene buildIssueSequenceContext excludes cancelled and caps at max", () => {
  const anchor = 100_000;
  const slice = buildIssueSequenceContext({
    anchorEpochMs: anchor,
    maxInteractions: 3,
    interactions: [
      interaction(anchor - 1_000, { status: "cancelled", id: "cancelled" }),
      interaction(anchor - 2_000, { id: "k1" }),
      interaction(anchor - 3_000, { id: "k2" }),
      interaction(anchor - 4_000, { id: "k3" }),
      interaction(anchor - 5_000, { id: "k4" }),
    ],
  });
  assert.ok(slice);
  assert.equal(slice.interactions.length, 3);
  // 保留窗口内最近的 3 条，且排除已取消
  assert.deepEqual(
    slice.interactions.map((item) => item.id),
    ["k3", "k2", "k1"]
  );
});

test("domain/issue-scene buildIssueSequenceContext projects redaction and navigation", () => {
  const anchor = 100_000;
  const slice = buildIssueSequenceContext({
    anchorEpochMs: anchor,
    interactions: [
      interaction(anchor - 2_000, {
        kind: "input",
        id: "typed",
        metadata: { value: "secret", valueRedacted: true },
      }),
      interaction(anchor - 1_000, {
        kind: "navigation",
        id: "nav",
        metadata: { toUrl: "https://example.test/next" },
      }),
      interaction(anchor - 500, {
        kind: "keydown",
        id: "key",
        metadata: { key: "Enter", shortcut: "Alt+S" },
      }),
    ],
  });
  assert.ok(slice);
  const [typed, nav, key] = slice.interactions;
  assert.equal(typed.value, undefined);
  assert.equal(typed.valueRedacted, true);
  assert.equal(nav.toUrl, "https://example.test/next");
  assert.equal(key.key, "Enter");
  assert.equal(key.shortcut, "Alt+S");
});

test("domain/issue-scene buildIssueSequenceContext filters console levels and returns undefined when empty", () => {
  const anchor = 100_000;
  const empty = buildIssueSequenceContext({
    anchorEpochMs: anchor,
    interactions: [],
    consoleEntries: [],
  });
  assert.equal(empty, undefined);

  const slice = buildIssueSequenceContext({
    anchorEpochMs: anchor,
    interactions: [],
    consoleEntries: [
      consoleEntry(anchor - 2_000, { level: "error", text: "E1" }),
      consoleEntry(anchor - 1_000, { level: "warning", text: "W1" }),
      consoleEntry(anchor - 3_000, { level: "info", text: "I1" }),
      consoleEntry(anchor - 70_000, { level: "error", text: "outside" }),
    ],
  });
  assert.ok(slice);
  assert.equal(slice.interactions.length, 0);
  assert.equal(slice.consoleEntries.length, 2);
  assert.deepEqual(
    slice.consoleEntries.map((item) => item.text),
    ["E1", "W1"]
  );
});

test("IssueSceneCapture respects session-admission: permits derived tab and rejects untracked tabs with reason code", async () => {
  const session: RecordingSession = {
    id: "sess-admission-1",
    status: "RECORDING",
    target: {
      tabId: 50,
      windowId: 1,
      initialUrl: "https://example.com",
      initialTitle: "Example",
    },
    targets: [
      {
        tabId: 50,
        windowId: 1,
        url: "https://example.com",
        title: "Example",
        isPrimary: true,
      },
      {
        tabId: 51,
        windowId: 1,
        url: "https://example.com/derived",
        title: "Derived",
        isPrimary: false,
      },
    ],
    options: {
      privacyMode: "safe",
      captureConsole: true,
      captureNetwork: true,
      captureFrameworkState: false,
      autoTrackDerivedTabs: true,
    },
    timeline: {
      createdAtEpochMs: 1000,
      startedAtEpochMs: 1000,
    },
    quality: {
      interactionCount: 0,
      confirmedInteractionCount: 0,
      primaryScreenshotCount: 0,
      fallbackScreenshotCount: 0,
      unavailableScreenshotCount: 0,
      consoleEntryCount: 0,
      networkEntryCount: 0,
    },
    nonce: "valid-nonce-abc",
  };

  const existing = await db.getActiveSession();
  if (existing) {
    await db.clearActive(existing.id);
  }
  const claimed = await db.claimSession(session);
  assert.equal(claimed.claimed, true);

  let isStoppingSession = false;
  const captureService = new IssueSceneCapture(() => isStoppingSession);

  // 1. 派生 tab 准入通过（不会抛 ISSUE_SESSION_REJECTED）
  await assert.doesNotReject(async () => {
    await captureService.cancel("non-existent-scene", "valid-nonce-abc", {
      tab: { id: 51 } as chrome.tabs.Tab,
      frameId: 0,
    });
  });

  // 2. 主 tab 准入通过
  await assert.doesNotReject(async () => {
    await captureService.cancel("non-existent-scene", "valid-nonce-abc", {
      tab: { id: 50 } as chrome.tabs.Tab,
      frameId: 0,
    });
  });

  // 3. 陌生 tab 被拒，错误信息包含 TAB_NOT_TRACKED
  await assert.rejects(
    async () => {
      await captureService.cancel("non-existent-scene", "valid-nonce-abc", {
        tab: { id: 999 } as chrome.tabs.Tab,
        frameId: 0,
      });
    },
    (err: Error) => {
      assert.ok(err.message.includes("ISSUE_SESSION_REJECTED"));
      assert.ok(err.message.includes("TAB_NOT_TRACKED"));
      return true;
    }
  );

  // 4. nonce 错误被拒，包含 NONCE_MISMATCH
  await assert.rejects(
    async () => {
      await captureService.cancel("non-existent-scene", "wrong-nonce", {
        tab: { id: 51 } as chrome.tabs.Tab,
        frameId: 0,
      });
    },
    (err: Error) => {
      assert.ok(err.message.includes("ISSUE_SESSION_REJECTED"));
      assert.ok(err.message.includes("NONCE_MISMATCH"));
      return true;
    }
  );

  // 5. 子 frame 抛出 FRAME_GEOMETRY_UNAVAILABLE
  await assert.rejects(async () => {
    await captureService.cancel("non-existent-scene", "valid-nonce-abc", {
      tab: { id: 51 } as chrome.tabs.Tab,
      frameId: 1,
    });
  }, /FRAME_GEOMETRY_UNAVAILABLE/);

  // 6. 处于停止中时被拒，包含 STOPPING
  isStoppingSession = true;
  await assert.rejects(
    async () => {
      await captureService.cancel("non-existent-scene", "valid-nonce-abc", {
        tab: { id: 51 } as chrome.tabs.Tab,
        frameId: 0,
      });
    },
    (err: Error) => {
      assert.ok(err.message.includes("ISSUE_SESSION_REJECTED"));
      assert.ok(err.message.includes("STOPPING"));
      return true;
    }
  );
});

test("readImageDimensions parses PNG IHDR and JPEG SOF0/SOF2 headers without external dependencies", () => {
  // 1. 最小合法 PNG IHDR（750 x 1334）
  const pngBytes = new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a, // PNG signature
    0x00,
    0x00,
    0x00,
    0x0d, // IHDR length = 13
    0x49,
    0x48,
    0x44,
    0x52, // "IHDR"
    0x00,
    0x00,
    0x02,
    0xee, // width = 750
    0x00,
    0x00,
    0x05,
    0x36, // height = 1334
    0x08,
    0x06,
    0x00,
    0x00,
    0x00,
  ]);
  assert.deepEqual(readImageDimensions(pngBytes, "image/png"), {
    width: 750,
    height: 1334,
  });

  // 2. 最小合法 JPEG：含 APP0 段 + SOF0 段（860 x 1688）
  const jpegSof0Bytes = new Uint8Array([
    0xff,
    0xd8, // SOI
    0xff,
    0xe0, // APP0
    0x00,
    0x06, // length = 6 (2 len + 4 payload)
    0x4a,
    0x46,
    0x49,
    0x46,
    0xff,
    0xc0, // SOF0
    0x00,
    0x0b, // length = 11
    0x08, // precision
    0x06,
    0x98, // height = 1688
    0x03,
    0x5c, // width = 860
    0x01,
    0x01,
    0x11,
    0x00,
    0xff,
    0xd9, // EOI
  ]);
  assert.deepEqual(readImageDimensions(jpegSof0Bytes, "image/jpeg"), {
    width: 860,
    height: 1688,
  });

  // 3. JPEG SOF2 (Progressive DCT) 含冗余 0xFF 填充字节（1280 x 720）
  const jpegSof2Bytes = new Uint8Array([
    0xff,
    0xd8, // SOI
    0xff,
    0xff,
    0xc2, // 冗余 0xFF + SOF2
    0x00,
    0x0b, // length = 11
    0x08, // precision
    0x02,
    0xd0, // height = 720
    0x05,
    0x00, // width = 1280
    0x01,
    0x01,
    0x11,
    0x00,
  ]);
  assert.deepEqual(readImageDimensions(jpegSof2Bytes), {
    width: 1280,
    height: 720,
  });

  // 4. 非法/截断字节流安全返回 null
  assert.equal(readImageDimensions(new Uint8Array([])), null);
  assert.equal(readImageDimensions(new Uint8Array([0x00, 0x01, 0x02])), null);
  assert.equal(
    readImageDimensions(new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x04])),
    null
  );
});

test("IssueSceneCapture.capture stores real image dimensions from JPEG bytes instead of viewport * emulated DPR", async () => {
  const session: RecordingSession = {
    id: "sess-img-dim-1",
    status: "RECORDING",
    target: {
      tabId: 60,
      windowId: 2,
      initialUrl: "https://example.com",
      initialTitle: "Example",
    },
    targets: [
      {
        tabId: 60,
        windowId: 2,
        url: "https://example.com",
        title: "Example",
        isPrimary: true,
      },
    ],
    options: {
      privacyMode: "safe",
      captureConsole: false,
      captureNetwork: false,
      captureFrameworkState: false,
      autoTrackDerivedTabs: true,
    },
    timeline: {
      createdAtEpochMs: 1000,
      startedAtEpochMs: 1000,
    },
    quality: {
      interactionCount: 0,
      confirmedInteractionCount: 0,
      primaryScreenshotCount: 0,
      fallbackScreenshotCount: 0,
      unavailableScreenshotCount: 0,
      consoleEntryCount: 0,
      networkEntryCount: 0,
    },
    nonce: "nonce-dim-1",
  };
  const existing = await db.getActiveSession();
  if (existing) {
    await db.clearActive(existing.id);
  }
  const claimed = await db.claimSession(session);
  assert.equal(claimed.claimed, true);

  // 构造真实 750x1334 的最小 JPEG（对应 2x 截屏），同时上报虚拟 DPR=3
  const jpegBytes = new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0x00,
    0x0b,
    0x08,
    0x05,
    0x36, // height = 1334
    0x02,
    0xee, // width = 750
    0x01,
    0x01,
    0x11,
    0x00,
    0xff,
    0xd9,
  ]);
  const base64 = Buffer.from(jpegBytes).toString("base64");
  const dataUrl = `data:image/jpeg;base64,${base64}`;

  const originalChrome = (globalThis as { chrome?: unknown }).chrome;
  (globalThis as { chrome?: unknown }).chrome = {
    tabs: {
      query: async () => [{ id: 60, active: true, windowId: 2 }],
      captureVisibleTab: async () => dataUrl,
    },
    windows: {
      WINDOW_ID_CURRENT: -2,
    },
  };

  try {
    const captureService = new IssueSceneCapture(() => false);
    const { scene } = await captureService.capture(
      {
        nonce: "nonce-dim-1",
        observedAtEpochMs: Date.now(),
        page: {
          url: "https://example.com",
          title: "Example",
          frameId: 0,
          viewport: { width: 375, height: 667 },
          devicePixelRatio: 3,
        },
        target: {
          capturedAtEpochMs: Date.now(),
          element: {
            tagName: "button",
            classNames: [],
            attributes: {},
            locators: [],
          },
          ancestors: [],
          computedStyle: {},
        },
      },
      { tab: { id: 60, windowId: 2 } as chrome.tabs.Tab, frameId: 0 }
    );

    assert.equal(scene.screenshot.status, "captured");
    const asset = await db.getEvidenceAsset(scene.screenshot.originalAssetId!);
    assert.ok(asset);
    assert.equal(asset.width, 750);
    assert.equal(asset.height, 1334);
  } finally {
    await db.clearActive(session.id);
    if (originalChrome === undefined) {
      delete (globalThis as { chrome?: unknown }).chrome;
    } else {
      (globalThis as { chrome?: unknown }).chrome = originalChrome;
    }
  }
});
