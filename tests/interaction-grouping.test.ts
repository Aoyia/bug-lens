import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  compactSemanticLabel,
  groupInteractions,
  isSameElement,
  type TranslateFn,
} from "../src/domain/interaction-grouping.ts";
import type { InteractionRecord } from "../src/shared/protocol.ts";
import { t } from "../src/shared/i18n.ts";

/** 基于真实 locale 字典构造翻译函数：既保持中英文语义断言，也校验新 i18n key 真实存在。 */
function translatorFromLocale(locale: "en" | "zh_CN"): TranslateFn {
  const dict = JSON.parse(
    readFileSync(
      resolve(process.cwd(), `src/_locales/${locale}/messages.json`),
      "utf8"
    )
  ) as Record<string, { message: string }>;
  return (key, substitutions) => t(key, substitutions, dict);
}
const zh = translatorFromLocale("zh_CN");
const en = translatorFromLocale("en");

function mockRecord(overrides: Partial<InteractionRecord>): InteractionRecord {
  return {
    id: crypto.randomUUID(),
    sessionId: "test-session",
    kind: "click",
    status: "confirmed",
    createdAt: Date.now(),
    page: { url: "https://www.google.com/webhp", title: "Google", frameId: 0 },
    input: { pointerType: "mouse", button: 0, isTrusted: true },
    coordinates: {
      clientX: 100,
      clientY: 100,
      pageX: 100,
      pageY: 100,
      scrollX: 0,
      scrollY: 0,
      devicePixelRatio: 2,
      viewport: { width: 800, height: 600 },
    },
    element: {
      tagName: "textarea",
      id: "APjFqb",
      classNames: ["gLFyf"],
      attributes: { name: "q" },
      boundingBox: { x: 10, y: 10, width: 200, height: 40 },
      locators: [
        {
          kind: "id",
          expression: "#APjFqb",
          matchCount: 1,
          stabilityScore: 0.9,
          reasons: ["ID"],
        },
      ],
    },
    screenshot: { status: "pending" },
    ...overrides,
  };
}

test("isSameElement 准确判断相同或不同元素", () => {
  const elemA = mockRecord({
    element: {
      tagName: "textarea",
      id: "APjFqb",
      classNames: [],
      attributes: {},
      boundingBox: { x: 0, y: 0, width: 100, height: 20 },
      locators: [
        {
          kind: "id",
          expression: "#APjFqb",
          matchCount: 1,
          stabilityScore: 0.9,
          reasons: [],
        },
      ],
    },
  }).element;
  const elemB = mockRecord({
    element: {
      tagName: "textarea",
      id: "APjFqb",
      classNames: [],
      attributes: {},
      boundingBox: { x: 0, y: 0, width: 100, height: 20 },
      locators: [
        {
          kind: "id",
          expression: "#APjFqb",
          matchCount: 1,
          stabilityScore: 0.9,
          reasons: [],
        },
      ],
    },
  }).element;
  const elemC = mockRecord({
    element: {
      tagName: "button",
      id: "btn-submit",
      classNames: [],
      attributes: {},
      boundingBox: { x: 0, y: 0, width: 100, height: 20 },
      locators: [
        {
          kind: "id",
          expression: "#btn-submit",
          matchCount: 1,
          stabilityScore: 0.9,
          reasons: [],
        },
      ],
    },
  }).element;

  assert.equal(isSameElement(elemA, elemB), true);
  assert.equal(isSameElement(elemA, elemC), false);
});

test("5 条搜索相关交互 (click, input, input, keydown Enter, change) 被聚合成 1 个 form_input_submit 卡片", () => {
  const baseTime = 1785650190000;
  const records: InteractionRecord[] = [
    mockRecord({ id: "rec-1", kind: "click", createdAt: baseTime + 60.068 }),
    mockRecord({
      id: "rec-2",
      kind: "input",
      createdAt: baseTime + 816,
      metadata: { inputType: "insertText", valueLength: 5 },
    }),
    mockRecord({
      id: "rec-3",
      kind: "input",
      createdAt: baseTime + 3047,
      metadata: { inputType: "insertText", valueLength: 11 },
    }),
    mockRecord({
      id: "rec-4",
      kind: "keydown",
      createdAt: baseTime + 6613,
      metadata: { key: "Enter", code: "Enter" },
    }),
    mockRecord({
      id: "rec-5",
      kind: "change",
      createdAt: baseTime + 7233,
      metadata: { valueLength: 11 },
    }),
  ];

  const cards = groupInteractions(records, zh, 4000);

  assert.equal(cards.length, 1);
  const card = cards[0];
  assert.equal(card.kind, "form_input_submit");
  assert.equal(card.children.length, 5);
  assert.equal(card.aggregatedMeta.hasEnterSubmit, true);
  assert.equal(card.aggregatedMeta.finalValueLength, 11);
  assert.equal(card.aggregatedMeta.title.includes("输入并回车提交"), true);
});

