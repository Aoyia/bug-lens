import assert from "node:assert/strict";
import test from "node:test";
import {
  buildIssueSequenceContext,
  defaultAnnotation,
  markIssueSceneResult,
  normalizeAnnotation,
  withIssueNarrative,
} from "../src/domain/issue-scene.ts";
import { IssueSceneCapture } from "../src/recording/issue-scene-capture.ts";
import type {
  ConsoleEntry,
  InteractionRecord,
  IssueScene,
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
