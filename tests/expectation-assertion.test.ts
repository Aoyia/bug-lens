import test from "node:test";
import assert from "node:assert";
import { transformSync } from "esbuild";
import {
  deriveAssertions,
  type DerivedAssertion,
} from "../src/preview/expectation-assertion.ts";
import { generatePlaywrightScript } from "../src/preview/playwright-generator.ts";
import type {
  ExpectedStatement,
  InteractionRecord,
  RecordingSession,
} from "../src/shared/protocol.ts";

function explicit(text: string, tags?: string[]): ExpectedStatement {
  return tags
    ? { text, tags, confidence: "explicit" }
    : { text, confidence: "explicit" };
}

function single(
  expected: ExpectedStatement | undefined,
  ctx: { targetSelector?: string; pageUrl?: string } = {}
): DerivedAssertion {
  const result = deriveAssertions(expected, ctx);
  assert.equal(result.length, 1, `应只派生 1 条断言，实际 ${result.length}`);
  return result[0];
}

/** 断言代码片段可被 TypeScript 语法解析（不做类型检查） */
function assertParses(code: string): void {
  const snippet = [
    "import { test, expect } from '@playwright/test';",
    "test('syntax', async ({ page }) => {",
    `  ${code}`,
    "});",
  ].join("\n");
  assert.doesNotThrow(
    () => transformSync(snippet, { loader: "ts" }),
    `派生断言必须是合法 TypeScript：${code}`
  );
}

test("跳转规则：中文 URL 片段 → toHaveURL（high）", () => {
  const result = single(explicit("点击提交后跳转到 /orders/123 页"));
  assert.equal(result.confidence, "high");
  assert.equal(result.code, "await expect(page).toHaveURL(/\\/orders\\/123/);");
});

test("跳转规则：英文绝对 URL → toHaveURL 且特殊字符被转义（high）", () => {
  const result = single(
    explicit("should navigate to https://example.com/order?id=1")
  );
  assert.equal(result.confidence, "high");
  assert.equal(
    result.code,
    "await expect(page).toHaveURL(/https:\\/\\/example\\.com\\/order\\?id=1/);"
  );
});

test("跳转规则：中文页名无 URL → 降级为文本可见性断言（low）", () => {
  const result = single(explicit("点击保存后进入订单详情页"));
  assert.equal(result.confidence, "low");
  assert.equal(
    result.code,
    "await expect(page.getByText('订单详情页')).toBeVisible();"
  );
  assert.match(result.rationale, /未给出 URL 片段/);
});

test("显示规则：中文「」包裹实体（high）", () => {
  const result = single(explicit("点击后应显示「提交成功」"));
  assert.equal(result.confidence, "high");
  assert.equal(
    result.code,
    "await expect(page.getByText('提交成功')).toBeVisible();"
  );
});

test("显示规则：英文单引号实体（high）", () => {
  const result = single(explicit("should show 'Order Detail'"));
  assert.equal(result.confidence, "high");
  assert.equal(
    result.code,
    "await expect(page.getByText('Order Detail')).toBeVisible();"
  );
});

test("显示规则：无引号裸文本取谓语后整句（high）", () => {
  const result = single(explicit("点击提交后显示提交成功"));
  assert.equal(result.confidence, "high");
  assert.equal(
    result.code,
    "await expect(page.getByText('提交成功')).toBeVisible();"
  );
});

test("消失规则：有 targetSelector → toBeHidden（high）", () => {
  const zh = single(explicit("保存后弹窗应该消失"), {
    targetSelector: "#dialog",
  });
  assert.equal(zh.confidence, "high");
  assert.equal(zh.code, "await expect(page.locator('#dialog')).toBeHidden();");

  const en = single(explicit("the dialog should not be visible"), {
    targetSelector: "#modal",
  });
  assert.equal(en.confidence, "high");
  assert.equal(en.code, "await expect(page.locator('#modal')).toBeHidden();");
});

test("消失规则：无 selector 用文本反向断言（low）", () => {
  const result = single(explicit("「保存成功」提示应该消失"));
  assert.equal(result.confidence, "low");
  assert.equal(
    result.code,
    "await expect(page.getByText('保存成功')).toBeHidden();"
  );
  assert.match(result.rationale, /缺少目标选择器/);
});

test("变更规则：有 selector → toHaveText（high）", () => {
  const zh = single(explicit("订单状态改为「已发货」"), {
    targetSelector: "#status",
  });
  assert.equal(zh.confidence, "high");
  assert.equal(
    zh.code,
    "await expect(page.locator('#status')).toHaveText(/已发货/);"
  );

  const en = single(explicit("the status is updated to 'Shipped'"), {
    targetSelector: "#status",
  });
  assert.equal(en.confidence, "high");
  assert.equal(
    en.code,
    "await expect(page.locator('#status')).toHaveText(/Shipped/);"
  );
});

