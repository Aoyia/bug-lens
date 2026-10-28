import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runGetFrameworkStateTool } from "../src/tools/get-framework-state.ts";
import { runGetRequestTool } from "../src/tools/get-request.ts";
import { runGetSceneTool } from "../src/tools/get-scene.ts";
import { runOpenPackTool } from "../src/tools/open-pack.ts";
import { runReadPackFileTool } from "../src/tools/read-pack-file.ts";
import {
  buildRealScreenshotZipBytes,
  buildRealSessionZipBytes,
} from "./fixtures/build-fixture.ts";

test("Contract: buildEvidencePackage export schema matches bug-lens-mcp reader expectations", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "bug-lens-contract-"));
  try {
    // 1. Explicit expectation pack
    const explicitPath = join(tempRoot, "explicit.zip");
    writeFileSync(
      explicitPath,
      buildRealSessionZipBytes({ expectedConfidence: "explicit" })
    );

    const overviewJson = JSON.parse(
      runOpenPackTool({ pack: explicitPath, format: "json" })
    );
    assert.equal(overviewJson.kind, "session");
    assert.equal(overviewJson.integrity.valid, true);
    assert.equal(overviewJson.issueScenes.length, 1);
    assert.equal(overviewJson.issueScenes[0].expectedConfidence, "explicit");
    assert.match(overviewJson.issueScenes[0].actual, /3 个选择窗口全部消失/);

    const sceneBlocks = runGetSceneTool({
      pack: explicitPath,
      format: "json",
      includeImage: false,
    });
    const sceneJson = JSON.parse(
      (sceneBlocks[0] as { type: "text"; text: string }).text
    );
    assert.equal(sceneJson.narrative.confidence, "explicit");
    assert.equal(sceneJson.targets[0].element.id, "ssd_a_container");

    const reqJson = JSON.parse(
      runGetRequestTool({
        pack: explicitPath,
        id: "20535.366",
        jsonPath: "data.definition.form.name",
        format: "json",
      })
    );
    assert.equal(
      reqJson.extractedJson,
      "bd_module_professional_assignment_portal"
    );

    const fwJson = JSON.parse(
      runGetFrameworkStateTool({
        pack: explicitPath,
        format: "json",
      })
    );
    assert.equal(fwJson.totalStates, 1);
    assert.deepEqual(fwJson.overview[0].components, [
      "BpmSelectFromFieldEditor",
      "BpmProcessForm",
    ]);

    // 2. Missing expectation pack must flag UNCAPTURED_EXPECTATION
    const missingPath = join(tempRoot, "missing-exp.zip");
    writeFileSync(
      missingPath,
      buildRealSessionZipBytes({ expectedConfidence: "missing" })
    );
    const missingSceneBlocks = runGetSceneTool({
      pack: missingPath,
      format: "json",
      includeImage: false,
    });
    const missingSceneJson = JSON.parse(
      (missingSceneBlocks[0] as { type: "text"; text: string }).text
    );
    assert.equal(missingSceneJson.narrative.confidence, "missing");
    assert.match(
      missingSceneJson.narrative.confidenceNotice,
      /UNCAPTURED_EXPECTATION/
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("Contract: buildScreenshotZipPackage export schema matches bug-lens-mcp screenshot reader expectations", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "bug-lens-ss-contract-"));
  try {
    const ssPath = join(tempRoot, "screenshot.zip");
    writeFileSync(ssPath, await buildRealScreenshotZipBytes());

    const overviewJson = JSON.parse(
      runOpenPackTool({ pack: ssPath, format: "json" })
    );
    assert.equal(overviewJson.kind, "screenshot");
    assert.equal(overviewJson.screenshotPath, "screenshot.jpg");
    assert.equal(
      overviewJson.smallestCommonAncestorSelector,
      "div#app > main.portal-view"
    );
    assert.equal(
      overviewJson.anchors[0].componentName,
      "AssignmentSubmitButton"
    );
    assert.equal(overviewJson.hasCascade, true);

    const cascadeRule = JSON.parse(
      runReadPackFileTool({
        pack: ssPath,
        path: "cascade.json",
        jsonPath: "rules[0].cssText",
      })
    );
    assert.equal(cascadeRule, "pointer-events: none;");

    const ssSceneBlocks = runGetSceneTool({
      pack: ssPath,
      format: "json",
      includeImage: true,
    });
    assert.equal(ssSceneBlocks.length, 3);
    const ssSceneJson = JSON.parse(
      (ssSceneBlocks[0] as { type: "text"; text: string }).text
    );
    assert.equal(ssSceneJson.kind, "screenshot");
    assert.deepEqual(ssSceneJson.textComments, ["按钮点击后无反应"]);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
