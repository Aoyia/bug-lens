import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ImageViewer } from "../src/preview/image-viewer.ts";
import type { InteractionRecord } from "../src/shared/protocol.ts";

type FakeElement = {
  hidden: boolean;
  disabled: boolean;
  src: string;
  textContent: string;
  style: Record<string, string>;
  classList: { add(...names: string[]): void; remove(...names: string[]): void };
  addEventListener(type: string, listener: (event: never) => void, options?: unknown): void;
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
    click() {}
  };
}

function previewDocument(): Document {
  const html = readFileSync(new URL("../src/entrypoints/preview/index.html", import.meta.url), "utf8");
  const nodes = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => [`#${match[1]}`, fakeElement()]));
  return {
    querySelector: (selector: string) => nodes.get(selector) ?? null,
    createElement: () => fakeElement(),
    body: fakeElement()
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
  coordinates: { clientX: 1, clientY: 2, pageX: 1, pageY: 2, scrollX: 0, scrollY: 0, devicePixelRatio: 1, viewport: { width: 800, height: 600 } },
  element: { tagName: "BUTTON", classNames: [], attributes: {}, text: "Preview", boundingBox: { x: 0, y: 0, width: 10, height: 10 }, locators: [] },
  screenshot: { status: "captured", source: "primary", dataUrl: "data:image/png;base64,AA==" }
};

test("image viewer opens against the real preview template contract", () => {
  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { addEventListener() {}, setTimeout }
  });
  try {
    const viewer = new ImageViewer(previewDocument(), () => undefined);
    assert.doesNotThrow(() => viewer.open([screenshotInteraction], screenshotInteraction.id));
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow });
  }
});
