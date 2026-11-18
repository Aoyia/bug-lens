import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { zipSync, strToU8 } from "fflate";
import { classifyConsoleNoise } from "../src/domain/console-noise.ts";
import { normalizeExpected } from "../src/domain/issue-scene.ts";
import {
  isBenignStaticNoBodyRequest,
  isStaticAssetCandidate,
} from "../src/domain/network-filter.ts";
import { sanitizeExpectedStatement } from "../src/domain/privacy-policy.ts";
import {
  foldConsoleEntries,
  processNetworkForSchemaV5,
} from "../src/export/ai-pack-slimming.ts";
import {
  buildAiPrompt,
  buildEvidencePackageBundle,
  type EvidencePackageSnapshot,
} from "../src/preview/evidence-package.ts";
import { pruneCascadeIndex } from "../src/screenshot/probes/cascade-snapshot-collector.ts";
import type {
  CascadeIndex,
  CascadeRuleSource,
  ExpectedStatement,
  NetworkEntry,
  RecordingSession,
} from "../src/shared/protocol.ts";
import { runTriageCli } from "../src/triage-cli/cli.ts";
import { diffJsonValues } from "../src/triage-cli/format/json-diff.ts";
import {
  openPackFromBytes,
  clearPackCache,
} from "../src/triage-cli/pack/open.ts";
import { resolveSceneExpectation } from "../src/triage-cli/pack/narrative.ts";
import type { LoadedSessionPack } from "../src/triage-cli/pack/session-pack.ts";
import { queryScreenshotDomAndCascade } from "../src/triage-cli/query/cascade.ts";
import { queryConsole } from "../src/triage-cli/query/console.ts";
import { queryNetwork } from "../src/triage-cli/query/network.ts";
import { runCompareRequestsTool } from "../src/triage-cli/tools/compare-requests.ts";
import { runGetFrameworkStateTool } from "../src/triage-cli/tools/get-framework-state.ts";
import { runGetRequestTool } from "../src/triage-cli/tools/get-request.ts";
import { runGetSceneTool } from "../src/triage-cli/tools/get-scene.ts";
import { runOpenPackTool } from "../src/triage-cli/tools/open-pack.ts";
import { buildRealSessionZipBytes } from "./helpers/triage-cli-fixture.ts";

