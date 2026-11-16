import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  runCompareFramesTool,
  parseImageDimensions,
} from "../src/triage-cli/tools/compare-frames.ts";
import { runGetCssTool } from "../src/triage-cli/tools/get-css.ts";
import { runGetFrameworkStateTool } from "../src/triage-cli/tools/get-framework-state.ts";
import { runGetSceneTool } from "../src/triage-cli/tools/get-scene.ts";
import { runGetScreenshotTool } from "../src/triage-cli/tools/get-screenshot.ts";
import { runOpenPackTool } from "../src/triage-cli/tools/open-pack.ts";
import {
  buildRealScreenshotZipBytes,
  buildRealSessionZipBytes,
  buildRealV5SessionZipBytes,
} from "./helpers/triage-cli-fixture.ts";

const BUNDLE_PATH = resolve(
  import.meta.dirname,
  "../.agents/skills/bug-lens-triage/scripts/bug-lens-cli.mjs"
);
const SKILL_MD_PATH = resolve(
  import.meta.dirname,
  "../.agents/skills/bug-lens-triage/SKILL.md"
);

function runBundleCli(
  args: string[],
  workspaceDir: string
): { stdout: string; stderr: string; status: number } {
  const res = spawnSync(process.execPath, [BUNDLE_PATH, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      BUG_LENS_CLI_WORKSPACE: workspaceDir,
    },
  });
  return {
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
    status: res.status ?? 0,
  };
}

test("parseImageDimensions parses valid PNG IHDR and JPEG SOF0 frames", () => {
  // 24x48 PNG header + IHDR chunk
  const png = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x18, 0x00, 0x00, 0x00, 0x30,
  ]);
  assert.deepEqual(parseImageDimensions(png, "frame.png"), {
    width: 24,
    height: 48,
  });

  // 1280x720 JPEG SOI + APP0 + SOF0
  const jpg = new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11,
    0x08, 0x02, 0xd0, 0x05, 0x00, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01,
    0x03, 0x11, 0x01, 0xff, 0xd9,
  ]);
  assert.deepEqual(parseImageDimensions(jpg, "frame.jpg"), {
    width: 1280,
    height: 720,
  });
  assert.equal(
    parseImageDimensions(new Uint8Array([1, 2, 3, 4]), "bad.jpg"),
    undefined
  );
});

