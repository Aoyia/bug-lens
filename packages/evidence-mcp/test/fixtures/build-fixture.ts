import { zipSync } from "fflate";
import { createHash } from "node:crypto";
import type { AIScreenshotPayload } from "../../../../src/domain/screenshot-payload.ts";
import { buildExportManifest } from "../../../../src/export/export-manifest.ts";
import {
  buildEvidencePackage,
  type EvidencePackageSnapshot,
  type StaticReportAssets,
} from "../../../../src/preview/evidence-package.ts";
import { buildScreenshotZipPackage } from "../../../../src/screenshot/pipeline/screenshot-zip-builder.ts";
import type { RecordingSession } from "../../../../src/shared/protocol.ts";

// 1x1 最小有效 JPEG base64
const TINY_JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";

export function buildRealSessionZipBytes(overrides?: {
  schemaVersion?: number;
  omitNetworkDetails?: boolean;
  tamperSessionData?: boolean;
  expectedConfidence?: "explicit" | "missing";
  legacyColonBodyFilename?: boolean;
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

  const pkgFiles = buildEvidencePackage(snapshot, reportAssets);
  const zipEntries: Record<string, Uint8Array> = {};
  const integrityEntries: Record<
    string,
    { byteLength: number; sha256: string }
  > = {};

  for (const f of pkgFiles) {
    if (overrides?.omitNetworkDetails && f.name === "data/network-details.js") {
      continue;
    }
    let name = f.name;
    let data = f.data;
    if (overrides?.legacyColonBodyFilename) {
      if (name === `network/body-${session.id}_20535.366.txt`) {
        name = `network/body-${session.id}:20535.366.txt`;
      } else if (name === "data/session-data.js") {
        const raw = new TextDecoder().decode(data);
        data = new TextEncoder().encode(
          raw.replace(
            `network/body-${session.id}_20535.366.txt`,
            `network/body-${session.id}:20535.366.txt`
          )
        );
      }
    }
    zipEntries[name] = data;
    integrityEntries[name] = {
      byteLength: data.byteLength,
      sha256: createHash("sha256").update(data).digest("hex"),
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