function buildRichSessionPackBytes(): Uint8Array {
  const baseZip = buildRealSessionZipBytes();
  void baseZip;
  const sessionData = {
    format: "bug-lens-evidence-pack",
    schemaVersion: 5,
    packMode: "ai-minimal",
    summary: {
      url: "https://app.example.com/checkout",
      title: "Checkout App",
      durationMs: 5000,
      privacyMode: "safe",
      quality: "complete",
    },
    session: {
      id: "sess-v5-audit",
      schemaVersion: 5,
      target: {
        initialUrl: "https://app.example.com/checkout",
        initialTitle: "Checkout App",
      },
      options: { privacyMode: "safe" },
      timeline: { startedAtEpochMs: 1700000000000, durationMs: 5000 },
      userNarrative: {
        actual: "点击保存按钮后提示参数校验失败",
        expected: "点击保存按钮后应成功提交表单并返回 200",
      },
    },
    interactions: [],
    consoleSummary: [
      {
        signature: "noise1111111",
        level: "error",
        text: "Another version of Vue Devtools seems to be installed. Please enable only one.",
        source: "consoleAPI",
        count: 3,
        isNoise: true,
        noiseCategory: "devtools-plugin",
        firstCreatedAt: 1700000000200,
        lastCreatedAt: 1700000000800,
        timeRangeMs: [200, 800],
      },
      {
        signature: "realerr22222",
        level: "error",
        text: "TypeError: Cannot read properties of null (reading 'price')",
        source: "runtime",
        count: 1,
        firstCreatedAt: 1700000001200,
        lastCreatedAt: 1700000001200,
        timeRangeMs: [1200, 1200],
      },
    ],
    networkEntries: [
      {
        id: "req-static-js",
        createdAt: 1700000000100,
        method: "GET",
        url: "https://cdn.example.com/assets/app.bundle.js",
        type: "Script",
        status: 200,
        durationMs: 12,
        isStaticAsset: true,
        isBenignStatic: true,
        response: {
          mimeType: "application/javascript",
          byteLength: 0,
          bodyStatus: "not-present",
        },
      },
      {
        id: "req-ok-1",
        createdAt: 1700000001000,
        method: "POST",
        url: "https://app.example.com/api/order/validate",
        type: "Fetch",
        status: 200,
        durationMs: 45,
        request: {
          byteLength: 42,
          body: JSON.stringify({ orderId: 100, mode: "draft" }),
        },
        response: {
          mimeType: "application/json",
          byteLength: 140,
          bodyStatus: "captured",
        },
      },
      {
        id: "req-fail-2",
        createdAt: 1700000002000,
        method: "POST",
        url: "https://app.example.com/api/order/validate",
        type: "Fetch",
        status: 422,
        durationMs: 65,
        request: {
          byteLength: 44,
          body: JSON.stringify({ orderId: 100, mode: "publish" }),
        },
        response: {
          mimeType: "application/json",
          byteLength: 160,
          bodyStatus: "captured",
        },
      },
      {
        id: "req-big-3",
        createdAt: 1700000002500,
        method: "GET",
        url: "https://app.example.com/api/order/schema",
        type: "XHR",
        status: 200,
        durationMs: 80,
        response: {
          mimeType: "application/json",
          byteLength: 6000,
          bodyStatus: "captured",
        },
      },
    ],
    issueScenes: [
      {
        id: "scene-note-fallback",
        scene: {
          id: "scene-note-fallback",
          observedAtEpochMs: 1700000002200,
          narrative: {
            actual: "提交后右上角弹窗报错",
            expected: {
              text: "",
              tags: ["无响应", "报错"],
              confidence: "tag-only",
            },
            note: "应当保存成功且跳转详情页",
          },
        },
      },
      {
        id: "scene-tag-only",
        scene: {
          id: "scene-tag-only",
          observedAtEpochMs: 1700000003200,
          narrative: {
            actual: "卡片文字被截断",
            expected: { text: "", tags: ["错位"], confidence: "tag-only" },
          },
        },
      },
    ],
    frameworkStates: [
      {
        id: "fw-1",
        capturedAtEpochMs: 1700000000500,
        trigger: "start",
        framework: "vue",
        snapshot: {
          targetComponent: {
            name: "ElButton",
            framework: "vue",
            props: { type: "primary" },
            parentComponents: [
              {
                componentName: "CheckoutForm",
                componentFile: "src/views/CheckoutForm.vue",
                data: { submitting: false, couponCode: "" },
              },
            ],
          },
        },
        webStorage: {
          localStorage: { theme: "light", draftId: "d1" },
          sessionStorage: { step: "1" },
        },
      },
      {
        id: "fw-2",
        capturedAtEpochMs: 1700000002100,
        trigger: "settled",
        framework: "vue",
        snapshot: {
          targetComponent: {
            name: "ElButton",
            framework: "vue",
            props: { type: "primary", disabled: true },
            parentComponents: [
              {
                componentName: "CheckoutForm",
                componentFile: "src/views/CheckoutForm.vue",
                data: { submitting: true, couponCode: "VIP50" },
              },
            ],
          },
        },
        webStorageDiff: {
          localStorageChanged: { draftId: "d2", removedKey: null },
          sessionStorageChanged: { step: "2" },
        },
      },
    ],
  };

  const hugeObj = {
    meta: { version: 2, locale: "zh-CN" },
    schema: {
      fields: Array.from({ length: 120 }, (_, i) => ({
        id: `field_${i}`,
        label: `Label ${i} ${"x".repeat(25)}`,
        visible: i % 2 === 0,
      })),
    },
    errors: [{ code: "E_MISSING_TAX", message: "taxRate is required" }],
  };

  const okBlob = JSON.stringify({
    code: 0,
    valid: true,
    items: [
      { id: 1, name: "Item A", price: 10 },
      { id: 2, name: "Item B", price: 20 },
    ],
  });
  const failBlob = JSON.stringify({
    code: 422,
    valid: false,
    items: [
      { id: 1, name: "Item A", price: 10 },
      { id: 2, name: "Item B", price: 99 },
    ],
  });
  const bigBlob = JSON.stringify(hugeObj);

  // Use CAS-like paths in networkDetails directly via bodyBlob.path for zip fixture
  const networkDetails = {
    "req-ok-1": {
      requestHeaders: {
        "X-Env": "staging",
        "Content-Type": "application/json",
      },
      responseHeaders: {
        "Content-Type": "application/json",
        "X-Trace": "ok-1",
      },
      bodyBlob: { path: "network/blobs/ok00000000000001.bin" },
    },
    "req-fail-2": {
      requestHeaders: { "X-Env": "prod", "Content-Type": "application/json" },
      responseHeaders: {
        "Content-Type": "application/json",
        "X-Trace": "fail-2",
      },
      bodyBlob: { path: "network/blobs/fail000000000002.bin" },
    },
    "req-big-3": {
      bodyBlob: { path: "network/blobs/big0000000000003.bin" },
    },
  };

  const manifest = {
    format: "bug-lens-evidence-pack",
    schemaVersion: 5,
    packMode: "ai-minimal",
    createdAtEpochMs: 1700000005000,
    sessionId: "sess-v5-audit",
    files: {},
    migration: { currentSchemaVersion: 5, supportedFrom: [1, 2, 3, 4, 5] },
  };

  return zipSync({
    "manifest.json": strToU8(JSON.stringify(manifest, null, 2)),
    "session-data.json": strToU8(JSON.stringify(sessionData, null, 2)),
    "network-details.json": strToU8(JSON.stringify(networkDetails, null, 2)),
    "network/blobs/ok00000000000001.bin": strToU8(okBlob),
    "network/blobs/fail000000000002.bin": strToU8(failBlob),
    "network/blobs/big0000000000003.bin": strToU8(bigBlob),
  });
}

