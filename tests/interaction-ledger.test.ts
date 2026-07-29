import assert from "node:assert/strict";
import test from "node:test";

import {
  applyInteractionEvent,
  type InteractionEvent
} from "../src/domain/interaction-ledger.ts";
import type { InteractionRecord } from "../src/shared/protocol.ts";

function interaction(status: InteractionRecord["status"]): InteractionRecord {
  return {
    id: "interaction-1",
    sessionId: "session-1",
    kind: "click",
    status,
    createdAt: 1_000,
    page: { url: "https://example.test", title: "Example", frameId: 0 },
    input: { pointerType: "mouse", button: 0, isTrusted: true },
    coordinates: {
      clientX: 10,
      clientY: 20,
      pageX: 10,
      pageY: 20,
      scrollX: 0,
      scrollY: 0,
      devicePixelRatio: 1,
      viewport: { width: 1280, height: 720 }
    },
    element: {
      tagName: "button",
      classNames: [],
      attributes: {},
      boundingBox: { x: 0, y: 0, width: 100, height: 40 },
      locators: []
    },
    screenshot: { status: "pending" }
  };
}

function applySequence(events: InteractionEvent[]): InteractionRecord | undefined {
  return events.reduce<InteractionRecord | undefined>(
    (current, event) => applyInteractionEvent(current, event),
    undefined
  );
}

test("a late screenshot cannot downgrade a confirmed interaction", () => {
  const candidate = interaction("candidate");
  const confirmed = { ...candidate, status: "confirmed" as const, confirmedAt: 1_050 };

  const result = applySequence([
    { type: "candidate", interaction: candidate },
    { type: "confirmed", interaction: confirmed },
    { type: "screenshot-captured", dataUrl: "data:image/png;base64,AA==", source: "primary" }
  ]);

  assert.equal(result?.status, "confirmed");
  assert.equal(result?.confirmedAt, 1_050);
  assert.deepEqual(result?.screenshot, {
    status: "captured",
    source: "primary",
    dataUrl: "data:image/png;base64,AA=="
  });
});

test("a cancelled candidate stays cancelled when its screenshot finishes", () => {
  const result = applySequence([
    { type: "candidate", interaction: interaction("candidate") },
    { type: "cancelled" },
    { type: "screenshot-captured", dataUrl: "data:image/png;base64,AA==", source: "primary" }
  ]);

  assert.equal(result?.status, "cancelled");
  assert.equal(result?.screenshot.status, "pending");
});

test("confirmation preserves a screenshot that completed first", () => {
  const candidate = interaction("candidate");
  const confirmed = { ...candidate, status: "confirmed" as const, confirmedAt: 1_050 };
  const result = applySequence([
    { type: "candidate", interaction: candidate },
    { type: "screenshot-captured", dataUrl: "data:image/png;base64,AA==", source: "primary" },
    { type: "confirmed", interaction: confirmed }
  ]);

  assert.equal(result?.status, "confirmed");
  assert.equal(result?.screenshot.status, "captured");
});

test("a cancellation tombstone prevents a late candidate from reappearing", () => {
  const candidate = interaction("candidate");
  const result = applySequence([
    { type: "cancelled", interaction: candidate },
    { type: "candidate", interaction: candidate }
  ]);

  assert.equal(result?.status, "cancelled");
});

test("a late candidate cannot downgrade a confirmed-only interaction", () => {
  const candidate = interaction("candidate");
  const confirmed = { ...candidate, status: "confirmed" as const, confirmedAt: 1_050 };
  const result = applySequence([
    { type: "confirmed", interaction: confirmed },
    { type: "candidate", interaction: candidate }
  ]);

  assert.equal(result?.status, "confirmed");
  assert.equal(result?.confirmedAt, 1_050);
});

test("a cancellation cannot be resurrected by a late confirmation", () => {
  const candidate = interaction("candidate");
  const confirmed = { ...candidate, status: "confirmed" as const, confirmedAt: 1_050 };
  const result = applySequence([
    { type: "cancelled", interaction: candidate },
    { type: "confirmed", interaction: confirmed }
  ]);

  assert.equal(result?.status, "cancelled");
});
