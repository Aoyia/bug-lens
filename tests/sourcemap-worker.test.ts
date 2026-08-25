import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { processBatchResolution } from "../src/sourcemap/internal/sourcemap.worker.js";
import { SourceMapWorkerClient } from "../src/sourcemap/internal/sourcemap-worker-client.js";

describe("SourceMapWorker & Client", () => {
  test("processes batch resolution with in-memory direct fallback", async () => {
    const client = new SourceMapWorkerClient();
    const results = await client.resolveBatch([
      {
        id: "entry_1",
        scriptUrl: "https://example.com/not-exist.js",
        line: 10,
        column: 5,
      },
    ]);

    assert.ok(results["entry_1"]);
    assert.equal(results["entry_1"].resolved, false);
    assert.equal(results["entry_1"].failureReason, "FETCH_FAILED");
  });

  test("handles empty items array gracefully", async () => {
    const client = new SourceMapWorkerClient();
    const results = await client.resolveBatch([]);
    assert.deepEqual(results, {});
  });
});