test("Module A: normalizeExpected & sanitizeExpectedStatement preserve tag-only tags", () => {
  // 刻意传入缺少 confidence 的旧版部分载荷：normalizeExpected 应据 tags 补全为 tag-only
  const norm = normalizeExpected({
    text: "  ",
    tags: ["错位", "错位", "无响应"],
  } as ExpectedStatement);
  assert.ok(norm);
  assert.equal(norm.confidence, "tag-only");
  assert.deepEqual(norm.tags, ["错位", "无响应"]);
  assert.equal(norm.text, "");

  const sanitized = sanitizeExpectedStatement(
    { text: "", tags: ["报错"], confidence: "tag-only" },
    "safe"
  );
  assert.ok(sanitized);
  assert.equal(sanitized?.confidence, "tag-only");
  assert.deepEqual(sanitized?.tags, ["报错"]);

  const explicit = resolveSceneExpectation({
    actual: "a",
    expected: { text: "", tags: ["无响应"], confidence: "tag-only" },
    note: "应当保存成功",
  });
  assert.equal(explicit.confidence, "note-fallback");
  assert.equal(explicit.expectedText, "应当保存成功");
  assert.deepEqual(explicit.tags, ["无响应"]);

  const tagOnly = resolveSceneExpectation({
    actual: "b",
    expected: { text: "", tags: ["错位"], confidence: "tag-only" },
  });
  assert.equal(tagOnly.confidence, "tag-only");
  assert.equal(tagOnly.expectedText, "");
  assert.deepEqual(tagOnly.tags, ["错位"]);
});

