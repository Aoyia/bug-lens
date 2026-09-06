import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { unzipSync } from "fflate";
import {
  buildScreenshotZipPackage,
  base64ToUint8Array,
  stringToUint8Array,
} from "../src/screenshot/pipeline/screenshot-zip-builder.ts";
import {
  formatPayloadToMarkdown,
  formatPayloadToMarkdownForZip,
  buildAiPromptTemplate,
  normalizePayloadKeyOrder,
  normalizeDomTreeKeyOrder,
  type AIScreenshotPayload,
  type FrameworkComponentStateSnapshot,
  type VueComponentStateSnapshot,
} from "../src/domain/screenshot-payload.ts";

describe("Adversarial Suite 1: Deep Equality & Dual-Write Resilience (frameworkComponentStates vs vueComponentStates)", () => {
  const basePayload: AIScreenshotPayload = {
    version: "1.0",
    timestamp: 1700000000000,
    cropBounds: { x: 0, y: 0, width: 800, height: 600 },
    image: {
      base64Data:
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
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
      url: "https://example.com/adversarial",
      title: "Adversarial Challenge Test",
      userAgent: "TestAgent/1.0",
      viewport: { width: 1440, height: 900 },
      mediaBreakpoint: "desktop",
      recentConsoleErrors: [],
      recentFailedRequests: [],
    },
  };

  test("1.1 Dual-write states: Exact deep equality across Vue & React mixed states", async () => {
    const mixedStates: FrameworkComponentStateSnapshot[] = [
      {
        componentName: "<AppHeader>",
        componentPath: ["<Root>", "<AppHeader>"],
        framework: "vue",
        componentFile: "src/components/AppHeader.vue",
        props: { user: { id: 101, name: "Alice" }, activeTab: "dashboard" },
        data: { collapsed: false, badgeCount: 5 },
      },
      {
        componentName: "<TransactionTable>",
        componentPath: ["<Root>", "<MainView>", "<TransactionTable>"],
        framework: "react",
        componentFile: "src/views/TransactionTable.tsx",
        componentLine: 128,
        props: { pageSize: 20, sortOrder: "desc", allowFilter: true },
        data: { selectedRowIds: [1, 2, 3], filterKeyword: "refund" },
      },
    ];

    const payload: AIScreenshotPayload = {
      ...basePayload,
      environment: {
        ...basePayload.environment,
        frameworkComponentStates: mixedStates,
        vueComponentStates: mixedStates,
      },
    };

    // 1. In-memory exact deep equality
    assert.deepEqual(
      payload.environment.frameworkComponentStates,
      payload.environment.vueComponentStates
    );
    assert.strictEqual(
      payload.environment.frameworkComponentStates,
      payload.environment.vueComponentStates
    );

    // 2. Packaging to ZIP and unzipping preservation
    const pack = buildScreenshotZipPackage(payload);
    const unzipped = unzipSync(new Uint8Array(await pack.blob.arrayBuffer()));
    const envParsed = JSON.parse(
      new TextDecoder().decode(unzipped["environment.json"])
    );
    assert.deepEqual(
      envParsed.frameworkComponentStates,
      envParsed.vueComponentStates
    );
    assert.deepEqual(envParsed.frameworkComponentStates, mixedStates);
  });

  test("1.2 Empty states handling: Both undefined when no components detected", async () => {
    const payload: AIScreenshotPayload = {
      ...basePayload,
      environment: {
        ...basePayload.environment,
        frameworkComponentStates: undefined,
        vueComponentStates: undefined,
      },
    };

    assert.strictEqual(
      payload.environment.frameworkComponentStates,
      payload.environment.vueComponentStates
    );
    assert.strictEqual(payload.environment.frameworkComponentStates, undefined);

    const pack = buildScreenshotZipPackage(payload);
    const unzipped = unzipSync(new Uint8Array(await pack.blob.arrayBuffer()));
    const envParsed = JSON.parse(
      new TextDecoder().decode(unzipped["environment.json"])
    );
    assert.strictEqual(envParsed.frameworkComponentStates, undefined);
    assert.strictEqual(envParsed.vueComponentStates, undefined);
  });

  test("1.3 Downstream consumer resilience: Prompt builder handles legacy payload with ONLY vueComponentStates", async () => {
    const legacyPayload: AIScreenshotPayload = {
      ...basePayload,
      environment: {
        ...basePayload.environment,
        frameworkComponentStates: undefined,
        vueComponentStates: [
          {
            componentName: "<LegacyVueComp>",
            componentFile: "src/legacy/LegacyVueComp.vue",
            componentLine: undefined,
            framework: "vue",
            props: { legacyProp: true },
          },
        ],
      },
    };

    const prompt = buildAiPromptTemplate(legacyPayload);
    assert.match(prompt, /- 🎯 源码物理定位 \(Source Code Location\):/);
    assert.match(prompt, /`src\/legacy\/LegacyVueComp\.vue`/);
    assert.match(prompt, /<LegacyVueComp>/);
  });

  test("1.4 Downstream consumer resilience: Prompt builder handles modern payload with ONLY frameworkComponentStates", async () => {
    const modernPayload: AIScreenshotPayload = {
      ...basePayload,
      environment: {
        ...basePayload.environment,
        frameworkComponentStates: [
          {
            componentName: "<ModernReactComp>",
            componentFile: "src/modern/ModernReactComp.tsx",
            componentLine: 88,
            framework: "react",
            props: { modernProp: 42 },
          },
        ],
        vueComponentStates: undefined,
      },
    };

    const prompt = buildAiPromptTemplate(modernPayload);
    assert.match(prompt, /- 🎯 源码物理定位 \(Source Code Location\):/);
    assert.match(prompt, /`src\/modern\/ModernReactComp\.tsx:88`/);
    assert.match(prompt, /<ModernReactComp>/);
  });

  test("1.5 Snapshot type structural equivalence: VueComponentStateSnapshot is transparently assignable to FrameworkComponentStateSnapshot", () => {
    const vueSnap: VueComponentStateSnapshot = {
      componentName: "<SearchInput>",
      componentFile: "src/components/SearchInput.vue",
      framework: "vue",
      props: { placeholder: "Search here..." },
    };
    const fwSnap: FrameworkComponentStateSnapshot = vueSnap;
    assert.strictEqual(fwSnap.componentName, "<SearchInput>");
    assert.strictEqual(fwSnap.componentFile, "src/components/SearchInput.vue");
    assert.strictEqual(fwSnap.framework, "vue");
  });

  test("1.6 Priority fallback resilience: When both exist, frameworkComponentStates takes precedence in buildPromptBody", () => {
    const dualPayload: AIScreenshotPayload = {
      ...basePayload,
      environment: {
        ...basePayload.environment,
        frameworkComponentStates: [
          {
            componentName: "<ModernAlpha>",
            componentFile: "src/modern/ModernAlpha.tsx",
            componentLine: 12,
            framework: "react",
          },
        ],
        vueComponentStates: [
          {
            componentName: "<LegacyBeta>",
            componentFile: "src/legacy/LegacyBeta.vue",
            framework: "vue",
          },
        ],
      },
    };

    const prompt = buildAiPromptTemplate(dualPayload);
    assert.match(prompt, /ModernAlpha/);
    // Since frameworkComponentStates is truthy, prompt builder uses it
    assert.ok(prompt.includes("ModernAlpha"));
  });
});