test("超出的时间窗口（如间隔大于 3 秒）自动打断开辟新卡片", () => {
  const baseTime = 100000;
  const records: InteractionRecord[] = [
    mockRecord({ id: "rec-1", kind: "click", createdAt: baseTime }),
    mockRecord({ id: "rec-2", kind: "input", createdAt: baseTime + 1000 }),
    // 间隔 5000ms > 3000ms 默认窗口
    mockRecord({
      id: "rec-3",
      kind: "keydown",
      createdAt: baseTime + 6000,
      metadata: { key: "Enter" },
    }),
  ];

  const cards = groupInteractions(records, zh, 3000);

  assert.equal(cards.length, 2);
  assert.equal(cards[0].children.length, 2);
  assert.equal(cards[1].children.length, 1);
});

test("不同元素的交互不会被错误合并", () => {
  const baseTime = 100000;
  const recordA = mockRecord({
    id: "rec-1",
    kind: "click",
    createdAt: baseTime,
  });
  const recordB = mockRecord({
    id: "rec-2",
    kind: "click",
    createdAt: baseTime + 500,
    element: {
      tagName: "button",
      id: "btn-search",
      classNames: ["btn"],
      attributes: {},
      boundingBox: { x: 500, y: 10, width: 80, height: 30 },
      locators: [
        {
          kind: "id",
          expression: "#btn-search",
          matchCount: 1,
          stabilityScore: 0.9,
          reasons: [],
        },
      ],
    },
  });

  const cards = groupInteractions([recordA, recordB], zh);

  assert.equal(cards.length, 2);
  assert.equal(cards[0].kind, "atomic");
  assert.equal(cards[1].kind, "atomic");
});

test("步骤卡片标题与描述随界面语言（翻译函数）输出中英文", () => {
  const baseTime = 100000;
  const records: InteractionRecord[] = [
    mockRecord({
      id: "rec-1",
      kind: "click",
      createdAt: baseTime,
      element: {
        tagName: "button",
        id: "btn-submit",
        classNames: [],
        attributes: {},
        boundingBox: { x: 0, y: 0, width: 80, height: 30 },
        locators: [
          {
            kind: "id",
            expression: "#btn-submit",
            matchCount: 1,
            stabilityScore: 0.9,
            reasons: [],
          },
        ],
      },
    }),
    mockRecord({
      id: "rec-2",
      kind: "input",
      createdAt: baseTime + 500,
      metadata: { inputType: "insertText", valueLength: 11 },
    }),
  ];

  const zhCards = groupInteractions(records, zh, 3000);
  const enCards = groupInteractions(records, en, 3000);

  // 单条 click 标题：跟随语言（无括号，ID 前置 #）
  assert.equal(zhCards[0].aggregatedMeta.title, "点击 #btn-submit");
  assert.equal(enCards[0].aggregatedMeta.title, "Click #btn-submit");
  // 输入脱敏描述：跟随语言
  assert.equal(zhCards[1].aggregatedMeta.description, "输入: 11 字符 (脱敏)");
  assert.equal(
    enCards[1].aggregatedMeta.description,
    "Input: 11 chars (redacted)"
  );
});

test("操作时间轴（InteractionsTab）卡片标题意图优先语义提升，消除点击 (i) 与裸标签", () => {
  const baseTime = 1718000000000;
  const records = [
    // 1. 真实弹窗关闭图标：i 标签，无文本，包含 el-dialog__close el-icon el-icon-close 类名
    mockRecord({
      id: "rec-close",
      kind: "click",
      createdAt: baseTime,
      element: {
        tagName: "I",
        classNames: ["el-dialog__close", "el-icon", "el-icon-close"],
        text: "i",
        attributes: {},
        boundingBox: { x: 10, y: 10, width: 16, height: 16 },
        locators: [],
      },
    }),
    // 2. 详情图标：i 标签，带有 el-icon-info
    mockRecord({
      id: "rec-info",
      kind: "click",
      createdAt: baseTime + 1000,
      element: {
        tagName: "I",
        classNames: ["el-icon", "el-icon-info"],
        text: "i",
        attributes: {},
        boundingBox: { x: 10, y: 10, width: 16, height: 16 },
        locators: [],
      },
    }),
    // 3. 常见 span 文本
    mockRecord({
      id: "rec-span",
      kind: "click",
      createdAt: baseTime + 2000,
      element: {
        tagName: "SPAN",
        classNames: ["el-tag"],
        text: "单人验收",
        attributes: {},
        boundingBox: { x: 10, y: 10, width: 60, height: 20 },
        locators: [],
      },
    }),
    // 4. 特殊业务符号 "《"
    mockRecord({
      id: "rec-collapse",
      kind: "click",
      createdAt: baseTime + 3000,
      element: {
        tagName: "DIV",
        classNames: ["sidebar-toggle"],
        text: "《",
        attributes: {},
        boundingBox: { x: 10, y: 10, width: 24, height: 24 },
        locators: [],
      },
    }),
  ];

  const cards = groupInteractions(records, zh, 3000);

  // 1. 关闭图标消除 "点击 (i)"，升级为 "点击 关闭图标"
  assert.equal(cards[0].aggregatedMeta.title, "点击 关闭图标");
  // 2. 详情图标消除 "点击 (i)"，升级为 "点击 详情/提示图标"
  assert.equal(cards[1].aggregatedMeta.title, "点击 详情/提示图标");
  // 3. 文本卡片统一双引号包裹且不暴露底层标签
  assert.equal(cards[2].aggregatedMeta.title, '点击 "单人验收"');
  // 4. 特殊符号升级为意图
  assert.equal(cards[3].aggregatedMeta.title, '点击 折叠/返回 "《"');
});

