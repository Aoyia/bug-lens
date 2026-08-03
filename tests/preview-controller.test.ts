import assert from "node:assert/strict";
import test from "node:test";

import { PreviewController } from "../src/preview/preview-controller.ts";
import type {
  ConsoleEntry,
  InteractionRecord,
  NetworkEntry,
} from "../src/shared/protocol.ts";

test("preview selection applies, persists, and restores exclusions by evidence kind", () => {
  const controller = new PreviewController();
  controller.loadSelection({
    sessionId: "session",
    excludedInteractionIds: ["interaction-1"],
    excludedConsoleEntryIds: ["console-1"],
    excludedNetworkEntryIds: ["network-1"],
    updatedAtEpochMs: 1,
  });
  const interactions = [
    { id: "interaction-1" },
    { id: "interaction-2" },
  ] as InteractionRecord[];
  const consoleEntries = [
    { id: "console-1" },
    { id: "console-2" },
  ] as ConsoleEntry[];
  const networkEntries = [
    { id: "network-1" },
    { id: "network-2" },
  ] as NetworkEntry[];
  assert.deepEqual(
    controller.includedInteractions(interactions).map((item) => item.id),
    ["interaction-2"]
  );
  assert.deepEqual(
    controller.includedConsoleEntries(consoleEntries).map((item) => item.id),
    ["console-2"]
  );
  assert.deepEqual(
    controller.includedNetworkEntries(networkEntries).map((item) => item.id),
    ["network-2"]
  );
  assert.equal(controller.totalExcluded(), 3);
  controller.restore("console");
  assert.equal(controller.excludedCount("console"), 0);
  assert.deepEqual(controller.toSelection("session").excludedInteractionIds, [
    "interaction-1",
  ]);
});
