import assert from "node:assert/strict";
import test from "node:test";
import { applyInteractionEvent } from "../src/domain/interaction-ledger.ts";
import { waitForDomSettled } from "../src/entrypoints/content/collector/settled-watcher.ts";
import { InteractionCapture } from "../src/recording/interaction-capture.ts";
import type {
  InteractionRecord,
  RecordingSession,
} from "../src/shared/protocol.ts";
import { installChromeMock } from "./helpers/chrome-mock.ts";

const baseSession: RecordingSession = {
  id: "sess-settled",
  schemaVersion: 2,
  extensionVersion: "0.7.41",
  status: "RECORDING",
  target: {
    tabId: 11,
    initialUrl: "https://example.test",
    initialTitle: "Settled Test",
  },
  options: {
    captureAudio: false,
    captureVideo: false,
    captureScreenshots: true,
    captureConsole: true,
    captureNetwork: true,
    captureNetworkBodies: false,
    privacyMode: "safe",
    mediaTimesliceMs: 1000,
    maxResponseBodyBytes: 1000,
    maxSessionBytes: 1_000_000,
  },
  timeline: { createdAtEpochMs: 10, startedAtEpochMs: 10 },
  quality: {
    overall: "complete",
    interactionCount: 0,
    confirmedInteractionCount: 0,
    primaryScreenshotCount: 0,
    fallbackScreenshotCount: 0,
    unavailableScreenshotCount: 0,
    consoleEntryCount: 0,
    networkEntryCount: 0,
    issues: [],
  },
  nonce: "sess-settled",
};

function makeInteraction(id: string): InteractionRecord {
  return {
    id,
    sessionId: "sess-settled",
    kind: "click",
    status: "confirmed",
    createdAt: Date.now(),
    confirmedAt: Date.now(),
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
      viewport: { width: 1280, height: 800 },
    },
    element: {
      tagName: "button",
      classNames: [],
      attributes: {},
      text: "Submit",
      boundingBox: { x: 0, y: 0, width: 100, height: 40 },
      locators: [],
    },
    screenshot: { status: "pending" },
  };
}

test("Module D.1: event-driven settled waits for DOM quiet + network idle within [min..max] and fires onSettledCaptured", async () => {
  const frameBytes = Buffer.from("FRAME_JPEG").toString("base64");
  installChromeMock({
    tabsQuery: async () => [{ id: 11, active: true, windowId: 1 }],
    captureVisibleTab: async () => `data:image/jpeg;base64,${frameBytes}`,
    sendMessage: async () => ({
      ok: true,
      dataUrl: `data:image/jpeg;base64,${frameBytes}`,
    }),
  });

  const stored = new Map<string, InteractionRecord>();
  const savedAssets: Array<{ kind: string; interactionId?: string }> = [];
  let inflightCount = 2;
  let domQuietResolved = false;
  let settledStateCallbackCount = 0;

  // 网络请求 110ms 后清零（位于 [40ms min .. 400ms max] 窗口之内）
  setTimeout(() => {
    inflightCount = 0;
  }, 110);

  const capture = new InteractionCapture(
    {
      getActiveSession: async () => baseSession,
      getInteraction: async (id) => stored.get(id),
      saveInteractionWithinBudget: async (next) => {
        stored.set(next.id, next);
        return { stored: true, usedBytes: 1, limitReached: false };
      },
      saveEvidenceAssetWithinBudget: async (asset) => {
        savedAssets.push({
          kind: asset.kind,
          interactionId: asset.interactionId,
        });
        return { stored: true, usedBytes: 10, limitReached: false };
      },
    },
    async () => baseSession,
    () => false,
    500,
    40,
    400,
    {
      getInflightNetworkCount: () => inflightCount,
      waitForDomQuiet: async () => {
        await new Promise((r) => setTimeout(r, 80));
        domQuietResolved = true;
      },
      onSettledCaptured: async () => {
        settledStateCallbackCount += 1;
      },
    }
  );

  await capture.handle(makeInteraction("int-d1"), {
    tab: { id: 11 },
    frameId: 0,
  } as any);

  await new Promise((r) => setTimeout(r, 260));
  assert.deepEqual(await capture.drain(), []);

  assert.equal(domQuietResolved, true);
  assert.equal(settledStateCallbackCount, 1);
  const settledAsset = savedAssets.find(
    (a) => a.kind === "interaction-settled"
  );
  assert.equal(settledAsset?.interactionId, "int-d1");
  const rec = stored.get("int-d1");
  assert.ok((rec?.screenshot.settledDurationMs ?? 0) >= 90);
  assert.equal(rec?.screenshot.settledSkippedReason, undefined);
});

test("Module D.1: superseding interaction records settledSkippedReason on previous pending interaction", async () => {
  const frameBytes = Buffer.from("FRAME_JPEG").toString("base64");
  installChromeMock({
    tabsQuery: async () => [{ id: 11, active: true, windowId: 1 }],
    captureVisibleTab: async () => `data:image/jpeg;base64,${frameBytes}`,
    sendMessage: async () => ({
      ok: true,
      dataUrl: `data:image/jpeg;base64,${frameBytes}`,
    }),
  });

  const stored = new Map<string, InteractionRecord>();
  const savedAssets: Array<{ kind: string; interactionId?: string }> = [];

  const capture = new InteractionCapture(
    {
      getActiveSession: async () => baseSession,
      getInteraction: async (id) => stored.get(id),
      saveInteractionWithinBudget: async (next) => {
        stored.set(next.id, next);
        return { stored: true, usedBytes: 1, limitReached: false };
      },
      saveEvidenceAssetWithinBudget: async (asset) => {
        savedAssets.push({
          kind: asset.kind,
          interactionId: asset.interactionId,
        });
        return { stored: true, usedBytes: 10, limitReached: false };
      },
    },
    async () => baseSession,
    () => false,
    500,
    80,
    200
  );

  await capture.handle(makeInteraction("int-first"), {
    tab: { id: 11 },
    frameId: 0,
  } as any);
  await new Promise((r) => setTimeout(r, 15));
  await capture.handle(makeInteraction("int-second"), {
    tab: { id: 11 },
    frameId: 0,
  } as any);

  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(await capture.drain(), []);

  assert.equal(
    stored.get("int-first")?.screenshot.settledSkippedReason,
    "superseded-by:int-second"
  );
  assert.equal(stored.get("int-first")?.screenshot.settledAssetId, undefined);
  assert.ok(stored.get("int-second")?.screenshot.settledAssetId);
  assert.equal(
    savedAssets.filter((a) => a.kind === "interaction-settled").length,
    1
  );
});

test("Module D.1: interaction-ledger & waitForDomSettled non-DOM fallback", async () => {
  const baseRec = makeInteraction("ledger-1");
  const captured = applyInteractionEvent(baseRec, {
    type: "screenshot-captured",
    assetId: "a1",
    source: "primary",
  });
  const skipped = applyInteractionEvent(captured, {
    type: "settled-skipped",
    reason: "superseded-by:ledger-2",
  });
  assert.equal(
    skipped?.screenshot.settledSkippedReason,
    "superseded-by:ledger-2"
  );

  const settled = await waitForDomSettled({
    quietWindowMs: 40,
    maxWaitMs: 120,
  });
  assert.equal(settled.settled, true);
  assert.equal(settled.reason, "no-dom");
});
