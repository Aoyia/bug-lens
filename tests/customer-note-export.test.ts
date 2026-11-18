import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  CUSTOMER_NOTE_IMAGE_MAX_BYTES,
  buildCustomerNoteFile,
  buildCustomerNoteFilename,
  buildTicketQuestions,
  detectCustomerNoteLeaks,
  isCustomerNoteImageWithinLimit,
} from "../src/preview/ticket-compose.ts";
import { setUserLanguagePreference } from "../src/shared/i18n.ts";
import type { IssueScene } from "../src/shared/protocol.ts";

async function useChinese(): Promise<void> {
  await setUserLanguagePreference("zh-CN");
}

function createSensitiveScene(overrides: Record<string, unknown> = {}) {
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
    ...overrides,
  };
  return scene as unknown as IssueScene;
}

function readLocale(locale: "zh_CN" | "en") {
  return JSON.parse(
    readFileSync(
      path.resolve(process.cwd(), `src/_locales/${locale}/messages.json`),
      "utf8"
    )
  ) as Record<string, { message: string }>;
}

/** 用真实 messages.json 装扮 chrome.i18n，让 t() 走正常词条解析。 */
function installZhI18n(): () => void {
  const dict = readLocale("zh_CN");
  const previousChrome = (globalThis as { chrome?: unknown }).chrome;
  (globalThis as { chrome?: unknown }).chrome = {
    i18n: {
      getUILanguage: () => "zh-CN",
      getMessage: (key: string) => dict[key]?.message ?? "",
    },
  };
  return () => {
    if (previousChrome === undefined) {
      delete (globalThis as { chrome?: unknown }).chrome;
    } else {
      (globalThis as { chrome?: unknown }).chrome = previousChrome;
    }
  };
}

test("buildCustomerNoteFile：以 # 开头，含客户版正文，不含任何技术 token", async () => {
  const restore = installZhI18n();
  try {
    await useChinese();
    const scene = createSensitiveScene();
    const out = buildCustomerNoteFile(buildTicketQuestions(scene), scene);

    assert.ok(out.startsWith("# "), `客户版说明应以 # 开头\n---\n${out}`);
    // 现象文字（脱敏后仍保留的业务描述）
    assert.ok(out.includes("点击"), "应包含现象描述");
    assert.ok(out.includes("失败"), "应包含现象结论");
    assert.ok(out.includes("是缺陷"), "应包含缺陷结论");

    const forbidden = [
      "src/components/Foo.tsx",
      "div.el-button > span",
      "http://internal.api/x",
      "http://internal.api/v1/order",
      "scene-abc123",
      "/issues/abc123/",
      "## 研发版",
      "session-data.json",
      "el-button",
    ];
    for (const token of forbidden) {
      assert.equal(
        out.includes(token),
        false,
        `客户版单文件不应包含：${token}\n--- 输出 ---\n${out}`
      );
    }

    for (const term of ["DOM", "selector", "fiber", "portal", "className"]) {
      assert.equal(
        out.toLowerCase().includes(term.toLowerCase()),
        false,
        `客户版单文件不应出现技术术语：${term}`
      );
    }
  } finally {
    restore();
  }
});

test("buildCustomerNoteFile：有标注截图时内联 data URI，不留裸路径", async () => {
  const restore = installZhI18n();
  try {
    await useChinese();
    const scene = createSensitiveScene();
    const dataUri = "data:image/jpeg;base64,AAAA";
    const out = buildCustomerNoteFile(buildTicketQuestions(scene), scene, {
      annotatedImageDataUri: dataUri,
    });

    assert.ok(out.includes("![问题标注截图]"), "应输出 Markdown 图片语法");
    assert.ok(out.includes("data:image/jpeg;base64,"), "应内联 data URI");
    assert.ok(out.includes(dataUri), "应写入完整的 data URI");
    assert.equal(
      out.includes("screenshot-annotated"),
      false,
      "不应保留裂图裸路径"
    );
  } finally {
    restore();
  }
});