test("Schema v5 triage tools: get_css, get_screenshot (--settled/--final), compare_frames, get_framework_state, get_scene", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "bug-lens-cli-v5-"));
  const v5ZipPath = join(tempRoot, "v5-pack.zip");
  const v4ZipPath = join(tempRoot, "v4-pack.zip");
  const ssZipPath = join(tempRoot, "ss-pack.zip");

  try {
    writeFileSync(
      v5ZipPath,
      buildRealV5SessionZipBytes({ includeSettledAndFinal: true })
    );
    writeFileSync(v4ZipPath, buildRealSessionZipBytes());
    writeFileSync(ssZipPath, await buildRealScreenshotZipBytes());

    const openV5 = JSON.parse(
      runOpenPackTool({ pack: v5ZipPath, format: "json" })
    );
    assert.equal(openV5.packMode, "ai-minimal");
    assert.equal(openV5.summary.finalFramePath, "screenshots/final-frame.jpg");

    // get_css on v5 pack
    const cssV5Json = JSON.parse(
      runGetCssTool({
        pack: v5ZipPath,
        sceneIndex: 0,
        property: "display|overflow",
        format: "json",
      })
    );
    assert.equal(cssV5Json.computedLayoutStyles.display, "none");
    assert.equal(cssV5Json.computedLayoutStyles.overflow, "hidden");
    assert.equal(cssV5Json.computedLayoutStyles.zIndex, undefined);
    assert.equal(cssV5Json.winnerRules.length, 2);
    assert.equal(cssV5Json.triggerElement?.id, "open-btn");
    assert.equal(cssV5Json.relatedOverlays?.length, 1);

    const cssV5Text = runGetCssTool({ pack: v5ZipPath, scene: "0" });
    assert.match(cssV5Text, /Winner CSS Rules/i);
    assert.match(cssV5Text, /button#open-btn\.el-button/);

    // get_css fallback on v4 session pack & screenshot cascade pack
    const cssV4Json = JSON.parse(
      runGetCssTool({ pack: v4ZipPath, sceneIndex: 0, format: "json" })
    );
    assert.ok(cssV4Json.target || cssV4Json.computedLayoutStyles);

    const cssSsJson = JSON.parse(
      runGetCssTool({
        pack: ssZipPath,
        selector: "submit-btn",
        property: "word-break",
        format: "json",
      })
    );
    assert.ok(cssSsJson);

    // get_screenshot --step 1 --settled & --final
    const settledBlocks = runGetScreenshotTool({
      pack: v5ZipPath,
      step: 1,
      settled: true,
    });
    assert.ok(settledBlocks.some((b) => b.type === "image"));

    const finalBlocks = runGetScreenshotTool({
      pack: v5ZipPath,
      final: true,
    });
    assert.ok(finalBlocks.some((b) => b.type === "image"));

    // compare_frames: step-1 vs settled & step-1 vs final
    const cmpSettledBlocks = runCompareFramesTool({
      pack: v5ZipPath,
      step: 1,
      against: "settled",
      includeImage: true,
      format: "json",
    });
    assert.equal(cmpSettledBlocks.filter((b) => b.type === "image").length, 2);
    const cmpSettledJson = JSON.parse(
      (cmpSettledBlocks[0] as { type: "text"; text: string }).text
    );
    assert.equal(cmpSettledJson.identicalBytes, false);
    assert.deepEqual(cmpSettledJson.left.dimensions, {
      width: 1280,
      height: 800,
    });
    assert.deepEqual(cmpSettledJson.right.dimensions, {
      width: 1280,
      height: 800,
    });
    assert.equal(cmpSettledJson.resolutionChanged, false);

    const cmpFinalBlocks = runCompareFramesTool({
      pack: v5ZipPath,
      step: 1,
      final: true,
      includeImage: false,
      format: "json",
    });
    assert.equal(cmpFinalBlocks.filter((b) => b.type === "image").length, 0);
    const cmpFinalJson = JSON.parse(
      (cmpFinalBlocks[0] as { type: "text"; text: string }).text
    );
    assert.equal(cmpFinalJson.resolutionChanged, true);
    assert.deepEqual(cmpFinalJson.right.dimensions, {
      width: 1280,
      height: 720,
    });

    const cmpSameBlocks = runCompareFramesTool({
      pack: v5ZipPath,
      left: "screenshots/step-1.jpg",
      right: "screenshots/step-1.jpg",
      includeImage: false,
      format: "json",
    });
    const cmpSameJson = JSON.parse(
      (cmpSameBlocks[0] as { type: "text"; text: string }).text
    );
    assert.equal(cmpSameJson.identicalBytes, true);
    assert.equal(cmpSameJson.byteDelta, 0);

    // get_framework_state surfaces webStorageDiff & componentFile:componentLine
    const fwJson = JSON.parse(
      runGetFrameworkStateTool({ pack: v5ZipPath, format: "json" })
    );
    assert.equal(fwJson.totalStates, 2);
    assert.equal(fwJson.overview[1].hasWebStorageDiff, true);
    assert.deepEqual(fwJson.overview[1].localStorageKeys, ["locale"]);
    assert.deepEqual(fwJson.overview[1].sessionStorageKeys, ["step"]);
    assert.ok(fwJson.selectedState.webStorageDiff.localStorageChanged.locale);

    const fwCompText = runGetFrameworkStateTool({
      pack: v5ZipPath,
      component: "PortalDropdown",
    });
    assert.match(fwCompText, /PortalDropdown\.vue:88/);

    const fwDiffText = runGetFrameworkStateTool({
      pack: v5ZipPath,
      index: 1,
    });
    assert.match(fwDiffText, /Web Storage Diff/);
    assert.match(
      fwDiffText,
      /localStorage\(diff\)=1 \| sessionStorage\(diff\)=1/
    );
    assert.match(fwDiffText, /en-US/);
    assert.match(fwDiffText, /step/);

    // get_scene text output surfaces triggerElement, relatedOverlays & v5 CSS paths
    const sceneBlocks = runGetSceneTool({
      pack: v5ZipPath,
      includeImage: false,
    });
    const sceneText = (sceneBlocks[0] as { type: "text"; text: string }).text;
    assert.match(sceneText, /open-btn|triggerElement/);
    assert.match(sceneText, /dom-styles\.json/);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("Schema v5 triage CLI bundle & SKILL.md integration", () => {
  const skillMd = readFileSync(SKILL_MD_PATH, "utf8");
  assert.match(skillMd, /\bget_css\b/);
  assert.match(skillMd, /\bcompare_frames\b/);
  assert.match(skillMd, /--settled\b/);
  assert.match(skillMd, /--final\b/);
  assert.match(skillMd, /dom-styles\.json/);
  assert.match(skillMd, /webStorageDiff/);

  const tempRoot = mkdtempSync(join(tmpdir(), "bug-lens-bundle-v5-"));
  const workspaceDir = join(tempRoot, "workspace");
  const v5ZipPath = join(tempRoot, "web-bug-report-v5.zip");

  try {
    writeFileSync(
      v5ZipPath,
      buildRealV5SessionZipBytes({ includeSettledAndFinal: true })
    );

    const openRes = runBundleCli(["open_pack", v5ZipPath], workspaceDir);
    assert.equal(openRes.status, 0, openRes.stderr);

    const cssRes = runBundleCli(
      ["get_css", "--scene", "0", "--property", "display"],
      workspaceDir
    );
    assert.equal(cssRes.status, 0, cssRes.stderr);
    assert.match(cssRes.stdout, /display/);

    const settledRes = runBundleCli(
      ["get_screenshot", "--step", "1", "--settled"],
      workspaceDir
    );
    assert.equal(settledRes.status, 0, settledRes.stderr);

    const finalRes = runBundleCli(["get_screenshot", "--final"], workspaceDir);
    assert.equal(finalRes.status, 0, finalRes.stderr);

    const cmpRes = runBundleCli(
      ["compare_frames", "--step", "1", "--against", "settled"],
      workspaceDir
    );
    assert.equal(cmpRes.status, 0, cmpRes.stderr);

    const cmpFinalRes = runBundleCli(
      ["compare_frames", "--step", "1", "--final"],
      workspaceDir
    );
    assert.equal(cmpFinalRes.status, 0, cmpFinalRes.stderr);

    const fwRes = runBundleCli(
      ["get_framework_state", "--component", "PortalDropdown"],
      workspaceDir
    );
    assert.equal(fwRes.status, 0, fwRes.stderr);
    assert.match(fwRes.stdout, /PortalDropdown\.vue:88/);

    const fwDiffRes = runBundleCli(
      ["get_framework_state", "--index", "1"],
      workspaceDir
    );
    assert.equal(fwDiffRes.status, 0, fwDiffRes.stderr);
    assert.match(fwDiffRes.stdout, /Web Storage Diff/);
    assert.match(fwDiffRes.stdout, /en-US/);

    const cssDefaultRes = runBundleCli(["get_css"], workspaceDir);
    assert.equal(cssDefaultRes.status, 0, cssDefaultRes.stderr);
    assert.match(cssDefaultRes.stdout, /Winner CSS Rules/);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
