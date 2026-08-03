import assert from "node:assert/strict";
import test from "node:test";
import { NavigationCapture } from "../src/recording/navigation-capture.ts";
import type { InteractionRecord } from "../src/shared/protocol.ts";

test("NavigationCapture correctly listens to main frame navigation and sends interaction record", async () => {
  let capturedRecord: InteractionRecord | undefined;

  const mockRepository = {
    async getActiveSession() {
      return {
        id: "sess-1",
        nonce: "nonce-123",
        status: "RECORDING",
        target: { tabId: 42 },
      } as any;
    },
  };

  const mockInteractionCapture = {
    async handle(record: InteractionRecord) {
      capturedRecord = record;
    },
  } as any;

  let listenerCallback: any;
  (globalThis as any).chrome = {
    webNavigation: {
      onCommitted: {
        addListener(fn: any) {
          listenerCallback = fn;
        },
        removeListener(fn: any) {
          if (listenerCallback === fn) listenerCallback = undefined;
        },
      },
    },
  };

  const navCapture = new NavigationCapture(
    mockRepository,
    mockInteractionCapture
  );
  navCapture.attach();

  assert.notEqual(listenerCallback, undefined);

  // 模拟触发 main frame 的 reload 导航
  await listenerCallback({
    tabId: 42,
    frameId: 0,
    url: "https://juejin.cn/post/123",
    transitionType: "reload",
    transitionQualifiers: ["from_address_bar"],
  });

  assert.notEqual(capturedRecord, undefined);
  assert.equal(capturedRecord?.kind, "navigation");
  assert.equal(capturedRecord?.sessionId, "nonce-123");
  assert.equal(capturedRecord?.page.url, "https://juejin.cn/post/123");
  assert.equal(capturedRecord?.metadata?.navigationType, "reload");
  assert.equal(capturedRecord?.metadata?.toUrl, "https://juejin.cn/post/123");

  navCapture.detach();
  assert.equal(listenerCallback, undefined);
});
