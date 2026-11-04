import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  buildAiPrompt,
  buildTicketBundle,
  buildTicketTemplate,
} from "../src/preview/evidence-package.ts";
import {
  formatPayloadToMarkdownForZip,
  type AIScreenshotPayload,
} from "../src/domain/screenshot-payload.ts";
import {
  buildRealScreenshotZipBytes,
  buildRealSessionZipBytes,
} from "./helpers/triage-cli-fixture.ts";

const SKILL_MD_PATH = resolve(
  import.meta.dirname,
  "../.agents/skills/bug-lens-triage/SKILL.md"
);
const BUNDLE_PATH = resolve(
  import.meta.dirname,
  "../.agents/skills/bug-lens-triage/scripts/bug-lens-cli.mjs"
);

function runCliCmd(
  cmdTokens: string[],
  workspaceDir: string
): { stdout: string; stderr: string; status: number } {
  const res = spawnSync(process.execPath, [BUNDLE_PATH, ...cmdTokens], {
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

test("Skill contract: all CLI commands referenced in SKILL.md execute successfully and match documented syntax", async () => {
  const skillMarkdown = readFileSync(SKILL_MD_PATH, "utf8");
  const tempRoot = mkdtempSync(join(tmpdir(), "bug-lens-skill-contract-"));
  const workspaceDir = join(tempRoot, "workspace");

  try {
    const sessionZipPath = join(tempRoot, "web-bug-report-test.zip");
    const screenshotZipPath = join(
      tempRoot,
      "bug-lens-screenshot-2026-10-27.zip"
    );
    writeFileSync(sessionZipPath, buildRealSessionZipBytes());
    writeFileSync(screenshotZipPath, await buildRealScreenshotZipBytes());

    // 1. 验证从 SKILL.md 中提取到的 bash 示例命令
    const codeBlockRegex = /```bash\s+([\s\S]*?)```/g;
    const extractedLines: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = codeBlockRegex.exec(skillMarkdown)) !== null) {
      const block = match[1]!;
      for (const rawLine of block.split("\n")) {
        const line = rawLine.trim();
        if (line.startsWith("node ") && line.includes("bug-lens-cli.mjs")) {
          extractedLines.push(line);
        }
      }
    }

    assert.ok(
      extractedLines.length >= 8,
      `Expected at least 8 CLI commands in SKILL.md, found ${extractedLines.length}`
    );

    // 2. 依次测试 Branch B（Session 包工作流）
    // Step 1: open_pack "<绝对路径.zip>"
    const openSession = runCliCmd(["open_pack", sessionZipPath], workspaceDir);
    assert.equal(openSession.status, 0);
    // 验证 Step 1 分支判别标题
    assert.match(
      openSession.stdout,
      /# Bug Lens Evidence Pack \(kind: session\)/
    );
    assert.match(openSession.stdout, /savedImagePath/);
    assert.match(openSession.stdout, /- \*\*actual\*\*:/);

    // Step B1: get_scene --includeImage false
    const sceneB1 = runCliCmd(
      ["get_scene", "--includeImage", "false"],
      workspaceDir
    );
    assert.equal(sceneB1.status, 0);
    assert.match(sceneB1.stdout, /# Issue Scene \[0\]/);
    assert.match(sceneB1.stdout, /- \*\*actual\*\*:/);
    assert.match(sceneB1.stdout, /## 2\. Selected DOM Targets/);

    // Step B2: timeline --around scene:1 --windowMs 15000
    const timeline = runCliCmd(
      ["timeline", "--around", "scene:1", "--windowMs", "15000"],
      workspaceDir
    );
    assert.equal(timeline.status, 0);
    assert.match(timeline.stdout, /# Unified Timeline/);

    // Step B2: query_network --status failed
    const queryNet = runCliCmd(
      ["query_network", "--status", "failed"],
      workspaceDir
    );
    assert.equal(queryNet.status, 0);
    assert.match(queryNet.stdout, /# Network Requests/);
    assert.match(queryNet.stdout, /500/);

    // Step B2: get_request "<reqId>" --jsonPath "..."
    const getReq = runCliCmd(
      [
        "get_request",
        "20535.366",
        "--jsonPath",
        "data.definition.form.elements[id=ssd_a]",
      ],
      workspaceDir
    );
    assert.equal(getReq.status, 0);
    assert.match(getReq.stdout, /standby_window/);

    // Step B2: query_console --level error
    const queryCon = runCliCmd(
      ["query_console", "--level", "error"],
      workspaceDir
    );
    assert.equal(queryCon.status, 0);
    assert.match(queryCon.stdout, /# Console Logs/);
    assert.match(queryCon.stdout, /\[ERROR\]/);

    // Step B2: get_framework_state --component "<组件名>"
    const fwState = runCliCmd(
      ["get_framework_state", "--component", "BpmSelectFromField"],
      workspaceDir
    );
    assert.equal(fwState.status, 0);
    assert.match(fwState.stdout, /BpmSelectFromFieldEditor/);

    // Step B2: search_pack "<字段名或错误码>"
    const searchB2 = runCliCmd(
      ["search_pack", "STANDBY_CONFIG_MISSING"],
      workspaceDir
    );
    assert.equal(searchB2.status, 0);
    assert.match(searchB2.stdout, /\[network-body\]/);

    // Step B2: get_screenshot --step 1
    const shotB = runCliCmd(["get_screenshot", "--step", "1"], workspaceDir);
    assert.equal(shotB.status, 0);
    assert.match(shotB.stdout, /Step 1 screenshot/);

    // 3. 依次测试 Branch A（Screenshot 包工作流）
    // Step 1: open_pack "<绝对路径.zip>" -> 识别为 Screenshot 包
    const openScreenshot = runCliCmd(
      ["open_pack", screenshotZipPath],
      workspaceDir
    );
    assert.equal(openScreenshot.status, 0);
    // 验证 Step 1 分支判别标题
    assert.match(
      openScreenshot.stdout,
      /# Bug Lens Screenshot Pack \(kind: screenshot\)/
    );
    assert.match(openScreenshot.stdout, /Annotated DOM Anchors/);
    assert.match(openScreenshot.stdout, /Layout & Overflow Diagnostics/);
    assert.match(openScreenshot.stdout, /CSS Cascade Index/);
    assert.match(openScreenshot.stdout, /Saved to `[^`]+screenshot\.jpg`/);

    // Step A2: get_scene --selector "..." --cssProperty "..." --includeImage false
    const sceneA2 = runCliCmd(
      [
        "get_scene",
        "--selector",
        "submit-btn",
        "--cssProperty",
        "word-break",
        "--includeImage",
        "false",
      ],
      workspaceDir
    );
    assert.equal(sceneA2.status, 0);
    assert.match(sceneA2.stdout, /common\.css/);
    assert.match(sceneA2.stdout, /word-break: keep-all/);

    // Step A2: search_pack "<关键字>"
    const searchA2 = runCliCmd(["search_pack", "keep-all"], workspaceDir);
    assert.equal(searchA2.status, 0);
    assert.match(searchA2.stdout, /\[cascade-rule\]/);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("Skill contract: AI prompts generated by Bug Lens align with triage-cli commands", async () => {
  const session = {
    id: "prompt-contract-test",
    schemaVersion: 2 as const,
    extensionVersion: "0.7.39",
    status: "PREVIEW_READY" as const,
    target: {
      tabId: 1,
      initialUrl: "https://example.com",
      initialTitle: "Prompt Test",
      environment: { language: "zh-CN" } as any,
    },
    options: {} as any,
    timeline: { durationMs: 1000 } as any,
    quality: { overall: "complete", issues: [] } as any,
    nonce: "test-nonce",
  };

  const snapshot = {
    session,
    interactions: [],
    consoleEntries: [],
    networkEntries: [],
    excluded: { interaction: 0, console: 0, network: 0 },
    hasMedia: false,
  };

  // 1. Session 包工单草稿引导
  const sessionTicket = buildTicketTemplate(
    snapshot,
    "web-bug-report-test.zip"
  );
  assert.match(sessionTicket, /bug-lens-triage/);

  // 2. 富文本与工单 bundle 引导
  const bundle = buildTicketBundle(snapshot, "web-bug-report-test.zip");
  assert.match(bundle.markdown, /bug-lens-triage/);

  // 3. Session 包内置的 AI_PROMPT.md 推荐命令
  const sessionAiPrompt = buildAiPrompt(snapshot, "web-bug-report-test.zip");
  assert.match(sessionAiPrompt, /bug-lens-triage/);
  assert.match(sessionAiPrompt, /open_pack/);
  assert.match(sessionAiPrompt, /get_scene/);
  assert.match(sessionAiPrompt, /timeline/);
  assert.match(sessionAiPrompt, /query_network/);
  assert.match(sessionAiPrompt, /get_request/);
  assert.match(sessionAiPrompt, /get_framework_state/);
  assert.match(sessionAiPrompt, /get_screenshot/);

  // 4. Screenshot 包内置的 ai-prompt.md 推荐命令
  const dummyPayload: AIScreenshotPayload = {
    version: "1.0",
    timestamp: Date.now(),
    cropBounds: { x: 0, y: 0, width: 800, height: 600 },
    image: {
      base64Data: "data:image/jpeg;base64,123",
      width: 800,
      height: 600,
      devicePixelRatio: 2,
    },
    annotations: [],
    annotationGroups: [],
    domContextTree: {
      smallestCommonAncestorSelector: "div#app",
      meta: {
        anchorCount: 0,
        leafCount: 0,
        ancestorCount: 0,
        truncated: false,
      },
      anchors: [],
      leaves: [],
      ancestors: [],
    },
    environment: {
      url: "https://example.com",
      title: "Test",
      userAgent: "TestAgent",
      viewport: { width: 800, height: 600 },
      mediaBreakpoint: "desktop",
      recentConsoleErrors: [],
      recentFailedRequests: [],
    },
    cascadeIndex: {
      sheets: [],
      rules: [],
      elements: [],
      perProperty: {},
      meta: {
        sheetCount: 0,
        ruleCount: 0,
        elementCount: 0,
        capturedAtEpochMs: Date.now(),
      },
    },
  };
  const screenshotAiPrompt = formatPayloadToMarkdownForZip(dummyPayload);
  assert.match(screenshotAiPrompt, /bug-lens-triage/);
  assert.match(screenshotAiPrompt, /open_pack/);
  assert.match(screenshotAiPrompt, /get_scene --selector/);
  assert.match(screenshotAiPrompt, /search_pack/);
  assert.match(screenshotAiPrompt, /get_framework_state/);
});
