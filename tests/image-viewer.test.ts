import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ImageViewer } from "../src/preview/image-viewer.ts";
import type { InteractionRecord, IssueScene } from "../src/shared/protocol.ts";
import type { IssueScenePreview } from "../src/preview/issue-scene-view.ts";

type FakeElement = {
  hidden: boolean;
  disabled: boolean;
  src: string;
  textContent: string;
  style: Record<string, string>;
  classList: {
    add(...names: string[]): void;
    remove(...names: string[]): void;
  };
  addEventListener(
    type: string,
    listener: (event: never) => void,
    options?: unknown
  ): void;
  closest(selector: string): null;
  appendChild(child: unknown): void;
  remove(): void;
  click(): void;
};

function fakeElement(): FakeElement {
  return {
    hidden: false,
    disabled: false,
    src: "",
    textContent: "",
    style: {},
    classList: { add() {}, remove() {} },
    addEventListener() {},
    closest: () => null,
    appendChild() {},
    remove() {},
    click() {},
  };
}

function previewDocument(): Document {
  const html = readFileSync(
    new URL("../src/entrypoints/preview/index.html", import.meta.url),
    "utf8"
  );
  const nodes = new Map(
    [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => [
      `#${match[1]}`,
      fakeElement(),
    ])
  );
  return {
    querySelector: (selector: string) => nodes.get(selector) ?? null,
    createElement: () => fakeElement(),
    body: fakeElement(),
  } as unknown as Document;
}

const screenshotInteraction: InteractionRecord = {
  id: "interaction",
  sessionId: "session",
  kind: "click",
  status: "confirmed",
  createdAt: 1,
  page: { url: "https://example.test", title: "Example", frameId: 0 },
  input: { pointerType: "mouse", button: 0, isTrusted: true },
  coordinates: {
    clientX: 1,
    clientY: 2,
    pageX: 1,
    pageY: 2,
    scrollX: 0,
    scrollY: 0,
    devicePixelRatio: 1,
    viewport: { width: 800, height: 600 },
  },
  element: {
    tagName: "BUTTON",
    classNames: [],
    attributes: {},
    text: "Preview",
    boundingBox: { x: 0, y: 0, width: 10, height: 10 },
    locators: [],
  },
  screenshot: {
    status: "captured",
    source: "primary",
    dataUrl: "data:image/png;base64,AA==",
  },
};

test("image viewer opens against the real preview template contract", () => {
  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { addEventListener() {}, setTimeout },
  });
  try {
    const viewer = new ImageViewer(previewDocument(), () => undefined);
    assert.doesNotThrow(() =>
      viewer.open([screenshotInteraction], screenshotInteraction.id)
    );
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: previousWindow,
    });
  }
});

function buildScene(id: string): IssueScene {
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
        text: "Preview",
        boundingBox: { x: 0, y: 0, width: 10, height: 10 },
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
    issues: [],
  };
}

function withStubWindow(fn: () => void): void {
  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { addEventListener() {}, setTimeout },
  });
  try {
    fn();
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: previousWindow,
    });
  }
}

test("image viewer opens issue scene screenshots and selects the requested mode", () => {
  withStubWindow(() => {
    const root = previewDocument();
    const viewer = new ImageViewer(root, () => undefined);
    const modal = root.querySelector<FakeElement>("#image-modal")!;
    const modalImage = root.querySelector<FakeElement>("#modal-image")!;
    const modalTitle = root.querySelector<FakeElement>("#modal-step-title")!;
    const counter = root.querySelector<FakeElement>("#modal-step-counter")!;
    modal.hidden = true;

    const scenes: IssueScenePreview[] = [
      {
        scene: buildScene("scene-1"),
        annotatedSource: "data:image/png;base64,AA==",
        originalSource: "data:image/png;base64,BB==",
      },
      {
        scene: buildScene("scene-2"),
        originalSource: "data:image/png;base64,CC==",
      },
    ];

    // 默认 annotated 模式定位
    viewer.openScenes(scenes, "scene-1", "annotated");
    assert.equal(modal.hidden, false);
    assert.equal(modalImage.src, "data:image/png;base64,AA==");
    assert.match(modalTitle.textContent, /issueSceneTitle/);
    assert.equal(counter.textContent, "1 / 3");

    // original 模式定位
    viewer.openScenes(scenes, "scene-1", "original");
    assert.equal(modalImage.src, "data:image/png;base64,BB==");
    assert.match(modalTitle.textContent, /issueSceneTitle/);
    assert.equal(counter.textContent, "2 / 3");

    // 场景缺少 annotated 时回退到其第一张可用图
    viewer.openScenes(scenes, "scene-2", "annotated");
    assert.equal(modalImage.src, "data:image/png;base64,CC==");
    assert.match(modalTitle.textContent, /issueSceneTitle/);

    // 无截图场景不打开 modal
    modal.hidden = true;
    viewer.openScenes([{ scene: buildScene("scene-empty") }], "scene-empty");
    assert.equal(modal.hidden, true);
  });
});
