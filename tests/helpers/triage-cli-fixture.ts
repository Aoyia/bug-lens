import { zipSync } from "fflate";
import { createHash } from "node:crypto";
import type { AIScreenshotPayload } from "../../src/domain/screenshot-payload.ts";
import { buildExportManifest } from "../../src/export/export-manifest.ts";
import {
  buildEvidencePackageBundle,
  type EvidencePackageSnapshot,
  type StaticReportAssets,
} from "../../src/preview/evidence-package.ts";
import { buildScreenshotZipPackage } from "../../src/screenshot/pipeline/screenshot-zip-builder.ts";
import type { RecordingSession } from "../../src/shared/protocol.ts";

// 1x1 最小有效 JPEG base64
const TINY_JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";

export function buildRealSessionZipBytes(overrides?: {
  schemaVersion?: number;
  omitNetworkDetails?: boolean;
  tamperSessionData?: boolean;
  expectedConfidence?: "explicit" | "missing";
  legacyColonBodyFilename?: boolean;
  includeMedia?: boolean;
}): Uint8Array {
  const t0 = 1793071570000;
  const session: RecordingSession = {
    id: "d6135e69-d761-40d5-bb97-f725928daca6",
    schemaVersion: 2,
    extensionVersion: "0.7.36",
    status: "PREVIEW_READY",
    target: {
      tabId: 1,
      initialUrl: "https://example.com/bpm/portal#/list",
      initialTitle: "Assignment Portal",
      environment: {
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/155.0",
        platform: "MacIntel",
        language: "zh-CN",
        screenWidth: 2560,
        screenHeight: 1440,
        devicePixelRatio: 2,
        viewportWidth: 1440,
        viewportHeight: 900,
        online: true,
        capturedAtEpochMs: t0,
      },
    },
    options: {
      captureAudio: false,
      captureVideo: true,
      captureScreenshots: true,
      captureConsole: true,
      captureNetwork: true,
      captureNetworkBodies: true,
      privacyMode: "safe",
      mediaTimesliceMs: 1000,
      maxResponseBodyBytes: 1_000_000,
      maxSessionBytes: 10_000_000,
    },
    timeline: {
      createdAtEpochMs: t0,
      startedAtEpochMs: t0,
      stoppedAtEpochMs: t0 + 30000,
      durationMs: 30000,
    },
    quality: {
      overall: "complete",
      interactionCount: 2,
      confirmedInteractionCount: 2,
      primaryScreenshotCount: 1,
      fallbackScreenshotCount: 0,
      unavailableScreenshotCount: 0,
      consoleEntryCount: 2,
      networkEntryCount: 2,
      issues: [],
    },
    nonce: "test-nonce",
  };

  // 构造超过拆分阈值的大 JSON body（含 elements 数组以测试 jsonPath 过滤）
  const largeFormElements = Array.from({ length: 120 }, (_, idx) => ({
    id: idx === 5 ? "ssd_a" : `field_${idx}`,
    type: idx === 5 ? "select_form" : "input",
    label: `Field Label ${idx} `.repeat(8),
    opt_ass: idx === 5 ? { target: "standby_window", visible: false } : null,
  }));
  const largeResponseBody = JSON.stringify({
    code: 200,
    data: {
      definition: {
        form: {
          name: "bd_module_professional_assignment_portal",
          elements: largeFormElements,
        },
      },
    },
  });

  const confidence = overrides?.expectedConfidence ?? "explicit";

  const snapshot: EvidencePackageSnapshot = {
    session,
    interactions: [
      {
        id: "int-1",
        sessionId: session.id,
        kind: "click",
        status: "confirmed",
        createdAt: t0 + 5000,
        page: {
          url: "https://example.com/bpm/portal#/list",
          title: "Assignment Portal",
          frameId: 0,
        },
        input: { pointerType: "mouse", button: 0, isTrusted: true },
        coordinates: {
          clientX: 120,
          clientY: 240,
          localX: 120,
          localY: 240,
          pageX: 120,
          pageY: 240,
          scrollX: 0,
          scrollY: 0,
          devicePixelRatio: 2,
          viewport: { width: 1440, height: 900 },
        },
        element: {
          tagName: "span",
          id: "checkbox-form-a",
          classNames: ["el-checkbox__label", "primary"],
          attributes: { "data-field": "ssd_a" },
          text: "Form A Standby",
          boundingBox: { x: 100, y: 220, width: 120, height: 32 },
          locators: [
            {
              kind: "css",
              expression: "#checkbox-form-a",
              matchCount: 1,
              stabilityScore: 0.95,
              reasons: ["id"],
            },
          ],
        },
        screenshot: {
          status: "captured",
          source: "primary",
          assetId: "asset-step-1",
          dataUrl: `data:image/jpeg;base64,${TINY_JPEG_BASE64}`,
        },
      },
      {
        id: "int-2",
        sessionId: session.id,
        kind: "input",
        status: "confirmed",
        createdAt: t0 + 8000,
        page: {
          url: "https://example.com/bpm/portal#/list",
          title: "Assignment Portal",
          frameId: 0,
        },
        input: {
          pointerType: "keyboard",
          button: 0,
          isTrusted: true,
          value: "AP-T4001",
        } as any,
        coordinates: {
          clientX: 150,
          clientY: 260,
          localX: 150,
          localY: 260,
          pageX: 150,
          pageY: 260,
          scrollX: 0,
          scrollY: 0,
          devicePixelRatio: 2,
          viewport: { width: 1440, height: 900 },
        },
        element: {
          tagName: "input",
          classNames: ["el-input__inner"],
          attributes: { value: "AP-T4001" },
          text: "",
          boundingBox: { x: 140, y: 250, width: 200, height: 32 },
          locators: [],
        },
        screenshot: {
          status: "unavailable",
        },
      },
    ],
    consoleEntries: [
      {
        id: "con-1",
        sessionId: session.id,
        createdAt: t0 + 6000,
        level: "warning",
        text: "Deprecated prop 'optAss' used in BpmSelectFromField",
        source: "console-api",
        url: "https://example.com/static/js/app.js",
        lineNumber: 142,
      },
      {
        id: "con-2",
        sessionId: session.id,
        createdAt: t0 + 9500,
        level: "error",
        text: "TypeError: Cannot read properties of undefined (reading 'standbyOptions')",
        source: "exception",
        url: "https://example.com/static/js/vendor.js",
        lineNumber: 8820,
        stackTrace: [
          {
            functionName: "updateStandby",
            url: "https://example.com/static/js/vendor.js",
            lineNumber: 8820,
            columnNumber: 12,
          },
        ],
        sourceMappedLocation: {
          resolved: true,
          originalFile: "src/components/bpmSelectFromField/editor.vue",
          originalLine: 341,
          originalColumn: 12,
          originalFunctionName: "updateStandby",
        },
      },
    ],
    networkEntries: [
      {
        // 含冒号 ID，还原 Chrome requestId 真实形态
        id: `${session.id}:20535.366`,
        sessionId: session.id,
        createdAt: t0 + 4000,
        url: "https://example.com/api/bpm/form/definition?form=pap",
        method: "GET",
        type: "XHR",
        status: 200,
        statusText: "OK",
        durationMs: 145,
        initiator: {
          type: "script",
          url: "https://example.com/static/js/app.js",
          lineNumber: 55,
        },
        requestHeaders: {
          Accept: "application/json",
          "X-Project-Id": "100496",
        },
        response: {
          mimeType: "application/json",
          headers: { "content-type": "application/json" },
          bodyStatus: "captured",
          body: largeResponseBody,
          byteLength: largeResponseBody.length,
          truncated: false,
        },
      },
      {
        id: `${session.id}:20535.401`,
        sessionId: session.id,
        createdAt: t0 + 9200,
        url: "https://example.com/api/bpm/standby/options?field=ssd_a",
        method: "POST",
        type: "Fetch",
        status: 500,
        statusText: "Internal Server Error",
        durationMs: 312,
        initiator: { type: "script" },
        requestHeaders: { "Content-Type": "application/json" },
        response: {
          mimeType: "application/json",
          headers: { "content-type": "application/json" },
          bodyStatus: "captured",
          body: JSON.stringify({
            error: "STANDBY_CONFIG_MISSING",
            field: "ssd_a",
          }),
          byteLength: 52,
          truncated: false,
        },
      },
    ],
    issueScenes: [
      {
        id: "scene-uuid-001",
        sessionId: session.id,
        status: "complete",
        observedAtEpochMs: t0 + 12000,
        selectionStartedAtEpochMs: t0 + 10000,
        committedAtEpochMs: t0 + 15000,
        sequenceContext: {
          anchorEpochMs: t0 + 10000,
          windowMs: 15000,
          interactions: [
            {
              id: "int-1",
              kind: "click",
              createdAt: t0 + 5000,
              offsetMs: -5000,
              tagName: "span",
              text: "Form A Standby",
            },
          ],
          consoleErrors: [
            {
              id: "con-2",
              createdAt: t0 + 9500,
              offsetMs: -500,
              level: "error",
              text: "TypeError: Cannot read properties of undefined (reading 'standbyOptions')",
            },
          ],
          networkFailures: [],
        },
        page: {
          url: "https://example.com/bpm/portal#/list",
          title: "Assignment Portal",
        },
        targets: [
          {
            capturedAtEpochMs: t0 + 10500,
            element: {
              tagName: "div",
              id: "ssd_a_container",
              classNames: ["bpm-select-form-field", "el-form-item__content"],
              attributes: {
                "form-name": "bd_module_professional_assignment_portal",
              },
              boundingBox: { x: 300, y: 400, width: 800, height: 50 },
              locators: [],
            },
            sanitizedHtml:
              '<div id="ssd_a_container" class="bpm-select-form-field"><div class="el-checkbox-group"></div></div>',
            ancestors: [
              {
                tagName: "div",
                id: "startProcess_ssd_a",
                classNames: ["el-form-item"],
              },
            ],
            computedStyle: { display: "flex", visibility: "visible" },
          },
        ],
        narrative: {
          actual: "勾选 Form A 的 standby 后取消勾选，3 个选择窗口全部消失",
          expected:
            confidence === "explicit"
              ? {
                  text: "仅取消当前行的 standby 选择窗口，其余窗口保持显示",
                  confidence: "explicit",
                }
              : {
                  text: "",
                  confidence: "missing",
                },
        },
        screenshot: {
          status: "captured",
          originalAssetId: "orig-1",
          annotatedAssetId: "anno-1",
        },
        issues: [],
      } as any,
    ],
    issueAssets: [
      {
        sceneId: "scene-uuid-001",
        kind: "issue-original",
        mimeType: "image/jpeg",
        bytes: new Uint8Array(Buffer.from(TINY_JPEG_BASE64, "base64")),
      },
      {
        sceneId: "scene-uuid-001",
        kind: "issue-annotated",
        mimeType: "image/jpeg",
        bytes: new Uint8Array(Buffer.from(TINY_JPEG_BASE64, "base64")),
      },
    ],
    frameworkStates: [
      {
        id: "fw-1",
        sessionId: session.id,
        capturedAtEpochMs: t0 + 9600,
        trigger: "issue-scene",
        page: {
          url: "https://example.com/bpm/portal#/list",
          title: "Assignment Portal",
          frameId: 0,
        },
        snapshot: {
          targetComponent: {
            framework: "vue",
            version: 2,
            componentName: "BpmSelectFromFieldEditor",
            props: { fieldId: "ssd_a", mode: "edit" },
            state: { standbyVisible: false, selectedForms: [] },
          },
          parentChain: [
            {
              framework: "vue",
              version: 2,
              componentName: "BpmProcessForm",
              props: { formName: "bd_module_professional_assignment_portal" },
            },
          ],
        },
        globalState: {
          __INITIAL_STATE__: { tenant: "buildingqm" },
        },
        webStorage: {
          localStorage: {
            USER_INFO: '{"user_name":"AP001"}',
          },
          sessionStorage: {
            ACTIVE_TAB: "list",
          },
          redactedValues: false,
        },
      },
    ],
    excluded: { interaction: 0, console: 0, network: 0 },
    hasMedia: false,
  };

  const reportAssets: StaticReportAssets = {
    html: "<!doctype html><title>Bug Lens</title>",
    script: "void 0;",
    styles: "body {}",
    icon: new Uint8Array([1, 2, 3]),
  };

  // Keep buildRealSessionZipBytes as the legacy v4 JS-wrapper archive fixture for v1-v4 backwards-compatibility tests.
  const bundle = buildEvidencePackageBundle(snapshot, reportAssets, {
    packMode: "full-viewer",
  });
  const zipEntries: Record<string, Uint8Array> = {};
  const integrityEntries: Record<
    string,
    { byteLength: number; sha256: string }
  > = {};

  const legacyNetworkBodies: Array<{ name: string; data: Uint8Array }> = [];
  const legacyBodyPathById = new Map<string, string>();
  for (const entry of snapshot.networkEntries) {
    if (entry.response?.body && entry.response.body.length > 4096) {
      const fileId = overrides?.legacyColonBodyFilename
        ? entry.id
        : entry.id.replace(/[^a-zA-Z0-9._-]/g, "_");
      const legacyName = `network/body-${fileId}.txt`;
      legacyBodyPathById.set(entry.id, legacyName);
      legacyNetworkBodies.push({
        name: legacyName,
        data: new TextEncoder().encode(entry.response.body),
      });
    }
  }

  for (const f of [...bundle.files, ...legacyNetworkBodies]) {
    if (
      f.name === "session-data.json" ||
      f.name === "network-details.json" ||
      f.name.startsWith("network/blobs/") ||
      /\/dom-(context|styles)\.json$/.test(f.name)
    ) {
      continue;
    }
    if (overrides?.omitNetworkDetails && f.name === "data/network-details.js") {
      continue;
    }
    const name = f.name;
    let data = f.data;
    if (name === "data/session-data.js" && legacyBodyPathById.size > 0) {
      const raw = new TextDecoder().decode(data);
      const parsed = JSON.parse(
        raw.replace(/^window\.__BUG_LENS_DATA__ = /, "").slice(0, -1)
      );
      if (Array.isArray(parsed.networkEntries)) {
        for (const ne of parsed.networkEntries) {
          const bp = legacyBodyPathById.get(ne.id);
          if (bp && ne.response) {
            ne.response.bodyPath = bp;
            delete ne.response.body;
          }
        }
      }
      data = new TextEncoder().encode(
        `window.__BUG_LENS_DATA__ = ${JSON.stringify(parsed, null, 2)};`
      );
    }
    zipEntries[name] = data;
    integrityEntries[name] = {
      byteLength: data.byteLength,
      sha256: createHash("sha256").update(data).digest("hex"),
    };
  }

  if (overrides?.includeMedia) {
    const mediaBytes = new Uint8Array(256);
    zipEntries["media/recording.webm"] = mediaBytes;
    integrityEntries["media/recording.webm"] = {
      byteLength: mediaBytes.byteLength,
      sha256: createHash("sha256").update(mediaBytes).digest("hex"),
    };
  }

  const manifest = buildExportManifest(session, integrityEntries);
  if (overrides?.schemaVersion !== undefined) {
    manifest.schemaVersion = overrides.schemaVersion;
  }
  zipEntries["manifest.json"] = new TextEncoder().encode(
    JSON.stringify(manifest, null, 2)
  );

  if (overrides?.tamperSessionData && zipEntries["data/session-data.js"]) {
    const orig = new TextDecoder().decode(zipEntries["data/session-data.js"]);
    zipEntries["data/session-data.js"] = new TextEncoder().encode(orig + "\n");
  }

  return zipSync(zipEntries);
}