test("Module A/B + C.1/C.2 CLI tools: narrative resolution, compare_requests, get_request --outline, framework --diff, noise & apiOnly", () => {
  clearPackCache();
  const prevWs = process.env.BUG_LENS_CLI_WORKSPACE;
  const tempRoot = mkdtempSync(join(tmpdir(), "bug-lens-v5-unit-"));
  process.env.BUG_LENS_CLI_WORKSPACE = join(tempRoot, "ws");
  const zipPath = join(tempRoot, "rich-v5-pack.zip");
  writeFileSync(zipPath, buildRichSessionPackBytes());
  const pack = openPackFromBytes(
    buildRichSessionPackBytes()
  ) as LoadedSessionPack;

  try {
    // 1. open_pack hides plugin noise in Top Console Errors & surfaces userNarrative + scene expectation
    const overview = runOpenPackTool({ pack: zipPath });
    assert.match(overview, /Session User Narrative/);
    assert.match(overview, /点击保存按钮后应成功提交表单并返回 200/);
    assert.match(overview, /confidence=note-fallback/);
    assert.match(overview, /confidence=tag-only/);
    assert.doesNotMatch(overview, /Another version of Vue Devtools/);
    assert.match(overview, /benign devtools\/extension noise entries hidden/);
    assert.match(overview, /1 benign 0B static/);

    // 2. query_console default hides devtools noise; --includeNoise shows it
    const hiddenConsole = queryConsole(pack, { levels: ["error"] });
    assert.equal(hiddenConsole.matchedCount, 1);
    assert.equal(hiddenConsole.hiddenNoiseCount, 3);
    const fullConsole = queryConsole(pack, {
      levels: ["error"],
      includeNoise: true,
    });
    assert.equal(fullConsole.matchedCount, 2);
    assert.ok(fullConsole.items.some((i) => i.isNoise));

    // 3. query_network deprioritizes static empty asset & --apiOnly filters it cleanly
    const allNet = queryNetwork(pack, {});
    assert.equal(allNet.matchedCount, 4);
    assert.equal(allNet.staticNoBodyCount, 1);
    assert.equal(allNet.items[allNet.items.length - 1]?.id, "req-static-js");
    const apiNet = queryNetwork(pack, { apiOnly: true });
    assert.equal(apiNet.matchedCount, 3);
    assert.equal(apiNet.hiddenStaticCount, 1);
    assert.equal(
      apiNet.items.some((r) => r.id === "req-static-js"),
      false
    );

    // 4. compare_requests diffs response/request/headers cleanly with array id alignment
    const diffRes = runCompareRequestsTool({
      pack: zipPath,
      left: "req-ok-1",
      right: "req-fail-2",
      part: "both",
    });
    assert.match(diffRes, /`items\[id="2"\]\.price` \| `20` \| `99`/);
    assert.match(diffRes, /`mode` \| `"draft"` \| `"publish"`/);
    assert.match(
      diffRes,
      /`requestHeaders\["X-Env"\]` \| `"staging"` \| `"prod"`/
    );

    // 5. get_request --outline & truncation auto-outline
    const outlineRes = runGetRequestTool({
      pack: zipPath,
      id: "req-big-3",
      outline: true,
    });
    assert.match(outlineRes, /"fields":\s*\{[\s\S]*?"_type": "Array\[120\]"/);
    assert.match(
      outlineRes,
      /\*\*Suggested jsonPath queries\*\*:.*`schema\.fields`/
    );
    const truncRes = runGetRequestTool({
      pack: zipPath,
      id: "req-big-3",
      bodyMaxChars: 120,
    });
    assert.match(
      truncRes,
      /Response JSON Outline \(auto-generated for truncated payload\)/
    );
    assert.match(truncRes, /Pass `jsonPath`/);

    // 6. get_framework_state --diff reconstructs webStorage across incremental diffs and unwraps parentComponents
    const fwDiff = runGetFrameworkStateTool({
      pack: zipPath,
      diff: true,
      compareFrom: 0,
      compareTo: 1,
    });
    assert.match(fwDiff, /# Framework State Diff/);
    assert.match(fwDiff, /\*\*ElButton\*\*/);
    assert.match(
      fwDiff,
      /\*\*CheckoutForm\*\* @ src\/views\/CheckoutForm\.vue/
    );
    assert.match(fwDiff, /`state\.submitting` \(changed\): `false` -> `true`/);
    assert.match(fwDiff, /`state\.couponCode` \(changed\): `""` -> `"VIP50"`/);
    assert.match(
      fwDiff,
      /`localStorage\.draftId` \(changed\): `"d1"` -> `"d2"`/
    );
    assert.match(fwDiff, /`sessionStorage\.step` \(changed\): `"1"` -> `"2"`/);

    // 7. get_scene surfaces note-fallback & tag-only clarity
    const scene0 = runGetSceneTool({
      pack: zipPath,
      sceneIndex: 0,
      includeImage: false,
    });
    assert.match(JSON.stringify(scene0), /应当保存成功且跳转详情页/);
    assert.match(JSON.stringify(scene0), /note-fallback/);

    // 8. CLI entrypoint smoke check for new commands & flags
    const cliDiff = runTriageCli([
      "compare_requests",
      "req-ok-1",
      "req-fail-2",
      "--pack",
      zipPath,
      "--part",
      "response",
    ]);
    assert.match(cliDiff, /`items\[id="2"\]\.price` \| `20` \| `99`/);
  } finally {
    clearPackCache();
    if (prevWs === undefined) delete process.env.BUG_LENS_CLI_WORKSPACE;
    else process.env.BUG_LENS_CLI_WORKSPACE = prevWs;
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("Module C.1 & C.2 producers: foldConsoleEntries & processNetworkForSchemaV5 track noise and static counts", () => {
  const base = 1700000000000;
  const cls = classifyConsoleNoise({
    text: "Another version of Vue Devtools seems to be installed. Please enable only one.",
    level: "error",
  });
  assert.equal(cls.isNoise, true);
  assert.equal(cls.category, "devtools-plugin");

  const folded = foldConsoleEntries(
    [
      {
        id: "1",
        createdAt: base + 10,
        level: "error",
        text: "Another version of Vue Devtools seems to be installed.",
        source: "consoleAPI",
      },
      {
        id: "2",
        createdAt: base + 20,
        level: "error",
        text: "Uncaught ReferenceError: foo is not defined",
        source: "runtime",
      },
    ],
    base
  );
  assert.equal(folded.metrics.noiseEntryCount, 1);
  assert.equal(folded.metrics.noiseSignatureCount, 1);
  assert.equal(folded.metrics.errorCount, 1);
  assert.equal(folded.consoleSummary[0]?.isNoise, true);

  assert.equal(
    isStaticAssetCandidate({ url: "https://cdn.test/main.chunk.js?v=1" }),
    true
  );
  assert.equal(
    isBenignStaticNoBodyRequest({
      url: "https://cdn.test/main.chunk.js",
      status: 200,
      byteLength: 0,
      bodyStatus: "not-present",
    }),
    true
  );
  assert.equal(
    isBenignStaticNoBodyRequest({
      url: "https://cdn.test/main.chunk.js",
      status: 404,
      byteLength: 0,
      bodyStatus: "not-present",
    }),
    false
  );

  const entries: NetworkEntry[] = [
    {
      id: "n1",
      sessionId: "s",
      createdAt: base + 50,
      url: "https://cdn.test/theme.css",
      method: "GET",
      type: "Stylesheet",
      status: 304,
      response: {
        mimeType: "text/css",
        bodyStatus: "not-present",
        byteLength: 0,
      },
    },
    {
      id: "n2",
      sessionId: "s",
      createdAt: base + 60,
      url: "https://api.test/submit",
      method: "POST",
      type: "Fetch",
      status: 200,
      response: {
        mimeType: "application/json",
        bodyStatus: "captured",
        body: '{"ok":true}',
        byteLength: 11,
      },
    },
  ];
  const netV5 = processNetworkForSchemaV5(entries, base);
  assert.equal(netV5.metrics.staticNoBodyCount, 1);
  assert.equal(netV5.networkEntries[0]?.isBenignStatic, true);
  assert.equal(netV5.networkEntries[1]?.isBenignStatic, undefined);
});

test("Module C.3: pruneCascadeIndex drops unreferenced sheets/rules and strips duplicate styleProps without breaking CLI queries", () => {
  const sheets = [
    { id: "S1", href: "https://cdn.test/used.css", rulesCount: 80 },
    { id: "S2", href: "https://cdn.test/unused-huge.css", rulesCount: 200 },
  ];
  const rules: CascadeRuleSource[] = Array.from({ length: 150 }, (_, idx) => ({
    id: `R_${idx}`,
    sheetId: idx === 12 || idx === 45 ? "S1" : "S2",
    selectorText:
      idx === 12 ? ".card-title" : idx === 45 ? "body" : `.unused-${idx}`,
    cssText:
      idx === 12
        ? ".card-title { word-break: keep-all; overflow: hidden; }"
        : idx === 45
          ? "body { font-size: 14px; }"
          : `.unused-${idx} { padding: 12px; color: red; }`,
    styleProps: (idx === 12
      ? { "word-break": "keep-all", overflow: "hidden" }
      : { padding: "12px", color: "red" }) as Record<string, string>,
  }));

  const fullIndex: CascadeIndex = {
    sheets,
    rules,
    elements: [
      {
        id: "E1",
        selector: "span.card-title",
        tagName: "span",
        matchedRuleIds: ["R_12"],
        inheritedRules: [
          {
            ancestorSelector: "body",
            ancestorTagName: "body",
            ruleId: "R_45",
            inheritedProps: { "font-size": "14px" },
          },
        ],
      },
    ],
    perProperty: {
      "word-break": [
        { property: "word-break", value: "keep-all", sourceRuleId: "R_12" },
      ],
      padding: [{ property: "padding", value: "12px", sourceRuleId: "R_99" }],
    },
    meta: {
      sheetCount: 2,
      ruleCount: 150,
      elementCount: 1,
      capturedAtEpochMs: 1700000000000,
    },
  };

  const fullSize = JSON.stringify(fullIndex).length;
  const pruned = pruneCascadeIndex(fullIndex);
  const prunedSize = JSON.stringify(pruned).length;

  assert.equal(pruned.meta.pruned, true);
  assert.equal(pruned.meta.totalRuleCount, 150);
  assert.equal(pruned.meta.ruleCount, 2);
  assert.equal(pruned.sheets.length, 1);
  assert.equal(pruned.sheets[0]?.id, "S1");
  assert.equal(pruned.rules.length, 2);
  assert.equal(pruned.rules[0]?.styleProps, undefined);
  assert.equal(pruned.perProperty["padding"], undefined);
  assert.ok(
    prunedSize < fullSize * 0.1,
    `expected >90% shrink, got ${prunedSize}/${fullSize}`
  );

  const rendered = queryScreenshotDomAndCascade(undefined, pruned, {
    cssProperty: "word-break",
  });
  assert.ok(rendered.some((l) => l.includes("word-break: keep-all")));
});

test("Module D.2: buildAiPrompt and buildEvidencePackageBundle align accurately with ai-minimal vs full-viewer Schema v5", () => {
  const snapshot: EvidencePackageSnapshot = {
    session: {
      id: "sess-prompt-v5",
      schemaVersion: 2,
      extensionVersion: "0.7.41",
      status: "PREVIEW_READY",
      target: {
        tabId: 1,
        initialUrl: "https://example.test/form",
        initialTitle: "Form Page",
      },
      options: {
        captureAudio: false,
        captureVideo: false,
        captureScreenshots: true,
        captureConsole: true,
        captureNetwork: true,
        captureNetworkBodies: true,
        privacyMode: "safe",
        mediaTimesliceMs: 1000,
        maxResponseBodyBytes: 1024,
        maxSessionBytes: 1048576,
      },
      timeline: {
        createdAtEpochMs: 1000,
        startedAtEpochMs: 1000,
        durationMs: 2500,
      },
      quality: {
        overall: "complete",
        interactionCount: 0,
        confirmedInteractionCount: 0,
        primaryScreenshotCount: 0,
        fallbackScreenshotCount: 0,
        unavailableScreenshotCount: 0,
        consoleEntryCount: 0,
        networkEntryCount: 0,
        issues: [],
      },
      userNarrative: {
        actual: "保存时界面空白",
        expected: "保存后应回显保存成功提示",
      },
      nonce: "nonce",
    } as RecordingSession,
    interactions: [],
    consoleEntries: [],
    networkEntries: [],
    excluded: { interaction: 0, console: 0, network: 0 },
    hasMedia: false,
  };

  const minimalPrompt = buildAiPrompt(snapshot, "/tmp/pack.zip", {
    promptLanguage: "en-US",
    packMode: "ai-minimal",
  });
  assert.match(minimalPrompt, /session-data\.json/);
  assert.match(minimalPrompt, /compare_requests/);
  assert.match(
    minimalPrompt,
    /User-Reported Expected: 保存后应回显保存成功提示/
  );
  assert.match(minimalPrompt, /`report\.html` and raw video are omitted/);

  const minimalBundle = buildEvidencePackageBundle(snapshot, undefined, {
    packMode: "ai-minimal",
  });
  const minimalReadme = new TextDecoder().decode(
    minimalBundle.files.find((f) => f.name === "README.md")!.data
  );
  assert.match(minimalReadme, /Schema v5 · ai-minimal/);
  assert.match(minimalReadme, /screenshots\/step-N-settled\.jpg/);
  assert.doesNotMatch(minimalReadme, /Double-click `report\.html`/);

  const jsonDiffTest = diffJsonValues({ a: 1, b: [1, 2] }, { a: 2, b: [1, 3] });
  assert.equal(jsonDiffTest.totalChanges, 2);
  assert.equal(jsonDiffTest.changes.length, 2);
});