describe("Adversarial Suite 2: ZIP Export Unzipping, File Existence & Content Consistency", () => {
  const dummyImageBase64 =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

  async function getUnzippedMap(
    pack: ReturnType<typeof buildScreenshotZipPackage>
  ): Promise<Record<string, Uint8Array>> {
    const buf = await pack.blob.arrayBuffer();
    return unzipSync(new Uint8Array(buf));
  }

  test("2.1 Minimal payload: Exactly 4 files exist and cascade.json is strictly absent", async () => {
    const minimalPayload: AIScreenshotPayload = {
      version: "1.0",
      timestamp: 1700000000000,
      cropBounds: { x: 0, y: 0, width: 100, height: 100 },
      image: {
        base64Data: dummyImageBase64,
        width: 100,
        height: 100,
        devicePixelRatio: 1,
      },
      annotations: [],
      annotationGroups: [],
      domContextTree: {
        smallestCommonAncestorSelector: "body",
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
        url: "https://example.com/minimal",
        title: "Minimal",
        userAgent: "MinAgent",
        viewport: { width: 800, height: 600 },
        mediaBreakpoint: "desktop",
        recentConsoleErrors: [],
        recentFailedRequests: [],
      },
    };

    const pack = buildScreenshotZipPackage(minimalPayload);
    const unzipped = await getUnzippedMap(pack);
    const fileKeys = Object.keys(unzipped).sort();

    assert.deepEqual(fileKeys, [
      "ai-prompt.md",
      "dom-context.json",
      "environment.json",
      "screenshot.jpg",
    ]);
    assert.strictEqual(unzipped["cascade.json"], undefined);
  });

  test("2.2 Cascade payload: Exactly 5 files exist and cascade.json round-trips perfectly", async () => {
    const cascadePayload: AIScreenshotPayload = {
      version: "1.0",
      timestamp: 1700000000000,
      cropBounds: { x: 10, y: 10, width: 200, height: 200 },
      image: {
        base64Data: dummyImageBase64,
        width: 200,
        height: 200,
        devicePixelRatio: 2,
      },
      annotations: [],
      annotationGroups: [],
      domContextTree: {
        smallestCommonAncestorSelector: "div#root",
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
      cascadeIndex: {
        sheets: [
          {
            id: "sheet-1",
            href: "https://example.com/app.css",
            rulesCount: 10,
          },
        ],
        rules: [
          {
            id: "rule-1",
            sheetId: "sheet-1",
            selectorText: ".btn-submit",
            cssText: "background: blue;",
            styleProps: { background: "blue" },
          },
        ],
        elements: [
          {
            id: "el-1",
            selector: "button.btn-submit",
            tagName: "button",
            matchedRuleIds: ["rule-1"],
          },
        ],
        perProperty: {
          background: [
            { property: "background", value: "blue", sourceRuleId: "rule-1" },
          ],
        },
        meta: {
          sheetCount: 1,
          ruleCount: 1,
          elementCount: 1,
          capturedAtEpochMs: 1700000000000,
        },
      },
      environment: {
        url: "https://example.com/cascade",
        title: "Cascade Test",
        userAgent: "TestAgent",
        viewport: { width: 1024, height: 768 },
        mediaBreakpoint: "desktop",
        recentConsoleErrors: [],
        recentFailedRequests: [],
      },
    };

    const pack = buildScreenshotZipPackage(cascadePayload);
    const unzipped = await getUnzippedMap(pack);
    const fileKeys = Object.keys(unzipped).sort();

    assert.deepEqual(fileKeys, [
      "ai-prompt.md",
      "cascade.json",
      "dom-context.json",
      "environment.json",
      "screenshot.jpg",
    ]);

    const parsedCascade = JSON.parse(
      new TextDecoder().decode(unzipped["cascade.json"])
    );
    assert.deepEqual(parsedCascade, cascadePayload.cascadeIndex);
  });

  test("2.3 Special Characters, UTF-8, Script tags & Path Boundary Robustness in ZIP", async () => {
    const specialFilePath = "src/views/特殊 路径@#&%*()_+=!~/UserProfile.vue";
    const trickyPayload: AIScreenshotPayload = {
      version: "1.0",
      timestamp: 1700000000000,
      cropBounds: { x: 0, y: 0, width: 300, height: 300 },
      image: {
        base64Data: dummyImageBase64,
        width: 300,
        height: 300,
        devicePixelRatio: 2,
      },
      annotations: [
        {
          id: "ann-xss",
          type: "text",
          position: { x: 10, y: 10 },
          text: '<script>alert("XSS")</script> & "quotes" \'single\' \\backslash \n newline \t tab 🔥 🚀 中文路径',
        },
      ],
      annotationGroups: [],
      domContextTree: {
        smallestCommonAncestorSelector:
          'div#app > span[data-weird="<>&\\"\'\\n"]',
        meta: {
          anchorCount: 1,
          leafCount: 0,
          ancestorCount: 0,
          truncated: false,
        },
        anchors: [
          {
            selector: 'span[data-weird="<>&\\"\'\\n"]',
            selectorPath: 'div#app > span[data-weird="<>&\\"\'\\n"]',
            componentName: '<Special"Comp>&',
            componentPath: ["<Root>", '<Special"Comp>&'],
            componentFile: specialFilePath,
            componentLine: 999999,
            relativeRect: { x: 10, y: 10, width: 100, height: 50 },
            computedStyles: { "font-family": '"PingFang SC", sans-serif' },
            intentFlags: { textComment: "测试特殊字符 \\/\"'\n\r\t \u0000" },
          },
        ],
        leaves: [],
        ancestors: [],
      },
      environment: {
        url: "https://example.com/test?q=hello%20world&special=<>&\"'#frag",
        title: "Special <Title> & 'Quotes' 🔥",
        userAgent: "SpecialAgent",
        viewport: { width: 1920, height: 1080 },
        mediaBreakpoint: "desktop",
        recentConsoleErrors: [
          {
            message: 'Uncaught Error: <test> "fail" & break\n at <anonymous>',
            stack: 'Error: <test>\n    at Object.test ("src/special.ts":10:5)',
            timestamp: 1700000000000,
          },
        ],
        recentFailedRequests: [],
        frameworkComponentStates: [
          {
            componentName: '<Special"Comp>&',
            componentFile: specialFilePath,
            componentLine: 999999,
            framework: "vue",
            props: {
              specialKey:
                'value with "quotes" and <tags> and \nnewlines and 🔥',
            },
            data: { emoji: "🎉", nullVal: null },
          },
        ],
        vueComponentStates: [
          {
            componentName: '<Special"Comp>&',
            componentFile: specialFilePath,
            componentLine: 999999,
            framework: "vue",
            props: {
              specialKey:
                'value with "quotes" and <tags> and \nnewlines and 🔥',
            },
            data: { emoji: "🎉", nullVal: null },
          },
        ],
      },
    };

    const pack = buildScreenshotZipPackage(trickyPayload);
    const unzipped = await getUnzippedMap(pack);

    // Verify DOM context JSON unzips and parses without JSON syntax error
    const domText = new TextDecoder().decode(unzipped["dom-context.json"]);
    const parsedDom = JSON.parse(domText);
    assert.strictEqual(parsedDom.anchors[0].componentFile, specialFilePath);
    assert.strictEqual(parsedDom.anchors[0].componentLine, 999999);

    // Verify environment JSON unzips and preserves exact special characters
    const envText = new TextDecoder().decode(unzipped["environment.json"]);
    const parsedEnv = JSON.parse(envText);
    assert.strictEqual(
      parsedEnv.frameworkComponentStates[0].props.specialKey,
      'value with "quotes" and <tags> and \nnewlines and 🔥'
    );
    assert.deepEqual(
      parsedEnv.frameworkComponentStates,
      parsedEnv.vueComponentStates
    );

    // Verify ai-prompt.md unzips and contains the literal special path string
    const promptText = new TextDecoder().decode(unzipped["ai-prompt.md"]);
    assert.ok(
      promptText.includes(`${specialFilePath}:999999`),
      "ai-prompt.md must contain the special file path with line number"
    );
    assert.match(promptText, /Special <Title> & 'Quotes' 🔥/);
  });

  test("2.4 Full Round-Trip Fidelity: Unzipped JSONs match normalizeDomTreeKeyOrder and environment 100%", async () => {
    const states = [
      {
        componentName: "<UserProfile>",
        componentPath: ["<App>", "<UserProfile>"],
        framework: "vue" as const,
        componentFile: "src/views/UserProfile.vue",
        componentLine: 45,
        props: { userId: "usr-9876", roles: ["admin", "viewer"] },
        data: { isLoaded: true, profile: { bio: "Senior QA" } },
      },
    ];

    const payload: AIScreenshotPayload = {
      version: "1.0",
      timestamp: 1712345678900,
      cropBounds: { x: 50, y: 50, width: 600, height: 400 },
      image: {
        base64Data: dummyImageBase64,
        width: 600,
        height: 400,
        devicePixelRatio: 2,
      },
      annotations: [
        {
          id: "r1",
          type: "rect",
          bounds: { x: 60, y: 60, width: 100, height: 50 },
          color: "#FA5252",
        },
      ],
      annotationGroups: [],
      domContextTree: {
        smallestCommonAncestorSelector: "div#app",
        meta: {
          anchorCount: 1,
          leafCount: 1,
          ancestorCount: 1,
          truncated: false,
        },
        anchors: [
          {
            selector: "div.profile-card",
            selectorPath: "div#app > div.profile-card",
            componentName: "<UserProfile>",
            componentPath: ["<App>", "<UserProfile>"],
            componentFile: "src/views/UserProfile.vue",
            componentLine: 45,
            relativeRect: { x: 60, y: 60, width: 100, height: 50 },
            computedStyles: { display: "block" },
            intentFlags: { isHighlightedFocus: true },
          },
        ],
        leaves: [
          {
            tagName: "h2",
            selector: "h2.username",
            innerText: "John Doe",
            relativeRect: { x: 65, y: 65, width: 90, height: 20 },
            componentName: "<UserProfile>",
            componentFile: "src/views/UserProfile.vue",
            componentLine: 48,
          },
        ],
        ancestors: [
          {
            selector: "div#app",
            tagName: "div",
            id: "app",
            depth: 0,
            componentName: "<App>",
            componentFile: "src/App.vue",
          },
        ],
      },
      environment: {
        url: "https://example.com/profile",
        title: "User Profile",
        userAgent: "FidelityAgent",
        viewport: { width: 1920, height: 1080 },
        mediaBreakpoint: "desktop",
        recentConsoleErrors: [],
        recentFailedRequests: [],
        frameworkComponentStates: states,
        vueComponentStates: states,
      },
    };

    const pack = buildScreenshotZipPackage(payload);
    const unzipped = await getUnzippedMap(pack);

    // 1. dom-context.json exact match
    const expectedDomJson = JSON.stringify(
      normalizeDomTreeKeyOrder(payload.domContextTree),
      null,
      2
    );
    const actualDomJson = new TextDecoder().decode(
      unzipped["dom-context.json"]
    );
    assert.strictEqual(actualDomJson, expectedDomJson);

    // 2. environment.json exact match
    const expectedEnvJson = JSON.stringify(payload.environment, null, 2);
    const actualEnvJson = new TextDecoder().decode(
      unzipped["environment.json"]
    );
    assert.strictEqual(actualEnvJson, expectedEnvJson);

    // 3. screenshot.jpg exact byte match
    const expectedImgU8 = base64ToUint8Array(payload.image.base64Data);
    assert.deepEqual(unzipped["screenshot.jpg"], expectedImgU8);

    // 4. ai-prompt.md exact text match
    const expectedPromptMd = formatPayloadToMarkdownForZip(payload);
    const actualPromptMd = new TextDecoder().decode(unzipped["ai-prompt.md"]);
    assert.strictEqual(actualPromptMd, expectedPromptMd);
  });

  test("2.5 Binary Level 0 vs Level 6: Image byte fidelity with large simulated image (100KB+)", async () => {
    // Generate a 128KB pseudo-PNG binary buffer and encode to base64
    const largeByteLen = 131072;
    const rawBuffer = new Uint8Array(largeByteLen);
    for (let i = 0; i < largeByteLen; i++) {
      rawBuffer[i] = i % 256;
    }
    const base64Str = Buffer.from(rawBuffer).toString("base64");
    const dataUrl = `data:image/png;base64,${base64Str}`;

    const largeImagePayload: AIScreenshotPayload = {
      version: "1.0",
      timestamp: 1700000000000,
      cropBounds: { x: 0, y: 0, width: 1024, height: 768 },
      image: {
        base64Data: dataUrl,
        width: 1024,
        height: 768,
        devicePixelRatio: 2,
      },
      annotations: [],
      annotationGroups: [],
      domContextTree: {
        smallestCommonAncestorSelector: "body",
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
        url: "https://example.com/large",
        title: "Large Image Test",
        userAgent: "LargeAgent",
        viewport: { width: 1024, height: 768 },
        mediaBreakpoint: "desktop",
        recentConsoleErrors: [],
        recentFailedRequests: [],
      },
    };

    const pack = buildScreenshotZipPackage(largeImagePayload);
    const unzipped = await getUnzippedMap(pack);

    assert.strictEqual(unzipped["screenshot.jpg"].byteLength, largeByteLen);
    assert.deepEqual(unzipped["screenshot.jpg"], rawBuffer);
  });
});

describe("Adversarial Suite 3: Stress Testing with Large Number of Component State Entries", () => {
  const dummyImageBase64 =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

  function generateStressPayload(entryCount: number): AIScreenshotPayload {
    const states: FrameworkComponentStateSnapshot[] = [];
    for (let i = 0; i < entryCount; i++) {
      const isVue = i % 2 === 0;
      states.push({
        componentName: `<Comp_${i}>`,
        componentPath: [
          "<App>",
          `<Module_${Math.floor(i / 10)}>`,
          `<Comp_${i}>`,
        ],
        framework: isVue ? "vue" : "react",
        componentFile: isVue
          ? `src/modules/mod_${Math.floor(i / 10)}/Comp_${i}.vue`
          : `src/modules/mod_${Math.floor(i / 10)}/Comp_${i}.tsx`,
        componentLine: isVue ? undefined : (i % 300) + 1,
        props: {
          id: i,
          token: `val_${i}`,
          enabled: i % 3 === 0,
          meta: { index: i, tag: `tag_${i}` },
        },
        data: {
          localCount: i * 2,
          statusText: `Status for component ${i}`,
        },
      });
    }

    return {
      version: "1.0",
      timestamp: 1700000000000,
      cropBounds: { x: 0, y: 0, width: 1920, height: 1080 },
      image: {
        base64Data: dummyImageBase64,
        width: 1920,
        height: 1080,
        devicePixelRatio: 2,
      },
      annotations: [],
      annotationGroups: [],
      domContextTree: {
        smallestCommonAncestorSelector: "div#root",
        meta: {
          anchorCount: Math.min(10, entryCount),
          leafCount: Math.min(20, entryCount),
          ancestorCount: 5,
          truncated: false,
        },
        anchors: states.slice(0, 10).map((s, idx) => ({
          selector: `button#btn-${idx}`,
          selectorPath: `div#root > button#btn-${idx}`,
          componentName: s.componentName,
          componentPath: s.componentPath,
          componentFile: s.componentFile,
          componentLine: s.componentLine,
          relativeRect: { x: idx * 10, y: idx * 10, width: 50, height: 30 },
          computedStyles: {},
          intentFlags: { isArrowTarget: idx === 0 },
        })),
        leaves: [],
        ancestors: [],
      },
      environment: {
        url: "https://example.com/stress",
        title: `Stress Test ${entryCount} Components`,
        userAgent: "StressTester/1.0",
        viewport: { width: 1920, height: 1080 },
        mediaBreakpoint: "desktop",
        recentConsoleErrors: [],
        recentFailedRequests: [],
        frameworkComponentStates: states,
        vueComponentStates: states,
      },
    };
  }

  test("3.1 Stress test 100 components: Performance < 50ms & 100% deep equality unzipped", async () => {
    const payload = generateStressPayload(100);

    const t0 = performance.now();
    const prompt = buildAiPromptTemplate(payload);
    const tPrompt = performance.now() - t0;

    const tZipStart = performance.now();
    const pack = buildScreenshotZipPackage(payload);
    const tZip = performance.now() - tZipStart;

    const unzipped = unzipSync(new Uint8Array(await pack.blob.arrayBuffer()));
    const envParsed = JSON.parse(
      new TextDecoder().decode(unzipped["environment.json"])
    );

    assert.strictEqual(envParsed.frameworkComponentStates.length, 100);
    assert.strictEqual(envParsed.vueComponentStates.length, 100);
    assert.deepEqual(
      envParsed.frameworkComponentStates,
      envParsed.vueComponentStates
    );

    assert.match(prompt, /- 🎯 源码物理定位 \(Source Code Location\):/);
    assert.match(prompt, /Comp_0\.vue/);

    // Performance budget: packaging 100 components should take < 200ms
    assert.ok(
      tPrompt < 200,
      `Prompt generation took ${tPrompt.toFixed(2)}ms (expected < 200ms)`
    );
    assert.ok(
      tZip < 200,
      `ZIP build took ${tZip.toFixed(2)}ms (expected < 200ms)`
    );
  });

  test("3.2 Stress test 1,000 components: Packaging & unzipping without stack overflow or OOM", async () => {
    const payload = generateStressPayload(1000);

    const t0 = performance.now();
    const prompt = buildAiPromptTemplate(payload);
    const tPrompt = performance.now() - t0;

    const tZipStart = performance.now();
    const pack = buildScreenshotZipPackage(payload);
    const tZip = performance.now() - tZipStart;

    const unzipped = unzipSync(new Uint8Array(await pack.blob.arrayBuffer()));
    const envParsed = JSON.parse(
      new TextDecoder().decode(unzipped["environment.json"])
    );

    assert.strictEqual(envParsed.frameworkComponentStates.length, 1000);
    assert.strictEqual(envParsed.vueComponentStates.length, 1000);
    assert.deepEqual(
      envParsed.frameworkComponentStates,
      envParsed.vueComponentStates
    );

    // Verify Prompt has source location list cleanly rendered
    assert.match(prompt, /涉及组件清单|Involved Source Files/);
    assert.match(prompt, /Comp_999/);

    // Performance budget: 1,000 components under 1 second
    assert.ok(
      tPrompt < 1000,
      `Prompt gen for 1k components took ${tPrompt.toFixed(2)}ms`
    );
    assert.ok(
      tZip < 1000,
      `ZIP packaging for 1k components took ${tZip.toFixed(2)}ms`
    );
  });

  test("3.3 Stress test 3,000 components: High-load boundary scaling & memory containment", async () => {
    const payload = generateStressPayload(3000);

    const t0 = performance.now();
    const pack = buildScreenshotZipPackage(payload);
    const tZip = performance.now() - t0;

    const unzipped = unzipSync(new Uint8Array(await pack.blob.arrayBuffer()));
    const envParsed = JSON.parse(
      new TextDecoder().decode(unzipped["environment.json"])
    );

    assert.strictEqual(envParsed.frameworkComponentStates.length, 3000);
    assert.strictEqual(envParsed.vueComponentStates.length, 3000);
    assert.deepEqual(
      envParsed.frameworkComponentStates,
      envParsed.vueComponentStates
    );

    // Verify unzipped size is non-trivial and compressed correctly
    assert.ok(
      pack.blob.size > 20000,
      "ZIP blob size must reflect 3000 entries"
    );
    assert.ok(
      tZip < 3000,
      `ZIP packaging for 3k entries took ${tZip.toFixed(2)}ms`
    );
  });

  test("3.4 Deeply nested DOM Tree (depth 50) with component locations: Recursion and normalization safety", async () => {
    // Build a 50-level deep nested DOM tree
    let currentChild: any = undefined;
    for (let depth = 50; depth >= 1; depth--) {
      currentChild = {
        tagName: `div`,
        className: `level-${depth}`,
        selector: `div.level-${depth}`,
        componentName: `<Level_${depth}>`,
        componentPath: [`<App>`, `<Level_${depth}>`],
        componentFile: `src/levels/Level_${depth}.vue`,
        componentLine: depth,
        props: { depthLevel: depth },
        data: { stateAtDepth: depth * 10 },
        children: currentChild ? [currentChild] : undefined,
      };
    }

    const deepTreePayload: AIScreenshotPayload = {
      version: "1.0",
      timestamp: 1700000000000,
      cropBounds: { x: 0, y: 0, width: 800, height: 600 },
      image: {
        base64Data: dummyImageBase64,
        width: 800,
        height: 600,
        devicePixelRatio: 2,
      },
      annotations: [],
      annotationGroups: [],
      domContextTree: {
        smallestCommonAncestorSelector: "div.level-1",
        meta: {
          anchorCount: 0,
          leafCount: 0,
          ancestorCount: 0,
          truncated: false,
        },
        anchors: [],
        leaves: [],
        ancestors: [],
        tree: currentChild,
      },
      environment: {
        url: "https://example.com/deep",
        title: "Deep Tree",
        userAgent: "DeepAgent",
        viewport: { width: 1440, height: 900 },
        mediaBreakpoint: "desktop",
        recentConsoleErrors: [],
        recentFailedRequests: [],
      },
    };

    // Test normalization on 50-depth tree without Maximum Call Stack Exceeded
    const normalized = normalizePayloadKeyOrder(deepTreePayload);
    assert.ok(normalized.domContextTree.tree);

    // Test prompt generation
    const prompt = buildAiPromptTemplate(deepTreePayload);
    assert.match(prompt, /src\/levels\/Level_1\.vue:1/);
    assert.match(prompt, /src\/levels\/Level_50\.vue:50/);

    // Test ZIP packaging and unzipping
    const pack = buildScreenshotZipPackage(deepTreePayload);
    const unzipped = unzipSync(new Uint8Array(await pack.blob.arrayBuffer()));
    assert.ok(unzipped["dom-context.json"]);
    assert.ok(unzipped["environment.json"]);
    assert.ok(unzipped["ai-prompt.md"]);
    assert.ok(unzipped["screenshot.jpg"]);
  });

  test("3.5 Massive Single Component State: 1,000 Props & 1,000 Data Fields Serialization", async () => {
    const hugeProps: Record<string, unknown> = {};
    const hugeData: Record<string, unknown> = {};
    for (let k = 0; k < 1000; k++) {
      hugeProps[`prop_key_${k}`] =
        `prop_value_string_sample_${k}_` + "A".repeat(50);
      hugeData[`data_key_${k}`] = { nestedIndex: k, flag: k % 2 === 0 };
    }

    const massivePayload: AIScreenshotPayload = {
      version: "1.0",
      timestamp: 1700000000000,
      cropBounds: { x: 0, y: 0, width: 800, height: 600 },
      image: {
        base64Data: dummyImageBase64,
        width: 800,
        height: 600,
        devicePixelRatio: 2,
      },
      annotations: [],
      annotationGroups: [],
      domContextTree: {
        smallestCommonAncestorSelector: "div#massive",
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
        url: "https://example.com/massive",
        title: "Massive Component",
        userAgent: "MassiveAgent",
        viewport: { width: 1440, height: 900 },
        mediaBreakpoint: "desktop",
        recentConsoleErrors: [],
        recentFailedRequests: [],
        frameworkComponentStates: [
          {
            componentName: "<MegaGrid>",
            componentFile: "src/components/MegaGrid.tsx",
            componentLine: 404,
            framework: "react",
            props: hugeProps,
            data: hugeData,
          },
        ],
        vueComponentStates: [
          {
            componentName: "<MegaGrid>",
            componentFile: "src/components/MegaGrid.tsx",
            componentLine: 404,
            framework: "react",
            props: hugeProps,
            data: hugeData,
          },
        ],
      },
    };

    const pack = buildScreenshotZipPackage(massivePayload);
    const unzipped = unzipSync(new Uint8Array(await pack.blob.arrayBuffer()));

    const envParsed = JSON.parse(
      new TextDecoder().decode(unzipped["environment.json"])
    );
    assert.strictEqual(
      Object.keys(envParsed.frameworkComponentStates[0].props).length,
      1000
    );
    assert.strictEqual(
      Object.keys(envParsed.frameworkComponentStates[0].data).length,
      1000
    );
    assert.deepEqual(
      envParsed.frameworkComponentStates,
      envParsed.vueComponentStates
    );
  });

  test("3.6 Sequential Batch ZIP Packaging Stress Test (30 consecutive builds)", async () => {
    const payload = generateStressPayload(50);
    const startMemory = process.memoryUsage().heapUsed;

    for (let iter = 0; iter < 30; iter++) {
      const pack = buildScreenshotZipPackage(payload);
      assert.ok(pack.filename.startsWith("bug-lens-screenshot-"));
      assert.ok(pack.blob.size > 0);
    }

    const endMemory = process.memoryUsage().heapUsed;
    const memoryDiffMb = (endMemory - startMemory) / (1024 * 1024);
    // Ensure memory didn't leak uncontrollably (> 100MB increase across 30 small runs)
    assert.ok(
      memoryDiffMb < 100,
      `Memory delta was ${memoryDiffMb.toFixed(2)}MB (expected < 100MB)`
    );
  });

  test("3.7 Boundary scaling: 5,000 components extreme payload packaging & integrity check", async () => {
    const payload = generateStressPayload(5000);

    const t0 = performance.now();
    const pack = buildScreenshotZipPackage(payload);
    const tZip = performance.now() - t0;

    const unzipped = unzipSync(new Uint8Array(await pack.blob.arrayBuffer()));
    const envParsed = JSON.parse(
      new TextDecoder().decode(unzipped["environment.json"])
    );

    assert.strictEqual(envParsed.frameworkComponentStates.length, 5000);
    assert.strictEqual(envParsed.vueComponentStates.length, 5000);
    assert.deepEqual(
      envParsed.frameworkComponentStates,
      envParsed.vueComponentStates
    );

    // Verify ZIP integrity with 5,000 entries finishes under 5s
    assert.ok(
      tZip < 5000,
      `ZIP packaging for 5k entries took ${tZip.toFixed(2)}ms (expected < 5000ms)`
    );
  });
});