export function buildRealV5SessionZipBytes(overrides?: {
  expectedConfidence?: "explicit" | "missing";
  includeSettledAndFinal?: boolean;
  /**
   * 打包模式：默认显式使用 "ai-minimal"，保证 CLI 契约测试继续覆盖精简包读取路径
   * （产品默认已反转为 full-viewer，不能依赖 buildEvidencePackageBundle 的隐式默认）。
   */
  packMode?: "ai-minimal" | "full-viewer";
}): Uint8Array {
  const t0 = 1793071570000;
  const session: RecordingSession = {
    id: "d6135e69-d761-40d5-bb97-f725928daca6",
    schemaVersion: 2,
    extensionVersion: "0.8.0",
    status: "PREVIEW_READY",
    target: {
      tabId: 1,
      initialUrl: "https://example.com/bpm/portal#/list",
      initialTitle: "Assignment Portal",
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
      maxResponseBodyBytes: 1_000_000,
      maxSessionBytes: 10_000_000,
    },
    timeline: {
      createdAtEpochMs: t0,
      startedAtEpochMs: t0,
      stoppedAtEpochMs: t0 + 12000,
      durationMs: 12000,
    },
    quality: {
      overall: "complete",
      interactionCount: 1,
      confirmedInteractionCount: 1,
      primaryScreenshotCount: 1,
      fallbackScreenshotCount: 0,
      unavailableScreenshotCount: 0,
      issueSceneCount: 1,
      partialIssueSceneCount: 0,
      consoleEntryCount: 3,
      networkEntryCount: 2,
      issues: [],
    },
    nonce: "test-nonce",
  };
  const tinyJpeg = new Uint8Array(Buffer.from(TINY_JPEG_BASE64, "base64"));
  const makeSyntheticJpeg = (
    width: number,
    height: number,
    tag: number
  ): Uint8Array =>
    new Uint8Array([
      0xff,
      0xd8,
      0xff,
      0xe0,
      0x00,
      0x10,
      0x4a,
      0x46,
      0x49,
      0x46,
      0x00,
      0x01,
      0x01,
      0x00,
      0x00,
      0x01,
      0x00,
      0x01,
      0x00,
      0x00,
      0xff,
      0xc0,
      0x00,
      0x11,
      0x08,
      (height >> 8) & 0xff,
      height & 0xff,
      (width >> 8) & 0xff,
      width & 0xff,
      0x03,
      0x01,
      0x22,
      0x00,
      0x02,
      0x11,
      0x01,
      0x03,
      0x11,
      0x01,
      0xff,
      0xda,
      0x00,
      0x08,
      0x01,
      0x01,
      0x00,
      0x00,
      0x3f,
      0x00,
      tag & 0xff,
      0xff,
      0xd9,
    ]);
  const sharedBody = JSON.stringify({
    code: 0,
    data: {
      definition: { form: { name: "bd_module_v5" } },
      pad: "a".repeat(2500),
    },
  });
  const snapshot: EvidencePackageSnapshot = {
    session,
    interactions: [
      {
        id: "int-1",
        sessionId: session.id,
        kind: "click",
        status: "confirmed",
        createdAt: t0 + 1000,
        page: {
          url: "https://example.com/bpm/portal#/list",
          title: "Assignment Portal",
          frameId: 0,
        },
        input: { pointerType: "mouse", button: 0, isTrusted: true },
        coordinates: {
          clientX: 100,
          clientY: 200,
          pageX: 100,
          pageY: 200,
          scrollX: 0,
          scrollY: 0,
          devicePixelRatio: 2,
          viewport: { width: 1280, height: 800 },
        },
        element: {
          tagName: "button",
          id: "open-btn",
          classNames: ["el-button"],
          attributes: {},
          boundingBox: { x: 80, y: 180, width: 80, height: 32 },
          locators: [
            {
              kind: "id",
              expression: "#open-btn",
              matchCount: 1,
              stabilityScore: 0.95,
              reasons: ["unique-id"],
            },
          ],
        },
        screenshot: {
          status: "captured",
          source: "primary",
          assetId: "asset-int-1",
          ...(overrides?.includeSettledAndFinal
            ? {
                settledAssetId: "asset-int-1-settled",
                settledDurationMs: 360,
              }
            : {}),
        },
      },
    ],
    interactionAssets: [
      {
        interactionId: "int-1",
        kind: "interaction-screenshot",
        mimeType: "image/jpeg",
        bytes: overrides?.includeSettledAndFinal
          ? makeSyntheticJpeg(1280, 800, 1)
          : tinyJpeg,
      },
      ...(overrides?.includeSettledAndFinal
        ? [
            {
              interactionId: "int-1",
              kind: "interaction-settled" as const,
              mimeType: "image/jpeg" as const,
              bytes: makeSyntheticJpeg(1280, 800, 2),
            },
          ]
        : []),
    ],
    ...(overrides?.includeSettledAndFinal
      ? {
          finalFrameAsset: {
            mimeType: "image/jpeg" as const,
            bytes: makeSyntheticJpeg(1280, 720, 3),
            capturedAtEpochMs: t0 + 11900,
          },
        }
      : {}),
    consoleEntries: [
      {
        id: "c1",
        sessionId: session.id,
        createdAt: t0 + 2000,
        level: "log",
        text: "heartbeat 1793071572000 12ms",
        source: "consoleAPI",
      },
      {
        id: "c2",
        sessionId: session.id,
        createdAt: t0 + 3000,
        level: "log",
        text: "heartbeat 1793071573000 15ms",
        source: "consoleAPI",
      },
      {
        id: "c3",
        sessionId: session.id,
        createdAt: t0 + 4000,
        level: "error",
        text: "Portal target not mounted",
        source: "consoleAPI",
      },
    ],
    networkEntries: [
      {
        id: `${session.id}:100.1`,
        sessionId: session.id,
        createdAt: t0 + 2500,
        url: "https://example.com/api/v5/form",
        method: "GET",
        type: "XHR",
        status: 200,
        statusText: "OK",
        durationMs: 30,
        initiator: { type: "script", url: "https://example.com/main.js" },
        requestHeaders: { Accept: "application/json" },
        response: {
          mimeType: "application/json",
          headers: { "content-type": "application/json" },
          bodyStatus: "captured",
          body: sharedBody,
          byteLength: sharedBody.length,
        },
      },
      {
        id: `${session.id}:100.2`,
        sessionId: session.id,
        createdAt: t0 + 2800,
        url: "https://example.com/api/v5/form?cached=1",
        method: "GET",
        type: "XHR",
        status: 200,
        statusText: "OK",
        durationMs: 12,
        response: {
          mimeType: "application/json",
          bodyStatus: "captured",
          body: sharedBody,
          byteLength: sharedBody.length,
        },
      },
    ],
    issueScenes: [
      {
        id: "scene-v5-1",
        sessionId: session.id,
        status: "complete",
        observedAtEpochMs: t0 + 5000,
        page: {
          url: "https://example.com/bpm/portal#/list",
          title: "Assignment Portal",
          frameId: 0,
          viewport: { width: 1280, height: 800 },
          scrollX: 0,
          scrollY: 0,
          devicePixelRatio: 2,
        },
        target: {
          capturedAtEpochMs: t0 + 5000,
          element: {
            tagName: "div",
            id: "portal-box",
            classNames: ["el-select-dropdown"],
            attributes: {},
            boundingBox: { x: 100, y: 220, width: 200, height: 120 },
            locators: [],
          },
          ancestors: [{ tagName: "body", classNames: [] }],
          state: {},
          computedStyle: {
            display: "none",
            position: "absolute",
            zIndex: "2001",
            overflow: "hidden",
          },
          relatedOverlays: [
            {
              selector: "div.el-select-dropdown#portal-box",
              id: "portal-box",
              tagName: "div",
              role: "listbox",
              relationReason: "aria-controls",
              visible: false,
            },
          ],
          triggerElement: {
            tagName: "button",
            id: "open-btn",
            selectorPath: "button#open-btn.el-button",
            selector: "#open-btn",
            classNames: ["el-button"],
            ariaControls: "portal-box",
          },
          winnerRules: [
            {
              selector: ".el-select-dropdown",
              source: "https://example.com/static/element-ui.css",
              specificity: "0,1,0",
              properties: { display: "none", "z-index": "2001" },
            },
            {
              selector: "#portal-box",
              source: "inline-style",
              specificity: "1,0,0",
              properties: { position: "absolute", overflow: "hidden" },
            },
          ],
        },
        narrative: {
          actual: "下拉浮层未显示",
          expected:
            overrides?.expectedConfidence === "missing"
              ? { text: "", confidence: "missing" }
              : { text: "应当正常显示三个选项", confidence: "explicit" },
        },
        annotation: {
          type: "arrow-box",
          color: "#ef233c",
          point: { xRatio: 0.2, yRatio: 0.3 },
        },
        screenshot: { status: "captured" },
        issues: [],
      },
    ],
    frameworkStates: [
      {
        id: "fw-1",
        sessionId: session.id,
        capturedAtEpochMs: t0 + 4500,
        trigger: "issue-scene",
        page: {
          url: "https://example.com/bpm/portal#/list",
          title: "Assignment Portal",
        },
        snapshot: {
          targetComponent: {
            framework: "vue",
            version: 2,
            componentName: "PortalDropdown",
            componentFile: "src/components/PortalDropdown.vue",
            componentLine: 88,
            props: { visible: false },
          },
          parentChain: [],
        },
        webStorage: {
          localStorage: { locale: "zh-CN" },
          sessionStorage: {},
          redactedValues: false,
        },
      },
      {
        id: "fw-2",
        sessionId: session.id,
        capturedAtEpochMs: t0 + 6000,
        trigger: "interaction",
        page: {
          url: "https://example.com/bpm/portal#/list",
          title: "Assignment Portal",
        },
        webStorage: {
          localStorage: { locale: "en-US" },
          sessionStorage: { step: "2" },
          redactedValues: false,
        },
      },
    ],
    excluded: { interaction: 0, console: 0, network: 0 },
    hasMedia: false,
  };

  const reportAssets: StaticReportAssets = {
    html: "<!doctype html><title>Bug Lens</title>",
    script: "void 0;",
    styles: "body {}",
    icon: new Uint8Array([1, 2, 3]),
  };

  const bundle = buildEvidencePackageBundle(snapshot, reportAssets, {
    packMode: overrides?.packMode ?? "ai-minimal",
  });
  const zipEntries: Record<string, Uint8Array> = {};
  const integrityEntries: Record<
    string,
    { byteLength: number; sha256: string }
  > = {};
  for (const f of bundle.files) {
    zipEntries[f.name] = f.data;
    integrityEntries[f.name] = {
      byteLength: f.data.byteLength,
      sha256: createHash("sha256").update(f.data).digest("hex"),
    };
  }
  const manifest = buildExportManifest(session, integrityEntries, {
    format: "bug-lens-evidence-pack",
    packMode: bundle.packMode,
    extensionVersion: session.extensionVersion,
    casStats: bundle.casStats,
  });
  zipEntries["manifest.json"] = new TextEncoder().encode(
    JSON.stringify(manifest, null, 2)
  );
  return zipSync(zipEntries);
}

