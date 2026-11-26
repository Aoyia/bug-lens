import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
// @ts-ignore scripts/build.mjs has no .d.ts declaration file
import * as buildScript from "../scripts/build.mjs";

const { buildTriageSkillCli, getTriageCliBinaryName, getTriageCliBinaryPath } =
  buildScript;
import {
  buildRealScreenshotZipBytes,
  buildRealSessionZipBytes,
} from "./helpers/triage-cli-fixture.ts";

const BINARY_PATH: string = getTriageCliBinaryPath();

/** 确保原生 Rust CLI 二进制已编译就绪（避免单独运行单测时缺少产物）。 */
async function ensureNativeBinary(): Promise<string> {
  if (!existsSync(BINARY_PATH)) {
    await buildTriageSkillCli();
  }
  return BINARY_PATH;
}

function runCliInSubprocess(
  args: string[],
  options: {
    workspaceDir: string;
    binaryPath?: string;
  }
): { stdout: string; stderr: string; status: number } {
  const targetBin = options.binaryPath ?? BINARY_PATH;
  const res = spawnSync(targetBin, args, {
    encoding: "utf8",
    env: {
      ...process.env,
      BUG_LENS_CLI_WORKSPACE: options.workspaceDir,
    },
  });
  return {
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
    status: res.status ?? (res.error ? 1 : 0),
  };
}