test("buildCustomerNoteFile：无标注截图时省略图片行并给出文字说明", async () => {
  const restore = installZhI18n();
  try {
    await useChinese();
    const scene = createSensitiveScene();
    const zh = readLocale("zh_CN");
    const out = buildCustomerNoteFile(buildTicketQuestions(scene), scene);

    assert.equal(out.includes("!["), false, "无图时不应出现 Markdown 图片");
    assert.equal(out.includes("data:image"), false, "无图时不应出现 data URI");
    assert.equal(out.includes("screenshot-annotated"), false);
    assert.ok(out.includes("未附截图"), "应给出 i18n 文字说明");
    assert.ok(out.includes(zh.customerNoteScreenshotMissing.message));
  } finally {
    restore();
  }
});

test("buildCustomerNoteFile：超过 1.5MB 时不内联，改为大图文字说明", async () => {
  const restore = installZhI18n();
  try {
    await useChinese();
    const scene = createSensitiveScene();
    const zh = readLocale("zh_CN");
    // base64 载荷长度 ≈ 2.8MB，解码后 ≈ 2.1MB，超过 1.5MB 上限
    const huge = `data:image/png;base64,${"A".repeat(2_800_000)}`;
    assert.equal(isCustomerNoteImageWithinLimit(huge), false);

    const out = buildCustomerNoteFile(buildTicketQuestions(scene), scene, {
      annotatedImageDataUri: huge,
    });
    assert.equal(out.includes("!["), false, "超限时不应输出图片语法");
    assert.equal(out.includes("data:image"), false, "超限时不应内联 data URI");
    assert.equal(out.includes("screenshot-annotated"), false);
    assert.ok(out.includes("截图为大图"), "应给出大图说明文案");
    assert.ok(out.includes(zh.customerNoteScreenshotTooLarge.message));
    assert.ok(out.length < 100_000, `超限时文件不应膨胀，实际 ${out.length}`);
  } finally {
    restore();
  }
});

test("isCustomerNoteImageWithinLimit：合法小图通过，非法/超限拒绝", () => {
  assert.equal(
    isCustomerNoteImageWithinLimit("data:image/jpeg;base64,AAAA"),
    true
  );
  assert.equal(
    isCustomerNoteImageWithinLimit("data:image/png;base64,AAAA"),
    true
  );
  assert.equal(
    isCustomerNoteImageWithinLimit("data:text/html;base64,AAAA"),
    false
  );
  assert.equal(
    isCustomerNoteImageWithinLimit("https://example.com/a.png"),
    false
  );
  assert.equal(isCustomerNoteImageWithinLimit(""), false);
  assert.equal(CUSTOMER_NOTE_IMAGE_MAX_BYTES, 1_572_864);

  const atLimit = `data:image/jpeg;base64,${"A".repeat(
    Math.floor(CUSTOMER_NOTE_IMAGE_MAX_BYTES / 3) * 4
  )}`;
  assert.equal(
    isCustomerNoteImageWithinLimit(atLimit),
    true,
    "正好 1.5MB 应允许内联"
  );
  const overLimit = `data:image/jpeg;base64,${"A".repeat(
    Math.floor(CUSTOMER_NOTE_IMAGE_MAX_BYTES / 3) * 4 + 4
  )}`;
  assert.equal(
    isCustomerNoteImageWithinLimit(overLimit),
    false,
    "超过 1.5MB 应拒绝"
  );
});

test("带图的客户版单文件仍不泄露技术 token", async () => {
  const restore = installZhI18n();
  try {
    await useChinese();
    const scene = createSensitiveScene();
    const out = buildCustomerNoteFile(buildTicketQuestions(scene), scene, {
      annotatedImageDataUri: "data:image/jpeg;base64,AAAA",
    });

    const forbidden = [
      "src/components/Foo.tsx",
      "div.el-button > span",
      "http://internal.api/x",
      "scene-abc123",
      "/issues/abc123/",
      "## 研发版",
      "asset-annotated",
      "asset-original",
    ];
    for (const token of forbidden) {
      assert.equal(out.includes(token), false, `不应包含：${token}`);
    }
    assert.ok(out.includes("![问题标注截图]"));
  } finally {
    restore();
  }
});