export async function buildRealScreenshotZipBytes(): Promise<Uint8Array> {
  const payload: AIScreenshotPayload = {
    version: "1.0",
    timestamp: 1793071570000,
    cropBounds: { x: 0, y: 0, width: 800, height: 600 },
    image: {
      base64Data: `data:image/jpeg;base64,${TINY_JPEG_BASE64}`,
      width: 800,
      height: 600,
      devicePixelRatio: 2,
    },
    annotations: [],
    annotationGroups: [],
    domContextTree: {
      smallestCommonAncestorSelector: "div#app > main.portal-view",
      meta: {
        anchorCount: 1,
        leafCount: 1,
        ancestorCount: 1,
        truncated: false,
      },
      anchors: [
        {
          selector: "button.submit-btn",
          selectorPath: "div#app > main.portal-view > button.submit-btn",
          tagName: "button",
          id: "submit-btn",
          className: "submit-btn primary",
          innerText: "Submit Assignment",
          relativeRect: { x: 100, y: 200, width: 140, height: 40 },
          computedStyles: {
            display: "inline-flex",
            color: "rgb(255, 255, 255)",
            overflow: "hidden",
          },
          layoutContext: {
            isFlexOrGridItem: false,
            textOverflow: {
              isTruncated: true,
              truncationType: "single_line",
              scrollDimension: { width: 220, height: 40 },
              clientDimension: { width: 140, height: 40 },
              overflowDelta: { width: 80, height: 0 },
              reason: "single_line truncation",
            },
          },
          componentName: "AssignmentSubmitButton",
          componentFile: "src/components/AssignmentSubmitButton.vue",
          componentLine: 48,
          intentFlags: {
            isArrowTarget: true,
            textComment: "按钮点击后无反应",
          },
        },
      ],
      leaves: [],
      ancestors: [],
    },
    environment: {
      url: "https://example.com/bpm/portal",
      title: "Portal Screenshot",
      userAgent: "Mozilla/5.0 Chrome/155.0",
      viewport: { width: 1440, height: 900 },
      mediaBreakpoint: "desktop",
      recentConsoleErrors: [],
      recentFailedRequests: [],
    },
    cascadeIndex: {
      sheets: [
        {
          id: "S0",
          href: "https://example.com/static/common.css",
          rulesCount: 1,
          isInline: false,
        },
      ],
      rules: [
        {
          id: "R0",
          sheetId: "S0",
          selectorText: ".submit-btn",
          cssText: "pointer-events: none;",
          styleProps: { "pointer-events": "none" },
        },
        {
          id: "R1",
          sheetId: "S0",
          selectorText: ".submit-btn",
          cssText: ".submit-btn { word-break: keep-all; }",
          styleProps: { "word-break": "keep-all" },
        },
      ],
      elements: [
        {
          id: "e_0",
          selector: ".submit-btn",
          tagName: "button",
          matchedRuleIds: ["R0", "R1"],
        },
      ],
      perProperty: {},
      meta: {
        sheetCount: 1,
        ruleCount: 1,
        elementCount: 1,
        capturedAtEpochMs: 1793071570000,
      },
    },
  };

  const res = buildScreenshotZipPackage(payload);
  const ab = await res.blob.arrayBuffer();
  return new Uint8Array(ab);
}
