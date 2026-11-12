import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { runTriageCli } from "../src/triage-cli/cli.ts";
import { clearPackCache } from "../src/triage-cli/pack/open.ts";
import {
  buildRealScreenshotZipBytes,
  buildRealSessionZipBytes,
} from "./helpers/triage-cli-fixture.ts";

test("triage-cli executes all 12 commands, exports screenshots on open_pack, and persists active pack across commands", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "bug-lens-cli-e2e-"));
  try {
    clearPackCache();
    const sessionZipPath = join(tempRoot, "web-bug-report-d6135e69.zip");
    const screenshotZipPath = join(
      tempRoot,
      "bug-lens-screenshot-2026-10-27.zip"
    );
    writeFileSync(sessionZipPath, buildRealSessionZipBytes());
    writeFileSync(screenshotZipPath, await buildRealScreenshotZipBytes());

    // 1. open_pack (session) — positional argument, extracts workspace & auto-locates scene image
    const openText = runTriageCli(["open_pack", sessionZipPath]);
    assert.match(openText, /Assignment Portal/);
    assert.match(openText, /勾选 Form A 的 standby 后取消勾选/);
    assert.match(openText, /- \*\*Workspace\*\*:/);
    assert.match(openText, /INDEX\.md/);
    assert.match(openText, /savedImagePath/);

    // 1b. read_pack_file supports workspace artifacts (INDEX.md & data/session-data.json)
    const indexText = runTriageCli(["read_pack_file", "INDEX.md"]);
    assert.match(indexText, /# Bug Lens Evidence Workspace Index/);
    const derivedJsonText = runTriageCli([
      "read_pack_file",
      "data/session-data.json",
      "--jsonPath",
      "summary.title",
    ]);
    assert.match(derivedJsonText, /Assignment Portal/);

    // 2. get_scene (omitting --pack, using cached session pack)
    const sceneText = runTriageCli(["get_scene"]);
    assert.match(sceneText, /ssd_a_container/);
    assert.match(sceneText, /Saved to:/);

    // 3. timeline (with --around scene:1 and --windowMs)
    const tlText = runTriageCli([
      "timeline",
      "--around",
      "scene:1",
      "--windowMs",
      "15000",
    ]);
    assert.match(tlText, /Form A Standby/);

    // 4. query_console
    const conText = runTriageCli(["query_console", "--level", "error"]);
    assert.match(conText, /editor\.vue:341/);

    // 5. query_network
    const netText = runTriageCli(["query_network", "--status", "failed"]);
    assert.match(netText, /500/);

    // 6. get_request with jsonPath
    const reqText = runTriageCli([
      "get_request",
      "20535.366",
      "--jsonPath",
      "data.definition.form.elements[id=ssd_a]",
    ]);
    assert.match(reqText, /standby_window/);

    // 7. get_interactions
    const intText = runTriageCli(["get_interactions", "--includeScreenshot"]);
    assert.match(intText, /AP-T4001/);

    // 8. get_framework_state
    const fwText = runTriageCli([
      "get_framework_state",
      "--component",
      "BpmSelectFromField",
    ]);
    assert.match(fwText, /BpmSelectFromFieldEditor/);

    // 9. search_pack (session pack)
    const searchText = runTriageCli(["search_pack", "STANDBY_CONFIG_MISSING"]);
    assert.match(searchText, /network-body/);

    // 10. open_pack on screenshot pack -> switches active pack and exports screenshot.jpg
    const openSsText = runTriageCli(["open_pack", screenshotZipPath]);
    assert.match(openSsText, /Layout & Overflow Diagnostics/);
    assert.match(openSsText, /CSS Cascade Index/);
    assert.match(openSsText, /word-break: keep-all/);
    const savedMatch = /Saved to `([^`]+screenshot\.jpg)`/.exec(openSsText);
    assert.ok(
      savedMatch,
      "Expected screenshot.jpg to be exported on open_pack"
    );
    assert.equal(existsSync(savedMatch![1]!), true);

    // 11. get_screenshot (omitting --pack)
    const ssImgText = runTriageCli(["get_screenshot", "--kind", "screenshot"]);
    assert.match(ssImgText, /call read_file/);

    // get_scene on screenshot pack with selector & cssProperty
    const ssSceneText = runTriageCli([
      "get_scene",
      "--selector",
      "submit-btn",
      "--cssProperty",
      "word-break",
      "--includeImage",
      "false",
    ]);
    assert.match(ssSceneText, /common\.css/);
    assert.match(ssSceneText, /word-break: keep-all/);

    const ssSearchText = runTriageCli(["search_pack", "keep-all"]);
    assert.match(ssSearchText, /\[cascade-rule\]/);

    // 12. read_pack_file with jsonPath
    const readText = runTriageCli([
      "read_pack_file",
      "dom-context.json",
      "--jsonPath",
      "anchors[0].intentFlags.textComment",
    ]);
    assert.match(readText, /按钮点击后无反应/);

    // 13. extract_pack
    const extDir = join(tempRoot, "extracted");
    const extText = runTriageCli([
      "extract_pack",
      "--pack",
      sessionZipPath,
      "--dest",
      extDir,
    ]);
    assert.match(extText, /reproduce\.spec\.ts/);
  } finally {
    clearPackCache();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("triage-cli handles edge cases: missing scene, out-of-range framework state, budget truncation, and format=json", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "bug-lens-cli-edge-"));
  try {
    clearPackCache();
    const sessionZipPath = join(tempRoot, "session.zip");
    writeFileSync(sessionZipPath, buildRealSessionZipBytes());

    runTriageCli(["open_pack", sessionZipPath]);

    // 1. SCENE_NOT_FOUND
    assert.throws(
      () => runTriageCli(["get_scene", "--sceneIndex", "999"]),
      /SCENE_NOT_FOUND: Scene "999" not found/
    );

    // 2. FRAMEWORK_STATE_NOT_FOUND
    assert.throws(
      () => runTriageCli(["get_framework_state", "--index", "999"]),
      /FRAMEWORK_STATE_NOT_FOUND: Index 999 out of range/
    );

    // 3. maxChars truncation
    const truncatedText = runTriageCli(["query_console", "--maxChars", "250"]);
    assert.match(truncatedText, /\[Truncated to 250 chars/);

    // 4. format=json
    const jsonOut = JSON.parse(
      runTriageCli(["open_pack", sessionZipPath, "--format", "json"])
    );
    assert.equal(jsonOut.kind, "session");
    assert.equal(jsonOut.filesCount, 14);
    assert.ok(jsonOut.issueScenes.length >= 1);

    const sceneJson = JSON.parse(
      runTriageCli(["get_scene", "--format", "json", "--includeImage", "false"])
    );
    assert.equal(
      sceneJson.narrative.actual,
      "勾选 Form A 的 standby 后取消勾选，3 个选择窗口全部消失"
    );

    const netJson = JSON.parse(
      runTriageCli(["query_network", "--status", "failed", "--format", "json"])
    );
    assert.equal(netJson.matchedCount, 1);
    assert.equal(netJson.items[0].status, 500);
  } finally {
    clearPackCache();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("security invariant: triage-cli source files do not import or invoke outbound network clients", () => {
  const srcRoot = resolve(import.meta.dirname, "../src/triage-cli");
  const forbidden = /\b(?:node:http|node:https|node:net|fetch\s*\()/;

  function scanDir(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(full);
      } else if (entry.name.endsWith(".ts")) {
        const content = readFileSync(full, "utf8");
        assert.equal(
          forbidden.test(content),
          false,
          `Forbidden network reference found in ${full}`
        );
      }
    }
  }

  scanDir(srcRoot);
});