test("变更规则：无 selector → 降级文本可见性（low）", () => {
  const result = single(explicit("按钮文案变成「已保存」"));
  assert.equal(result.confidence, "low");
  assert.equal(
    result.code,
    "await expect(page.getByText('已保存')).toBeVisible();"
  );
  assert.match(result.rationale, /缺少目标选择器/);
});

test("清空规则：中英文均生成 toHaveValue('') （high）", () => {
  const zh = single(explicit("搜索框应该被清空"), {
    targetSelector: "#search",
  });
  assert.equal(zh.confidence, "high");
  assert.equal(
    zh.code,
    "await expect(page.locator('#search')).toHaveValue('');"
  );

  const en = single(explicit("the search field should be empty"), {
    targetSelector: "#search",
  });
  assert.equal(
    en.code,
    "await expect(page.locator('#search')).toHaveValue('');"
  );
});

test("报错规则：中英文错误提示 → 文本可见（high）", () => {
  const zh = single(explicit("页面报错「请求超时」"));
  assert.equal(zh.confidence, "high");
  assert.equal(
    zh.code,
    "await expect(page.getByText('请求超时')).toBeVisible();"
  );

  const en = single(explicit('should surface error "Payment declined"'));
  assert.equal(en.confidence, "high");
  assert.equal(
    en.code,
    "await expect(page.getByText('Payment declined')).toBeVisible();"
  );
});

test("泛化结果词（成功/失败/正常）无对象 → 不派生断言", () => {
  assert.deepEqual(deriveAssertions(explicit("提交成功")), []);
  assert.deepEqual(deriveAssertions(explicit("操作失败")), []);
  assert.deepEqual(deriveAssertions(explicit("should work normally")), []);
});

test("其它文本 → 不派生断言", () => {
  assert.deepEqual(deriveAssertions(explicit("这个按钮不太好用")), []);
});

test("tag-only → 一条 code 为空的低置信度提示", () => {
  const result = single({
    text: "",
    tags: ["按钮无响应"],
    confidence: "tag-only",
  });
  assert.equal(result.code, "");
  assert.equal(result.confidence, "low");
  assert.match(result.rationale, /仅有症状标签/);
});

test("missing / 空 text / undefined → 空数组", () => {
  assert.deepEqual(deriveAssertions({ text: "", confidence: "missing" }), []);
  assert.deepEqual(
    deriveAssertions({ text: "  ", confidence: "explicit" }),
    []
  );
  assert.deepEqual(deriveAssertions(undefined), []);
});

test("实体含单引号时字符串正确转义且语法合法", () => {
  const result = single(explicit('should show "User\'s Order"'));
  assert.equal(
    result.code,
    "await expect(page.getByText('User\\'s Order')).toBeVisible();"
  );
  assertParses(result.code);
});

test("URL 实体含正则特殊字符全部转义且语法合法", () => {
  const result = single(explicit("跳转到 /orders/(new).json?a=1"));
  assert.equal(
    result.code,
    "await expect(page).toHaveURL(/\\/orders\\/\\(new\\)\\.json\\?a=1/);"
  );
  assertParses(result.code);
});

test("多条子句最多 3 条断言，且 high 排在 low 前", () => {
  const result = deriveAssertions(
    explicit("原提示消失；页面显示「已保存」；状态改为「完成」；搜索框被清空")
  );
  assert.equal(result.length, 3);
  assert.equal(result[0].confidence, "high");
  const firstLowIndex = result.findIndex((item) => item.confidence === "low");
  if (firstLowIndex >= 0) {
    for (const item of result.slice(firstLowIndex)) {
      assert.equal(item.confidence, "low");
    }
  }
});

test("所有派生断言都能被 esbuild 以 TS 语法解析", () => {
  const samples: Array<{
    expected: ExpectedStatement;
    ctx?: { targetSelector?: string; pageUrl?: string };
  }> = [
    { expected: explicit("跳转到 /orders/123 页") },
    { expected: explicit("should navigate to https://a.com/x?y=1") },
    { expected: explicit("显示「提交成功」") },
    { expected: explicit("should show 'Order Detail'") },
    { expected: explicit("弹窗消失"), ctx: { targetSelector: "#dialog" } },
    { expected: explicit("提示应该消失") },
    { expected: explicit("状态改为「已发货」"), ctx: { targetSelector: "#s" } },
    { expected: explicit("文案变成「已保存」") },
    { expected: explicit("输入框被清空"), ctx: { targetSelector: "#q" } },
    { expected: explicit("输入框为空"), ctx: { targetSelector: "#q" } },
    { expected: explicit("报错「请求超时」") },
    { expected: explicit('should show "User\'s Order"') },
    { expected: explicit("跳转到 /a/(b).json") },
  ];
  let checked = 0;
  for (const sample of samples) {
    for (const assertion of deriveAssertions(sample.expected, sample.ctx)) {
      if (!assertion.code) continue;
      assertParses(assertion.code);
      checked += 1;
    }
  }
  assert.ok(
    checked >= samples.length,
    `应校验到 ${samples.length} 条以上，实际 ${checked}`
  );
});