test("超长面包屑智能裁剪：<=60 字符完整保留，>60 字符保留首段与末端核心节点", () => {
  const shortBreadcrumb =
    "应用详情 / 各种测试放这里 (bpm应用) / 单元管理 / 组件开发对照-H5";
  assert.equal(compactSemanticLabel(shortBreadcrumb), shortBreadcrumb);

  const longBreadcrumb =
    "应用详情 / 各种测试放这里非常长非常长的中间层级业务目录模块名称 (bpm应用中心测试环境) / 单元管理 / 组件开发对照-H5";
  const compacted = compactSemanticLabel(longBreadcrumb);
  assert.ok(compacted.startsWith("应用详情 / … / "));
  assert.ok(compacted.endsWith("组件开发对照-H5"));
  assert.ok(compacted.length <= 60);

  const rec = mockRecord({
    id: "rec-h2",
    kind: "click",
    element: {
      tagName: "H2",
      text: shortBreadcrumb,
      classNames: [],
      attributes: {},
      boundingBox: { x: 0, y: 0, width: 100, height: 20 },
      locators: [],
    },
  });
  assert.equal(
    groupInteractions([rec], zh)[0].aggregatedMeta.title,
    `点击 "${shortBreadcrumb}"`
  );
  assert.equal(
    groupInteractions([rec], en)[0].aggregatedMeta.title,
    `Click "${shortBreadcrumb}"`
  );
});

test("isSameElement 与分组不误合并无 id 同 role 按钮，也不拆散定位器演变的同一无 id 输入框", () => {
  const baseTime = 1785650250000;
  // 1. 两个不同坐标的无 id <button>（均产生 role=button）不得合并
  const saveBtn = mockRecord({
    id: "btn-save",
    kind: "click",
    createdAt: baseTime,
    element: {
      tagName: "button",
      classNames: ["primary"],
      text: "保存",
      attributes: {},
      boundingBox: { x: 20, y: 20, width: 80, height: 32 },
      locators: [
        {
          kind: "role",
          expression: "role=button",
          matchCount: 2,
          stabilityScore: 0.86,
          reasons: [],
        },
      ],
    },
  });
  const cancelBtn = mockRecord({
    id: "btn-cancel",
    kind: "click",
    createdAt: baseTime + 500,
    element: {
      tagName: "button",
      classNames: ["default"],
      text: "取消",
      attributes: {},
      boundingBox: { x: 120, y: 20, width: 80, height: 32 },
      locators: [
        {
          kind: "role",
          expression: "role=button",
          matchCount: 2,
          stabilityScore: 0.86,
          reasons: [],
        },
      ],
    },
  });
  assert.equal(isSameElement(saveBtn.element, cancelBtn.element), false);
  const btnCards = groupInteractions([saveBtn, cancelBtn], zh, 3000);
  assert.equal(btnCards.length, 2);

  // 2. 同坐标无 id <input>：click 时为 css=input，input 后变成 text=hello，仍应合并为 1 步
  const clickInput = mockRecord({
    id: "inp-click",
    kind: "click",
    createdAt: baseTime + 5000,
    element: {
      tagName: "input",
      classNames: ["el-input__inner"],
      attributes: {},
      boundingBox: { x: 40, y: 100, width: 200, height: 32 },
      locators: [
        {
          kind: "css",
          expression: "input",
          matchCount: 3,
          stabilityScore: 0.25,
          reasons: [],
        },
      ],
    },
  });
  const typeInput = mockRecord({
    id: "inp-type",
    kind: "input",
    createdAt: baseTime + 5400,
    element: {
      tagName: "input",
      classNames: ["el-input__inner"],
      text: "hello",
      attributes: {},
      boundingBox: { x: 40, y: 100, width: 200, height: 32 },
      locators: [
        {
          kind: "text",
          expression: "hello",
          matchCount: 1,
          stabilityScore: 0.6,
          reasons: [],
        },
      ],
    },
    metadata: { value: "hello", valueLength: 5 },
  });
  assert.equal(isSameElement(clickInput.element, typeInput.element), true);
  const inputCards = groupInteractions([clickInput, typeInput], zh, 3000);
  assert.equal(inputCards.length, 1);
  assert.deepEqual(
    inputCards[0].children.map((c) => c.id),
    ["inp-click", "inp-type"]
  );
});
