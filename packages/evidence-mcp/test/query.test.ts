import assert from "node:assert/strict";
import test from "node:test";
import { openPackFromBytes } from "../src/pack/open.ts";
import type { LoadedSessionPack } from "../src/pack/session-pack.ts";
import { queryConsole } from "../src/query/console.ts";
import { evaluateJsonPath } from "../src/query/json-path.ts";
import { inspectNetworkRequest, queryNetwork } from "../src/query/network.ts";
import { searchSessionPack } from "../src/query/search.ts";
import { queryTimeline } from "../src/query/timeline.ts";
import { buildRealSessionZipBytes } from "./fixtures/build-fixture.ts";

test("evaluateJsonPath supports property chains, indices, wildcards, and field filters", () => {
  const sample = {
    data: {
      definition: {
        form: {
          elements: [
            { id: "task_type", type: "select" },
            { id: "ssd_a", type: "select_form", opt_ass: { visible: false } },
          ],
        },
      },
    },
  };

  assert.equal(
    evaluateJsonPath(sample, "$.data.definition.form.elements[0].id"),
    "task_type"
  );
  assert.deepEqual(
    evaluateJsonPath(sample, "data.definition.form.elements[*].id"),
    ["task_type", "ssd_a"]
  );
  assert.deepEqual(
    evaluateJsonPath(sample, "data.definition.form.elements[id=ssd_a]"),
    [{ id: "ssd_a", type: "select_form", opt_ass: { visible: false } }]
  );
  assert.deepEqual(
    evaluateJsonPath(
      sample,
      "data.definition.form.elements[id=ssd_a].opt_ass.visible"
    ),
    [false]
  );
  assert.deepEqual(
    evaluateJsonPath(
      sample,
      "$.data.definition.form.elements[?(@.id == 'ssd_a')].type"
    ),
    ["select_form"]
  );
});

test("queryConsole, queryNetwork, inspectNetworkRequest, queryTimeline, and searchSessionPack work on session pack", () => {
  const pack = openPackFromBytes(
    buildRealSessionZipBytes()
  ) as LoadedSessionPack;

  // Console query
  const errors = queryConsole(pack, { levels: ["error"] });
  assert.equal(errors.matchedCount, 1);
  assert.match(errors.items[0].text, /standbyOptions/);
  assert.match(errors.items[0].sourceMapped ?? "", /editor\.vue:341/);

  // Network query prioritizes failed requests by default
  const netAll = queryNetwork(pack);
  assert.equal(netAll.matchedCount, 2);
  assert.equal(netAll.items[0].status, 500);
  assert.equal(netAll.items[0].isFailure, true);

  // Inspect split network body with jsonPath
  const inspected = inspectNetworkRequest(pack, "20535.366", {
    jsonPath: "data.definition.form.elements[id=ssd_a]",
  });
  assert.equal(inspected.details?.requestHeaders?.["X-Project-Id"], "100496");
  assert.ok(Array.isArray(inspected.extractedJson));
  assert.equal((inspected.extractedJson as any[])[0].id, "ssd_a");

  // Inspect with body truncation
  const truncated = inspectNetworkRequest(pack, "20535.366", {
    bodyMaxChars: 200,
  });
  assert.equal(truncated.bodyTruncated, true);
  assert.equal(truncated.bodyText?.length, 200);

  // Timeline around issue scene
  const tl = queryTimeline(pack, { windowMs: 15000 });
  assert.ok(tl.events.length >= 4);
  assert.ok(tl.events.some((e) => e.kind === "scene"));

  // Cross-pack search
  const hits = searchSessionPack(pack, { query: "STANDBY_CONFIG_MISSING" });
  assert.ok(hits.totalHits >= 1);
  assert.equal(hits.hits[0].scope, "network-body");
});