const session: RecordingSession = {
  id: "session-expect-001",
  createdAt: 1700000000000,
  target: { initialUrl: "https://shop.example.com/checkout" },
  options: { privacyMode: "safe" },
  timeline: {
    createdAtEpochMs: 1700000000000,
    startedAtEpochMs: 1700000000000,
  },
  stats: { interactionCount: 1, durationMs: 1500 },
};

const interactions: InteractionRecord[] = [
  {
    id: "step-1",
    sessionId: "session-expect-001",
    kind: "click",
    createdAt: 1700000001000,
    coordinates: {
      clientX: 10,
      clientY: 20,
      pageX: 10,
      pageY: 20,
      scrollX: 0,
      scrollY: 0,
      devicePixelRatio: 1,
      viewport: { width: 1280, height: 800 },
    },
    element: {
      tagName: "button",
      id: "submit-order",
      classNames: ["btn"],
      attributes: {},
      text: "提交订单",
      boundingBox: { x: 10, y: 20, width: 100, height: 32 },
      locators: [
        {
          kind: "id",
          expression: "#submit-order",
          matchCount: 1,
          stabilityScore: 0.9,
          reasons: ["唯一 id"],
        },
      ],
    },
  },
];

test("集成：有 explicit 预期时生成可解析的派生断言", () => {
  const script = generatePlaywrightScript({
    session,
    interactions,
    consoleEntries: [],
    networkEntries: [],
    issueScene: {
      narrative: {
        expected: explicit("点击提交后显示「提交成功」"),
      },
      target: {
        element: {
          tagName: "button",
          id: "submit-order",
          locators: [
            {
              kind: "id",
              expression: "#submit-order",
              matchCount: 1,
              stabilityScore: 0.9,
            },
          ],
        },
      },
      page: { url: "https://shop.example.com/checkout" },
    },
  });

  assert.match(
    script,
    /\/\/ 预期（来源：issueScenes\[\]\.scene\.narrative\.expected）：点击提交后显示「提交成功」/
  );
  assert.ok(
    script.includes("await expect(page.getByText('提交成功')).toBeVisible();"),
    "生成的脚本必须包含派生断言"
  );
  assert.doesNotMatch(script, /TODO: 缺少可判定的预期结果/);
  assert.doesNotThrow(() => transformSync(script, { loader: "ts" }));
});

test("集成：无预期时保留原 TODO 并追加人工补充提示", () => {
  const script = generatePlaywrightScript({
    session,
    interactions,
    consoleEntries: [],
    networkEntries: [],
  });

  assert.ok(
    script.includes("// No console errors or network failures were recorded")
  );
  assert.ok(
    script.includes("// Add assertions here to verify the expected page state")
  );
  assert.ok(script.includes("// TODO: 缺少可判定的预期结果，请人工补充断言"));
  assert.doesNotThrow(() => transformSync(script, { loader: "ts" }));
});

test("集成：tag-only 预期不派生断言，输出提示与 TODO", () => {
  const script = generatePlaywrightScript({
    session,
    interactions,
    consoleEntries: [],
    networkEntries: [],
    issueScene: {
      narrative: {
        expected: { text: "", tags: ["按钮无响应"], confidence: "tag-only" },
      },
    },
  });

  assert.ok(script.includes("// 仅有症状标签"));
  assert.ok(script.includes("// TODO: 缺少可判定的预期结果，请人工补充断言"));
  assert.doesNotThrow(() => transformSync(script, { loader: "ts" }));
});

test("集成：隐藏类预期用现场 target 推导选择器", () => {
  const script = generatePlaywrightScript({
    session,
    interactions,
    consoleEntries: [],
    networkEntries: [],
    issueScene: {
      narrative: { expected: explicit("点击提交后弹窗消失") },
      target: {
        element: {
          tagName: "div",
          id: "coupon-modal",
          locators: [
            {
              kind: "css",
              expression: "#coupon-modal",
              matchCount: 1,
              stabilityScore: 0.8,
            },
          ],
        },
      },
    },
  });

  assert.ok(
    script.includes("await expect(page.locator('#coupon-modal')).toBeHidden();")
  );
});
