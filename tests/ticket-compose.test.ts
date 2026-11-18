import test from "node:test";
import assert from "node:assert/strict";

import {
  buildTicketQuestions,
  deriveIsBug,
  renderTicketMarkdown,
} from "../src/preview/ticket-compose.ts";
import { setUserLanguagePreference } from "../src/shared/i18n.ts";
import type { IssueScene } from "../src/shared/protocol.ts";

async function useChinese(): Promise<void> {
  await setUserLanguagePreference("zh-CN");
}

function createSensitiveScene(): IssueScene {
  const scene = {
    id: "scene-abc123",
    sessionId: "session-1",
    status: "committed",
    observedAtEpochMs: 1730000010000,
    page: {
      url: "https://example.com/issues/abc123/?from=internal",
      title: "订单详情",
      frameId: 0,
      viewport: { width: 1440, height: 900 },
      scrollX: 0,
      scrollY: 0,
      devicePixelRatio: 2,
    },
    target: {
      capturedAtEpochMs: 1730000010000,
      element: {
        tagName: "DIV",
        id: "order-submit",
        classNames: ["el-button", "is-disabled"],
        attributes: {
          "data-component-file": "src/components/Foo.tsx",
          "data-endpoint": "http://internal.api/v1/order",
        },
        text: "提交订单",
        role: "button",
        accessibleName: "提交订单",
        boundingBox: { x: 0, y: 0, width: 120, height: 40 },
        locators: [
          {
            kind: "css",
            expression: "div.el-button > span",
            matchCount: 1,
            stabilityScore: 0.9,
            reasons: ["unique"],
          },
        ],
        framework: {
          framework: "react",
          version: 18,
          componentName: "OrderSubmitButton",
          componentFile: "src/components/Foo.tsx",
          isTarget: true,
        },
      },
      ancestors: [],
      state: {},
      computedStyle: {},
    },
    narrative: {
      actual:
        "点击 src/components/Foo.tsx 里 div.el-button > span 后，请求 http://internal.api/v1/order 失败（sceneId=scene-abc123，见 /issues/abc123/）",
      expected: {
        text: "提交订单后应跳转到支付完成页",
        confidence: "explicit",
      },
    },
    annotation: {
      type: "arrow-box",
      color: "#ef233c",
      point: { xRatio: 0.5, yRatio: 0.5 },
    },
    screenshot: {
      status: "captured",
      originalAssetId: "asset-original",
      annotatedAssetId: "asset-annotated",
    },
    issues: [],
  };
  return scene as unknown as IssueScene;
}

test("deriveIsBug: explicit → defect，tag-only → suspected，missing → unknown", async () => {
  await useChinese();

  const defect = deriveIsBug(
    { text: "应该跳转到支付完成页", confidence: "explicit" },
    "点击后页面无反应"
  );
  assert.equal(defect.verdict, "defect");
  assert.ok(defect.reason.length > 0);
  assert.ok(defect.reason.includes("应该跳转到支付完成页"));

  const suspected = deriveIsBug(
    { text: "", tags: ["无反应", "报错"], confidence: "tag-only" },
    "点击后页面无反应"
  );
  assert.equal(suspected.verdict, "suspected");
  assert.ok(suspected.reason.length > 0);
  assert.ok(suspected.reason.includes("无反应"));

  const unknown = deriveIsBug(
    { text: "", confidence: "missing" },
    "点击后页面无反应"
  );
  assert.equal(unknown.verdict, "unknown");
  assert.ok(unknown.reason.length > 0);

  const noExpected = deriveIsBug(undefined, "点击后页面无反应");
  assert.equal(noExpected.verdict, "unknown");
  assert.ok(noExpected.reason.length > 0);
});

test("buildTicketQuestions: 五问齐全、顺序固定，eta 自动草稿为空占位", async () => {
  await useChinese();
  const scene = createSensitiveScene();
  const questions = buildTicketQuestions(scene);

  assert.equal(questions.length, 5);
  assert.deepEqual(
    questions.map((item) => item.id),
    ["symptom", "impact", "isBug", "workaround", "eta"]
  );
  assert.deepEqual(
    questions.map((item) => item.order),
    [1, 2, 3, 4, 5]
  );

  const symptom = questions[0];
  assert.equal(symptom.value, scene.narrative?.actual);

  assert.equal(questions[1].value, "");
  assert.equal(questions[2].value, "是缺陷");
  assert.equal(questions[3].value, "");

  const eta = questions[4];
  assert.equal(eta.value, "");
  assert.equal(eta.placeholder, "<待研发确认>");
  assert.ok(!/\d/.test(eta.value));
});

test("customer 版严格脱敏：不包含任何技术 token", async () => {
  await useChinese();
  const scene = createSensitiveScene();
  const questions = buildTicketQuestions(scene);
  const out = renderTicketMarkdown(questions, scene, "customer");

  const sensitiveTokens = [
    "src/components/Foo.tsx",
    "div.el-button > span",
    "http://internal.api/v1/order",
    "scene-abc123",
    "/issues/abc123/",
    "sceneId",
    "el-button",
    "asset-original",
    "asset-annotated",
  ];
  for (const token of sensitiveTokens) {
    assert.ok(
      !out.includes(token),
      `客户版不应包含敏感 token：${token}\n--- 输出 ---\n${out}`
    );
  }
});

test("internal 版保留技术细节：与客户版确实不同", async () => {
  await useChinese();
  const scene = createSensitiveScene();
  const questions = buildTicketQuestions(scene);
  const out = renderTicketMarkdown(questions, scene, "internal");

  const technicalTokens = [
    "src/components/Foo.tsx",
    "div.el-button > span",
    "http://internal.api/v1/order",
    "scene-abc123",
    "/issues/abc123/",
    "asset-original",
  ];
  for (const token of technicalTokens) {
    assert.ok(out.includes(token), `研发版应包含技术细节：${token}`);
  }
});

test("customer 版语言检查：不出现 DOM/selector/fiber/portal/className", async () => {
  await useChinese();
  const scene = createSensitiveScene();
  const out = renderTicketMarkdown(
    buildTicketQuestions(scene),
    scene,
    "customer"
  );

  for (const term of ["DOM", "selector", "fiber", "portal", "className"]) {
    assert.ok(
      !out.toLowerCase().includes(term.toLowerCase()),
      `客户版不应出现技术术语：${term}`
    );
  }
});

test("双受众输出都是合法 Markdown", async () => {
  await useChinese();
  const scene = createSensitiveScene();
  const questions = buildTicketQuestions(scene);

  for (const audience of ["internal", "customer"] as const) {
    const out = renderTicketMarkdown(questions, scene, audience);
    assert.ok(out.startsWith("#"), `${audience} 应以 # 开头`);
    assert.ok(out.includes("\n"), `${audience} 应包含换行`);
    assert.ok(out.length > 50);
  }
});