test("buildCustomerNoteFile：无 ticketDraft 的老场景仍可生成且不抛错", async () => {
  await useChinese();
  const scene = createSensitiveScene();
  assert.equal(scene.ticketDraft, undefined);

  const out = buildCustomerNoteFile(buildTicketQuestions(scene), scene);
  assert.ok(out.startsWith("# "));
  assert.ok(out.length > 50);
  assert.ok(out.includes("待补充") || out.includes("待研发确认"));
});

test("buildCustomerNoteFile：无场景/空五问时兜底不抛错", async () => {
  await useChinese();
  const out = buildCustomerNoteFile([], undefined);
  assert.ok(out.startsWith("# "));
  assert.ok(out.length > 0);
});

test("buildCustomerNoteFile：包含脱敏提示", async () => {
  const restore = installZhI18n();
  try {
    await useChinese();
    const zh = readLocale("zh_CN");
    const out = buildCustomerNoteFile(
      buildTicketQuestions(createSensitiveScene()),
      createSensitiveScene()
    );
    assert.ok(
      out.includes(zh.customerNotePrivacyNotice.message),
      "应包含 i18n 的脱敏提示文案"
    );
    assert.ok(out.includes(`> ${zh.customerNotePrivacyNotice.message}`));
  } finally {
    restore();
  }
});

test("buildCustomerNoteFilename：只用短标识，不含页面标题/客户名，.md 结尾", () => {
  const name = buildCustomerNoteFilename("session-1234567890");
  assert.match(name, /^bug-lens-customer-note-[a-z0-9]+\.md$/);
  assert.ok(name.endsWith(".md"));
  assert.equal(name.includes("订单详情"), false);
  assert.equal(name.includes("客户A"), false);
  assert.equal(name.includes("customer-a"), false);
  assert.ok(name.length <= "bug-lens-customer-note-".length + 8 + 3);
});

test("buildCustomerNoteFilename：标识缺失或含非法字符时安全兜底", () => {
  assert.equal(buildCustomerNoteFilename(), "bug-lens-customer-note-note.md");
  const name = buildCustomerNoteFilename("../订单/../../客户A");
  assert.match(name, /^bug-lens-customer-note-[a-z0-9]*\.md$/);
  assert.equal(name.includes(".."), false);
  assert.equal(name.includes("/"), false);
});

test("detectCustomerNoteLeaks：命中可疑残留，干净文本返回空数组", () => {
  assert.deepEqual(detectCustomerNoteLeaks("点击后页面无反应，请协助排查"), []);
  const leaks = detectCustomerNoteLeaks(
    "请求 http://internal.api/x 失败，见 /issues/abc123/，组件 src/components/Foo.tsx"
  );
  assert.ok(leaks.includes("http://"));
  assert.ok(leaks.includes("/issues/"));
  assert.ok(leaks.includes(".tsx"));
});

test("客户版单文件导出相关 i18n key 中英齐备", () => {
  const keys = [
    "exportCustomerNote",
    "exportCustomerNoteTitle",
    "customerNotePrivacyNotice",
    "customerNoteDefaultTitle",
    "customerNoteExported",
    "customerNoteExportFailed",
    "customerNoteLeakWarning",
    "customerNoteScreenshotHeading",
    "customerNoteScreenshotAlt",
    "customerNoteScreenshotMissing",
    "customerNoteScreenshotTooLarge",
  ];
  for (const locale of ["zh_CN", "en"] as const) {
    const dict = readLocale(locale);
    for (const key of keys) {
      assert.ok(dict[key]?.message, `${locale}/messages.json 缺少 ${key}`);
    }
  }
});