test("Native Rust CLI: session pack workflow with cross-process cached state and all core commands", async () => {
  await ensureNativeBinary();
  const tempRoot = mkdtempSync(join(tmpdir(), "bug-lens-rust-session-"));
  const workspaceDir = join(tempRoot, "workspace");
  try {
    const sessionZipPath = join(tempRoot, "web-bug-report-test.zip");
    writeFileSync(sessionZipPath, buildRealSessionZipBytes());

    // 1. open_pack
    const openRes = runCliInSubprocess(["open_pack", sessionZipPath], {
      workspaceDir,
    });
    assert.equal(openRes.status, 0, openRes.stderr);
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

    // 1b. read_pack_file（工作区派生产物 INDEX.md 与 data/session-data.json）
    const indexRes = runCliInSubprocess(["read_pack_file", "INDEX.md"], {
      workspaceDir,
    });
    assert.equal(indexRes.status, 0, indexRes.stderr);
    assert.match(indexRes.stdout, /# Bug Lens Evidence Workspace Index/);

    const derivedRes = runCliInSubprocess(
      [
        "read_pack_file",
        "data/session-data.json",
        "--jsonPath",
        "summary.title",
      ],
      { workspaceDir }
    );
    assert.equal(derivedRes.status, 0, derivedRes.stderr);
    assert.match(derivedRes.stdout, /Assignment Portal/);

    // 2. query_network --status failed（省略 --pack，验证跨进程 .current-pack 状态持久化）
    const netRes = runCliInSubprocess(["query_network", "--status", "failed"], {
      workspaceDir,
    });
    assert.equal(netRes.status, 0, netRes.stderr);
    assert.match(netRes.stdout, /500/);
    assert.match(netRes.stdout, /POST/);
    assert.match(netRes.stdout, /bpm\/standby\/options/);

    // 3. timeline --around scene:1 --windowMs 15000
    const tlRes = runCliInSubprocess(
      ["timeline", "--around", "scene:1", "--windowMs", "15000"],
      { workspaceDir }
    );
    assert.equal(tlRes.status, 0, tlRes.stderr);
    assert.match(tlRes.stdout, /# Unified Timeline/);
    assert.match(tlRes.stdout, /Form A Standby/);

    // 4. get_scene --includeImage false
    const sceneRes = runCliInSubprocess(
      ["get_scene", "--includeImage", "false"],
      { workspaceDir }
    );
    assert.equal(sceneRes.status, 0, sceneRes.stderr);
    assert.match(sceneRes.stdout, /# Issue Scene \[0\]/);
    assert.match(sceneRes.stdout, /ssd_a_container/);

    // 5. get_request + jsonPath
    const reqRes = runCliInSubprocess(
      ["get_request", "20535.366", "--jsonPath", "data.definition.form.name"],
      { workspaceDir }
    );
    assert.equal(reqRes.status, 0, reqRes.stderr);
    assert.match(reqRes.stdout, /bd_module_professional_assignment_portal/);

    // 6. get_framework_state
    const fwRes = runCliInSubprocess(
      ["get_framework_state", "--component", "BpmSelectFromField"],
      { workspaceDir }
    );
    assert.equal(fwRes.status, 0, fwRes.stderr);
    assert.match(fwRes.stdout, /BpmSelectFromFieldEditor/);

    // 7. search_pack
    const searchRes = runCliInSubprocess(
      ["search_pack", "STANDBY_CONFIG_MISSING"],
      { workspaceDir }
    );
    assert.equal(searchRes.status, 0, searchRes.stderr);
    assert.match(searchRes.stdout, /\[network-body\]/);

    // 8. get_interactions
    const intRes = runCliInSubprocess(["get_interactions"], {
      workspaceDir,
    });
    assert.equal(intRes.status, 0, intRes.stderr);
    assert.match(intRes.stdout, /\[click\]/);

    // 9. get_screenshot --step 1
    const shotRes = runCliInSubprocess(["get_screenshot", "--step", "1"], {
      workspaceDir,
    });
    assert.equal(shotRes.status, 0, shotRes.stderr);
    assert.match(shotRes.stdout, /Step 1 screenshot/);

    // 10. query_console --level error & maxChars 截断
    const conRes = runCliInSubprocess(["query_console", "--level", "error"], {
      workspaceDir,
    });
    assert.equal(conRes.status, 0, conRes.stderr);
    assert.match(conRes.stdout, /editor\.vue:341/);

    const truncRes = runCliInSubprocess(
      ["query_console", "--maxChars", "250"],
      {
        workspaceDir,
      }
    );
    assert.equal(truncRes.status, 0, truncRes.stderr);
    assert.match(truncRes.stdout, /\[Truncated to 250 chars/);

    // 11. extract_pack --dest
    const customDest = join(tempRoot, "extracted");
    const extRes = runCliInSubprocess(["extract_pack", "--dest", customDest], {
      workspaceDir,
    });
    assert.equal(extRes.status, 0, extRes.stderr);
    assert.match(extRes.stdout, /reproduce\.spec\.ts/);

    // 12. format=json 输出契约验证
    const jsonRes = runCliInSubprocess(
      ["open_pack", sessionZipPath, "--format", "json"],
      { workspaceDir }
    );
    assert.equal(jsonRes.status, 0, jsonRes.stderr);
    const parsed = JSON.parse(jsonRes.stdout);
    assert.equal(parsed.kind, "session");
    assert.equal(parsed.filesCount, 14);
    assert.equal(parsed.integrity.valid, true);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("Native Rust CLI: screenshot pack workflow with cascade inspection and auto-exported image", async () => {
  await ensureNativeBinary();
  const tempRoot = mkdtempSync(join(tmpdir(), "bug-lens-rust-ss-"));
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
    assert.equal(openRes.status, 0, openRes.stderr);
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
    assert.equal(sceneRes.status, 0, sceneRes.stderr);
    assert.match(sceneRes.stdout, /common\.css/);
    assert.match(sceneRes.stdout, /word-break: keep-all/);

    // 3. search_pack
    const searchRes = runCliInSubprocess(["search_pack", "keep-all"], {
      workspaceDir,
    });
    assert.equal(searchRes.status, 0, searchRes.stderr);
    assert.match(searchRes.stdout, /\[cascade-rule\]/);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("Native Rust CLI: error handling and unknown command exits with code 1", async () => {
  await ensureNativeBinary();
  const tempRoot = mkdtempSync(join(tmpdir(), "bug-lens-rust-err-"));
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

test("Native Rust CLI: binary executes properly when copied/renamed and matches package version", async () => {
  await ensureNativeBinary();
  const tempRoot = mkdtempSync(join(tmpdir(), "bug-lens-rust-rename-"));
  const workspaceDir = join(tempRoot, "workspace");
  try {
    const sessionZipPath = join(tempRoot, "session.zip");
    writeFileSync(sessionZipPath, buildRealSessionZipBytes());

    const renamedName =
      process.platform === "win32"
        ? "renamed-triage-tool.exe"
        : "renamed-triage-tool";
    const renamedBin = join(tempRoot, renamedName);
    copyFileSync(BINARY_PATH, renamedBin);
    if (process.platform !== "win32") {
      chmodSync(renamedBin, 0o755);
    }

    const res = runCliInSubprocess(["open_pack", sessionZipPath], {
      workspaceDir,
      binaryPath: renamedBin,
    });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /# Bug Lens Evidence Pack \(kind: session\)/);
    assert.match(res.stdout, /savedImagePath/);

    const verRes = runCliInSubprocess(["--version"], {
      workspaceDir,
      binaryPath: renamedBin,
    });
    assert.equal(verRes.status, 0, verRes.stderr);
    const pkgVersion = JSON.parse(
      readFileSync(resolve(import.meta.dirname, "../package.json"), "utf8")
    ).version;
    assert.equal(verRes.stdout.trim(), `bug-lens-cli ${pkgVersion}`);

    // 确保纯 Rust 分发不再残留旧版 JS 产物
    const legacyJsPath = resolve(
      import.meta.dirname,
      "../.agents/skills/bug-lens-triage/scripts/bug-lens-cli.mjs"
    );
    assert.equal(
      existsSync(legacyJsPath),
      false,
      `Legacy JS CLI artifact must not exist at ${legacyJsPath}`
    );
    assert.ok(
      BINARY_PATH.endsWith(getTriageCliBinaryName()),
      "Binary path should end with platform binary name"
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("Native Rust CLI: P0/P1 regressions (UTF-8 args, symlink extract_pack, arg parser, strict JSON, unknown flag warning)", async () => {
  await ensureNativeBinary();
  const tempRoot = mkdtempSync(join(tmpdir(), "bug-lens-rust-p0p1-"));
  const workspaceDir = join(tempRoot, "workspace");
  try {
    const sessionZipPath = join(tempRoot, "中文报告-test.ZIP");
    writeFileSync(sessionZipPath, buildRealSessionZipBytes());

    const openRes = runCliInSubprocess(["open_pack", sessionZipPath], {
      workspaceDir,
    });
    assert.equal(openRes.status, 0, openRes.stderr);
    const wsDirMatch = /- \*\*Workspace\*\*: `([^`]+)`/.exec(openRes.stdout);
    assert.ok(wsDirMatch, "Expected Workspace path in open_pack stdout");
    const extractedWs = wsDirMatch![1]!;

    // 1. UTF-8 中文查询参数不 panic
    const cnSearch = runCliInSubprocess(["search_pack", "子模块"], {
      workspaceDir,
    });
    assert.equal(cnSearch.status, 0, cnSearch.stderr);
    assert.match(cnSearch.stdout, /# Search Hits for "子模块"/);

    // 2. 包含 `=` 的搜索词按位置参数解析，不被当作未知 flag
    const eqSearch = runCliInSubprocess(["search_pack", "ssd_a=1"], {
      workspaceDir,
    });
    assert.equal(eqSearch.status, 0, eqSearch.stderr);
    assert.match(eqSearch.stdout, /# Search Hits for "ssd_a=1"/);

    // 3. 布尔 flag 紧跟位置参数不吞参数
    const boolTl = runCliInSubprocess(
      ["timeline", "--includeAllConsole", "scene:1"],
      { workspaceDir }
    );
    assert.equal(boolTl.status, 0, boolTl.stderr);
    assert.match(boolTl.stdout, /Around scene "/);

    // 4. 未知 flag 向 stderr 输出警告且不吞后续位置参数
    const unknownFlagRes = runCliInSubprocess(
      ["query_network", "--apiOnly", "standby"],
      { workspaceDir }
    );
    assert.equal(unknownFlagRes.status, 0, unknownFlagRes.stderr);
    assert.match(
      unknownFlagRes.stderr,
      /Warning: unrecognized option "--apiOnly"/
    );
    assert.match(unknownFlagRes.stdout, /bpm\/standby\/options/);

    // 5. --dest 为指向工作区的符号链接时不发生自覆盖截断
    if (process.platform !== "win32") {
      const symlinkDest = join(tempRoot, "ws-symlink");
      symlinkSync(extractedWs, symlinkDest);
      const manifestBefore = readFileSync(join(extractedWs, "manifest.json"));
      const sessionBefore = readFileSync(
        join(extractedWs, "data/session-data.js")
      );
      const extSym = runCliInSubprocess(
        ["extract_pack", "--dest", symlinkDest],
        { workspaceDir }
      );
      assert.equal(extSym.status, 0, extSym.stderr);
      assert.deepEqual(
        readFileSync(join(extractedWs, "manifest.json")),
        manifestBefore
      );
      assert.deepEqual(
        readFileSync(join(extractedWs, "data/session-data.js")),
        sessionBefore
      );
    }

    // 6. 所有 --format json 输出（含图片导出与预算截断）均为合法 JSON
    for (const args of [
      ["open_pack", sessionZipPath, "--format", "json", "--maxChars", "300"],
      ["get_scene", "--includeImage", "true", "--format", "json"],
      ["get_interactions", "--includeScreenshot", "true", "--format", "json"],
      ["get_screenshot", "--step", "1", "--format", "json"],
      ["get_framework_state", "--format", "json"],
      ["get_request", "20535.366", "--format", "json"],
    ]) {
      const res = runCliInSubprocess(args, { workspaceDir });
      assert.equal(
        res.status,
        0,
        `Command ${args.join(" ")} failed: ${res.stderr}`
      );
      const parsed = JSON.parse(res.stdout);
      assert.ok(parsed && typeof parsed === "object");
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
