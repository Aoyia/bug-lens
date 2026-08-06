import assert from "node:assert/strict";
import test from "node:test";
import { h } from "preact";
import render from "preact-render-to-string";
import { IssueSceneTab } from "../src/components/preview/IssueSceneTab.tsx";
import type { IssueScene } from "../src/shared/protocol.ts";
import type { IssueScenePreview } from "../src/preview/issue-scene-view.ts";

function buildScene(
  id: string,
  narrative?: IssueScene["narrative"]
): IssueScene {
  return {
    id,
    sessionId: "session",
    status: "complete",
    observedAtEpochMs: 1_700_000_000_000,
    page: { url: "https://example.test", title: "Example", frameId: 0 },
    target: {
      capturedAtEpochMs: 1_700_000_000_000,
      element: {
        tagName: "BUTTON",
        classNames: [],
        attributes: {},
        text: "Submit",
        boundingBox: { x: 0, y: 0, width: 120, height: 32 },
        locators: [],
      },
      ancestors: [],
      state: {},
      computedStyle: {},
    },
    annotation: {
      type: "arrow-box",
      color: "#ef233c",
      point: { xRatio: 0.5, yRatio: 0.5 },
    },
    screenshot: { status: "captured" },
    narrative,
    issues: [],
  };
}

function renderTab(scenes: IssueScenePreview[]): string {
  return render(
    h(IssueSceneTab, {
      collection: { all: scenes, included: scenes },
      editable: false,
    })
  );
}

test("IssueSceneTab 对 confidence=missing 的期望渲染 (推断) 徽标", () => {
  const html = renderTab([
    {
      scene: buildScene("scene-1", {
        actual: "点击无反应",
        expected: { text: "应显示成功提示", confidence: "missing" },
      }),
    },
  ]);

  assert.match(html, /scene-text-expected/);
  assert.match(html, /应显示成功提示/);
  assert.match(html, /scene-expected-missing/);
  assert.match(html, /\(推断\)/);
});

test("IssueSceneTab 对 confidence=explicit 的期望不渲染 (推断) 徽标", () => {
  const html = renderTab([
    {
      scene: buildScene("scene-1", {
        actual: "点击无反应",
        expected: { text: "应显示成功提示", confidence: "explicit" },
      }),
    },
  ]);

  assert.match(html, /应显示成功提示/);
  assert.doesNotMatch(html, /scene-expected-missing/);
  assert.doesNotMatch(html, /\(推断\)/);
});

test("IssueSceneTab 对缺失期望渲染未填写且无徽标", () => {
  const html = renderTab([
    { scene: buildScene("scene-1", { actual: "点击无反应" }) },
  ]);

  assert.match(html, /未填写/);
  assert.doesNotMatch(html, /scene-expected-missing/);
});
