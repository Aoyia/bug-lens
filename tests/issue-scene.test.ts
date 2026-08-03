import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultAnnotation,
  markIssueSceneResult,
  normalizeAnnotation,
  withIssueNarrative,
} from "../src/domain/issue-scene.ts";
import { IssueSceneCapture } from "../src/recording/issue-scene-capture.ts";
import type { IssueScene } from "../src/shared/protocol.ts";

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
  assert.equal(withNarr.narrative?.expected, "Button works");

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
