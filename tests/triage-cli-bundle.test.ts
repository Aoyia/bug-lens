import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
// @ts-ignore
import { buildTriageSkillCli } from "../scripts/build.mjs";
import {
  buildRealScreenshotZipBytes,
  buildRealSessionZipBytes,
} from "./helpers/triage-cli-fixture.ts";

const BUNDLE_PATH = resolve(
  import.meta.dirname,
  "../.agents/skills/bug-lens-triage/scripts/bug-lens-cli.mjs"
);

function runCliInSubprocess(
  args: string[],
  options: {
    workspaceDir: string;
    scriptPath?: string;
  }
): { stdout: string; stderr: string; status: number } {
  const targetScript = options.scriptPath ?? BUNDLE_PATH;
  const res = spawnSync(process.execPath, [targetScript, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      BUG_LENS_CLI_WORKSPACE: options.workspaceDir,
    },
  });
  return {
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
    status: res.status ?? 0,
  };
}

test("Bundle execution: session pack workflow with cross-process cached state", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "bug-lens-bundle-session-"));
  const workspaceDir = join(tempRoot, "workspace");
  try {
    const sessionZipPath = join(tempRoot, "web-bug-report-test.zip");
    writeFileSync(sessionZipPath, buildRealSessionZipBytes());

    // 1. open_pack
    const openRes = runCliInSubprocess(["open_pack", sessionZipPath], {
      workspaceDir,
    });
    assert.equal(openRes.status, 0);
    assert.match(openRes.stdout, /# Bug Lens Evidence Pack \(kind: session\)/);
    assert.match(openRes.stdout, /- \*\*Session ID\*\*:/);
    assert.match(openRes.stdout, /savedImagePath/);

    const savedImgMatch = /- \*\*savedImagePath\*\*: `([^`]+)`/.exec(
      openRes.stdout
    );
    assert.ok(savedImgMatch, "Expected savedImagePath in open_pack stdout");
    const exportedImgPath = savedImgMatch![1]!;
    assert.ok(
      existsSync(exportedImgPath),
      `Exported image must exist at ${exportedImgPath}`
    );
    assert.ok(statSync(exportedImgPath).size > 0);

    // 2. query_network --status failed (omitting --pack, using cross-process .current-pack state)
    const netRes = runCliInSubprocess(["query_network", "--status", "failed"], {
      workspaceDir,
    });
    assert.equal(netRes.status, 0);
    assert.match(netRes.stdout, /500/);
    assert.match(netRes.stdout, /POST/);
    assert.match(netRes.stdout, /bpm\/standby\/options/);

    // 3. timeline --around scene:1 --windowMs 15000
    const tlRes = runCliInSubprocess(
      ["timeline", "--around", "scene:1", "--windowMs", "15000"],
      { workspaceDir }
    );
    assert.equal(tlRes.status, 0);
    assert.match(tlRes.stdout, /# Unified Timeline/);
    assert.match(tlRes.stdout, /Form A Standby/);

    // 4. get_scene --includeImage false
    const sceneRes = runCliInSubprocess(
      ["get_scene", "--includeImage", "false"],
      { workspaceDir }
    );
    assert.equal(sceneRes.status, 0);
    assert.match(sceneRes.stdout, /# Issue Scene \[0\]/);
    assert.match(sceneRes.stdout, /ssd_a_container/);

    // 5. get_request
    const reqRes = runCliInSubprocess(
      ["get_request", "20535.366", "--jsonPath", "data.definition.form.name"],
      { workspaceDir }
    );
    assert.equal(reqRes.status, 0);
    assert.match(reqRes.stdout, /bd_module_professional_assignment_portal/);

    // 6. get_framework_state
    const fwRes = runCliInSubprocess(
      ["get_framework_state", "--component", "BpmSelectFromField"],
      { workspaceDir }
    );
    assert.equal(fwRes.status, 0);
    assert.match(fwRes.stdout, /BpmSelectFromFieldEditor/);

    // 7. search_pack
    const searchRes = runCliInSubprocess(
      ["search_pack", "STANDBY_CONFIG_MISSING"],
      { workspaceDir }
    );
    assert.equal(searchRes.status, 0);
    assert.match(searchRes.stdout, /\[network-body\]/);

    // 8. get_interactions
    const intRes = runCliInSubprocess(["get_interactions"], {
      workspaceDir,
    });
    assert.equal(intRes.status, 0);
    assert.match(intRes.stdout, /\[click\]/);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("Bundle execution: screenshot pack workflow with cascade inspection and auto-exported image", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "bug-lens-bundle-ss-"));
  const workspaceDir = join(tempRoot, "workspace");
  try {
    const screenshotZipPath = join(
      tempRoot,
      "bug-lens-screenshot-2026-10-27.zip"
    );
    writeFileSync(screenshotZipPath, await buildRealScreenshotZipBytes());

    // 1. open_pack (screenshot pack)
    const openRes = runCliInSubprocess(["open_pack", screenshotZipPath], {
      workspaceDir,
    });
    assert.equal(openRes.status, 0);
    assert.match(
      openRes.stdout,
      /# Bug Lens Screenshot Pack \(kind: screenshot\)/
    );
    assert.match(openRes.stdout, /Layout & Overflow Diagnostics/);
    assert.match(openRes.stdout, /CSS Cascade Index/);

    const savedMatch = /Saved to `([^`]+screenshot\.jpg)`/.exec(openRes.stdout);
    assert.ok(savedMatch, "Expected screenshot.jpg exported path in stdout");
    const exportedShotPath = savedMatch![1]!;
    assert.ok(
      existsSync(exportedShotPath),
      `Exported screenshot must exist at ${exportedShotPath}`
    );
    assert.ok(statSync(exportedShotPath).size > 0);

    // 2. get_scene with selector & cssProperty
    const sceneRes = runCliInSubprocess(
      [
        "get_scene",
        "--selector",
        "submit-btn",
        "--cssProperty",
        "word-break",
        "--includeImage",
        "false",
      ],
      { workspaceDir }
    );
    assert.equal(sceneRes.status, 0);
    assert.match(sceneRes.stdout, /common\.css/);
    assert.match(sceneRes.stdout, /word-break: keep-all/);

    // 3. search_pack
    const searchRes = runCliInSubprocess(["search_pack", "keep-all"], {
      workspaceDir,
    });
    assert.equal(searchRes.status, 0);
    assert.match(searchRes.stdout, /\[cascade-rule\]/);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("Bundle execution: error handling and unknown command exits with code 1", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "bug-lens-bundle-err-"));
  const workspaceDir = join(tempRoot, "workspace");
  try {
    const res = runCliInSubprocess(["unknown_command_foo"], {
      workspaceDir,
    });
    assert.equal(res.status, 1);
    assert.match(
      res.stderr,
      /UNKNOWN_COMMAND: Unknown command "unknown_command_foo"/
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("Bundle execution: entry point executes properly when script is renamed or symlinked", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "bug-lens-bundle-rename-"));
  const workspaceDir = join(tempRoot, "workspace");
  try {
    const sessionZipPath = join(tempRoot, "session.zip");
    writeFileSync(sessionZipPath, buildRealSessionZipBytes());

    const renamedScript = join(tempRoot, "renamed-triage-tool.mjs");
    copyFileSync(BUNDLE_PATH, renamedScript);

    const res = runCliInSubprocess(["open_pack", sessionZipPath], {
      workspaceDir,
      scriptPath: renamedScript,
    });
    assert.equal(res.status, 0);
    assert.match(res.stdout, /# Bug Lens Evidence Pack \(kind: session\)/);
    assert.match(res.stdout, /savedImagePath/);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("Bundle freshness guard: committed bug-lens-cli.mjs matches fresh esbuild compilation", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "bug-lens-bundle-fresh-"));
  try {
    const tempCompiledCli = join(tempRoot, "fresh-cli.mjs");
    await buildTriageSkillCli(tempCompiledCli);

    const committedContent = readFileSync(BUNDLE_PATH, "utf8").replace(
      /\r\n/g,
      "\n"
    );
    const freshContent = readFileSync(tempCompiledCli, "utf8").replace(
      /\r\n/g,
      "\n"
    );

    assert.equal(
      freshContent,
      committedContent,
      "The committed bug-lens-cli.mjs differs from fresh compilation output. Run `node scripts/build.mjs` to synchronize."
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
