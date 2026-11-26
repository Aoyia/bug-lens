import test from "node:test";
import assert from "node:assert/strict";
import {
  buildEvidencePackage,
  buildTicketBundle,
  buildTicketHtml,
  buildTicketTemplate,
  formatTicketInteractions,
  uint8ArrayToBase64,
  type EvidencePackageSnapshot,
  type StaticReportAssets,
} from "../src/preview/evidence-package.ts";
import { groupInteractions } from "../src/domain/interaction-grouping.ts";
import { PreviewController } from "../src/preview/preview-controller.ts";
import { setUserLanguagePreference, t } from "../src/shared/i18n.ts";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  ConsoleEntry,
  InteractionRecord,
  IssueScene,
  NetworkEntry,
  RecordingSession,
} from "../src/shared/protocol.ts";

function session(): RecordingSession {
  return {
    id: "session-12345678-abcd",
    schemaVersion: 2,
    extensionVersion: "0.7.41",
    status: "PREVIEW_READY",
    target: {
      tabId: 1,
      initialUrl: "https://example.com",
      initialTitle: "Page",
    },
    options: { privacyMode: "safe" },
    timeline: {
      createdAtEpochMs: 1730000000000,
      startedAtEpochMs: 1730000000000,
      durationMs: 15000,
    },
    quality: { overall: "complete", issues: [] },
    nonce: "n",
  } as unknown as RecordingSession;
}

function interaction(
  id: string,
  kind: InteractionRecord["kind"],
  createdAt: number,
  element: Partial<InteractionRecord["element"]>
): InteractionRecord {
  return {
    id,
    sessionId: "s",
    kind,
    status: "confirmed",
    createdAt,
    page: { url: "https://example.com", title: "Home", frameId: 0 },
    input: { pointerType: "mouse", button: 0, isTrusted: true },
    coordinates: {
      clientX: 10,
      clientY: 10,
      pageX: 10,
      pageY: 10,
      scrollX: 0,
      scrollY: 0,
      devicePixelRatio: 1,
      viewport: { width: 1280, height: 720 },
    },
    element: { tagName: "BUTTON", classNames: [], ...element } as never,
    screenshot: { status: "captured" },
  } as InteractionRecord;
}

function snapshot(
  overrides: Partial<EvidencePackageSnapshot> = {}
): EvidencePackageSnapshot {
  return {
    session: session(),
    interactions: [],
    consoleEntries: [],
    networkEntries: [],
    excluded: { interaction: 0, console: 0, network: 0 },
    hasMedia: false,
    ...overrides,
  };
}

const focusClick = interaction("click-1", "click", 1000, {
  tagName: "TEXTAREA",
  id: "content",
});
const typed = interaction("input-1", "input", 2000, {
  tagName: "TEXTAREA",
  id: "content",
  text: "Please enter content",
});
typed.metadata = { valueLength: 20 };
const submit = interaction("click-2", "click", 9000, {
  tagName: "BUTTON",
  text: "Submit",
});

test("formatTicketInteractions: 合并步骤收集全部底层 ID，避免删除后聚焦点击复活", async () => {
  await setUserLanguagePreference("zh-CN");
  const steps = formatTicketInteractions([focusClick, typed, submit], false);
  assert.equal(steps.length, 2);
  assert.equal(steps[0].interactionId, "input-1");
  assert.deepEqual(steps[0].interactionIds, ["click-1", "input-1"]);
  assert.deepEqual(steps[1].interactionIds, ["click-2"]);

  const controller = new PreviewController();
  controller.excludeMany("interaction", steps[0].interactionIds);
  const remaining = formatTicketInteractions(
    controller.includedInteractions([focusClick, typed, submit]),
    false
  );
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].stepNum, 1);
  assert.equal(remaining[0].interactionId, "click-2");
});

test("formatTicketInteractions: 不同 id 或不同坐标的输入框点击+输入不错误合并", () => {
  const clickInputA = interaction("c-a", "click", 1000, {
    tagName: "INPUT",
    id: "field-a",
  });
  const typeInputB = interaction("i-b", "input", 2000, {
    tagName: "INPUT",
    id: "field-b",
  });
  const steps = formatTicketInteractions([clickInputA, typeInputB], false);
  assert.equal(steps.length, 2);
  assert.deepEqual(steps[0].interactionIds, ["c-a"]);
  assert.deepEqual(steps[1].interactionIds, ["i-b"]);
});

test("自定义步骤文案与问题说明在 Markdown 与 HTML 中同步生效，清空后还原默认", async () => {
  await setUserLanguagePreference("zh-CN");
  const base = snapshot({ interactions: [submit] });
  const customized = snapshot({
    interactions: [submit],
    ticketCuration: {
      excludedScreenshotInteractionIds: new Set(),
      customStepDescriptions: { "click-2": "提交 <工单> 表单" },
      customTicketNarrative: { actual: "提交后白屏", expected: "跳转成功页" },
    },
  });

  const md = buildTicketTemplate(customized);
  assert.ok(md.includes("1. 提交 <工单> 表单"));
  assert.ok(md.includes("- 实际表现：提交后白屏"));
  assert.ok(md.includes("- 预期表现：跳转成功页"));

  const html = buildTicketHtml(customized);
  assert.ok(html.includes("提交 &lt;工单&gt; 表单"));
  assert.ok(!html.includes("<工单>"));
  assert.ok(html.includes('data-ticket-slot="narrative-expected"'));
  assert.ok(html.includes('data-custom="true"'));

  const defaults = buildTicketTemplate(base);
  assert.ok(defaults.includes('1. 点击 "Submit"'));
  assert.ok(!defaults.includes("预期表现"));
  assert.ok(buildTicketHtml(base).includes('data-placeholder="true"'));
});

test("仅移除截图（选项 A）：HTML/ZIP/session-data 同步剔除截图而保留步骤文字", async () => {
  await setUserLanguagePreference("zh-CN");
  const bytes1 = new Uint8Array([0xff, 0xd8, 0xff, 0x01]);
  const bytes2 = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  const withShots = snapshot({
    interactions: [typed, submit],
    interactionAssets: [
      {
        interactionId: "input-1",
        bytes: bytes1,
        mimeType: "image/jpeg",
        width: 1280,
        height: 720,
      },
      {
        interactionId: "click-2",
        bytes: bytes2,
        mimeType: "image/png",
        width: 800,
        height: 600,
      },
    ],
  });
  const htmlBefore = buildTicketBundle(withShots).html;
  assert.ok(htmlBefore.includes(uint8ArrayToBase64(bytes1)));
  assert.ok(htmlBefore.includes('width="1280" height="720"'));

  const curated = {
    ...withShots,
    ticketCuration: {
      excludedScreenshotInteractionIds: new Set(["click-2"]),
      customStepDescriptions: {},
    },
  };
  const hidden = buildTicketBundle(curated);
  assert.ok(hidden.html.includes(uint8ArrayToBase64(bytes1)));
  assert.ok(!hidden.html.includes(uint8ArrayToBase64(bytes2)));
  assert.ok(hidden.html.includes('data-ticket-block="step"'));
  assert.ok(hidden.markdown.includes('2. 点击 "Submit"'));

  // 选项 A：ZIP 离线包同步剔除被移除的截图
  const reportAssets: StaticReportAssets = {
    html: "<!doctype html><body></body>",
    script: "",
    styles: "",
    icon: new Uint8Array([1]),
  };
  const files = new Map(
    buildEvidencePackage(curated, reportAssets).map((f) => [f.name, f.data])
  );
  assert.ok(files.has("screenshots/step-1.jpg"));
  assert.equal(files.has("screenshots/step-2.png"), false);

  const sessionJs = new TextDecoder().decode(
    files.get("data/session-data.js")!
  );
  const data = JSON.parse(
    sessionJs.replace(/^window\.__BUG_LENS_DATA__ = /, "").slice(0, -1)
  );
  assert.equal(data.summary.interactions.screenshots, 1);
  assert.equal(data.screenshotSummaries[0].path, "screenshots/step-1.jpg");
  assert.equal(data.screenshotSummaries[1].path, null);
  assert.equal(data.interactions[1].screenshot.status, "disabled");
});

test("buildTicketHtml: 空步骤保持无 li 扁平契约，异常与文本正确转义", async () => {
  await setUserLanguagePreference("zh-CN");
  const html = buildTicketHtml(
    snapshot({
      consoleEntries: [
        {
          id: "c1",
          sessionId: "s",
          createdAt: 1,
          level: "error",
          text: "TypeError at <anonymous> <script>alert(1)</script>",
        } as ConsoleEntry,
      ],
      networkEntries: [
        {
          id: "n1",
          sessionId: "s",
          createdAt: 1,
          url: "https://example.com/?a=1&b=<tag>",
          method: "GET",
          status: 500,
        } as NetworkEntry,
      ],
    })
  );
  assert.ok(html.includes('data-ticket-empty="steps"'));
  assert.ok(!html.includes("<li"));
  assert.ok(
    html.includes("&lt;anonymous&gt; &lt;script&gt;alert(1)&lt;/script&gt;")
  );
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.ok(html.includes("a=1&amp;b=&lt;tag&gt;"));
});

test("异常条目带 id 锚点，删除后超出 5 条的报错自动递补", async () => {
  await setUserLanguagePreference("zh-CN");
  const errors = Array.from({ length: 6 }, (_, i) => ({
    id: `c${i}`,
    sessionId: "s",
    createdAt: i,
    level: "error",
    text: `err-${i}`,
  })) as ConsoleEntry[];
  const failed = [
    {
      id: "n1",
      sessionId: "s",
      createdAt: 1,
      url: "https://x/api",
      method: "GET",
      status: 504,
    },
  ] as NetworkEntry[];

  const controller = new PreviewController();
  const render = () =>
    buildTicketHtml(
      snapshot({
        consoleEntries: controller.includedConsoleEntries(errors),
        networkEntries: controller.includedNetworkEntries(failed),
      })
    );
  let html = render();
  assert.ok(html.includes('data-ticket-block="console" data-entry-id="c0"'));
  assert.ok(!html.includes("err-5"));
  controller.exclude("console", "c0");
  html = render();
  assert.ok(!html.includes("err-0"));
  assert.ok(html.includes("err-5"));
  assert.ok(html.includes('data-ticket-block="network" data-entry-id="n1"'));
  controller.exclude("network", "n1");
  assert.ok(!render().includes('data-ticket-block="network"'));
});

test("PreviewController: 单步撤回/重做/重置，issueScene 隔离且无默认预期删空不留脏状态", () => {
  const c = new PreviewController();
  // issueScene 删除不污染工单撤回栈
  c.exclude("issueScene", "scene-1");
  assert.equal(c.canUndo, false);
  assert.equal(c.hasAnyCuration(), false);

  c.excludeMany("interaction", ["a", "b"]);
  c.excludeScreenshot("c");
  c.setStepDescription("c", "  改写\n文案 ");
  c.setTicketNarrative({ actual: "A", expected: "" });
  assert.equal(c.hasAnyCuration(), true);
  assert.deepEqual(c.ticketCuration().customStepDescriptions, {
    c: "改写 文案",
  });

  assert.equal(c.undo(), true);
  assert.equal(c.ticketCuration().customTicketNarrative, undefined);
  assert.equal(c.undo(), true);
  assert.deepEqual(c.ticketCuration().customStepDescriptions, {});
  assert.equal(c.undo(), true);
  assert.equal(c.ticketCuration().excludedScreenshotInteractionIds.size, 0);
  assert.equal(c.excludedCount("interaction"), 2);
  assert.equal(c.redo(), true);
  assert.equal(c.ticketCuration().excludedScreenshotInteractionIds.size, 1);

  c.resetTicketCuration();
  assert.equal(c.hasAnyCuration(), false);
  assert.equal(c.excludedCount("interaction"), 0);
  // issueScene 不受工单重置影响
  assert.equal(c.excludedCount("issueScene"), 1);
  assert.equal(c.undo(), true);
  assert.equal(c.excludedCount("interaction"), 2);
  assert.equal(c.excludedCount("issueScene"), 1);

  // defaults 比对：无默认 expected 时删空不留脏状态；改回默认 actual 自动清除
  const d = new PreviewController();
  d.setTicketNarrative({ expected: "期望1" }, { expected: "" });
  assert.equal(d.hasAnyCuration(), true);
  d.setTicketNarrative({ expected: "" }, { expected: "" });
  assert.equal(d.ticketCuration().customTicketNarrative, undefined);
  assert.equal(d.hasAnyCuration(), false);

  d.setTicketNarrative({ actual: "新现象" }, { actual: "原现象" });
  assert.equal(d.hasAnyCuration(), true);
  d.setTicketNarrative({ actual: "原现象" }, { actual: "原现象" });
  assert.equal(d.ticketCuration().customTicketNarrative, undefined);

  // 有默认 expected 被清空时保留 "" 以隐藏，再还原 undefined 可恢复
  d.setTicketNarrative({ expected: "" }, { expected: "原预期" });
  assert.equal(d.ticketCuration().customTicketNarrative?.expected, "");
  d.setTicketNarrative({ expected: undefined });
  assert.equal(d.ticketCuration().customTicketNarrative, undefined);

  // 无变化的操作不产生撤回点
  const fresh = new PreviewController();
  fresh.setStepDescription("x", undefined);
  fresh.excludeMany("interaction", []);
  assert.equal(fresh.canUndo, false);
});

test("PreviewController: 选择集持久化往返并在加载时清空历史", () => {
  const c = new PreviewController();
  c.excludeMany("interaction", ["a"]);
  c.excludeScreenshot("s1");
  c.setStepDescription("s1", "文案");
  c.setTicketNarrative({ actual: "实际" });
  const saved = c.toSelection("sess");
  assert.deepEqual(saved.excludedScreenshotInteractionIds, ["s1"]);
  assert.deepEqual(saved.customStepDescriptions, { s1: "文案" });
  assert.deepEqual(saved.customTicketNarrative, { actual: "实际" });

  const loaded = new PreviewController();
  loaded.loadSelection(saved);
  assert.equal(loaded.canUndo, false);
  assert.equal(loaded.excludedCount("interaction"), 1);
  assert.deepEqual(loaded.ticketCuration().customStepDescriptions, {
    s1: "文案",
  });

  const plain = new PreviewController().toSelection("sess");
  assert.equal("customStepDescriptions" in plain, false);
  assert.equal("customTicketNarrative" in plain, false);
});

test("buildTicketHtml: 有原预期被清空时输出可单独还原标记", async () => {
  await setUserLanguagePreference("zh-CN");
  const html = buildTicketHtml(
    snapshot({
      issueScenes: [
        {
          id: "scene-1",
          sessionId: "s",
          status: "committed",
          observedAtEpochMs: 1,
          page: {
            url: "https://example.com",
            title: "Home",
            frameId: 0,
            viewport: { width: 100, height: 100 },
            scrollX: 0,
            scrollY: 0,
            devicePixelRatio: 1,
          },
          target: {} as any,
          annotation: {} as any,
          screenshot: { status: "captured" },
          issues: [],
          narrative: {
            actual: "打不开",
            expected: { text: "正常打开", confidence: "explicit" },
          },
        } as IssueScene,
      ],
      ticketCuration: {
        excludedScreenshotInteractionIds: new Set(),
        customStepDescriptions: {},
        customTicketNarrative: { expected: "" },
      },
    })
  );
  assert.ok(!html.includes('data-ticket-slot="narrative-expected"'));
  assert.ok(html.includes('data-expected-cleared="true"'));
  assert.ok(html.includes('data-base-expected="正常打开"'));
});

test("左右一致契约：groupInteractions 与 formatTicketInteractions 步数、ID 集合与标题 100% 一致", () => {
  const zhDict = JSON.parse(
    readFileSync(
      resolve(process.cwd(), "src/_locales/zh_CN/messages.json"),
      "utf8"
    )
  ) as Record<string, { message: string }>;
  const zhTranslate = (key: string, subs?: string | string[]) =>
    t(key, subs, zhDict);

  const records: InteractionRecord[] = [
    interaction("s1", "click", 1000, {
      tagName: "H2",
      text: "应用详情 / 各种测试放这里 (bpm应用) / 单元管理 / 组件开发对照-H5",
    }),
    interaction("s2-click", "click", 2000, { tagName: "INPUT", id: "search" }),
    {
      ...interaction("s2-input", "input", 2500, {
        tagName: "INPUT",
        id: "search",
        text: "搜索框",
      }),
      metadata: { valueLength: 4 },
    },
    {
      ...interaction("s2-enter", "keydown", 2900, {
        tagName: "INPUT",
        id: "search",
        text: "搜索框",
      }),
      metadata: { key: "Enter" },
    },
    interaction("s3-a", "click", 7000, { tagName: "BUTTON", text: "刷新" }),
    interaction("s3-b", "click", 7500, { tagName: "BUTTON", text: "刷新" }),
    interaction("s4-icon", "click", 12000, {
      tagName: "I",
      text: "i",
      classNames: ["el-icon-close"],
    }),
  ];

  const cards = groupInteractions(records, zhTranslate);
  const ticketSteps = formatTicketInteractions(records, false);

  assert.equal(ticketSteps.length, cards.length);
  cards.forEach((card, idx) => {
    assert.equal(ticketSteps[idx].stepNum, idx + 1);
    assert.equal(ticketSteps[idx].actionDesc, card.aggregatedMeta.title);
    assert.deepEqual(
      ticketSteps[idx].interactionIds,
      card.children.map((c) => c.id)
    );
  });
});

test("PreviewController: 批量排除合并步骤所有子 ID 后单次 undo 完整恢复，不残留聚焦点击", () => {
  const records: InteractionRecord[] = [
    interaction("focus-1", "click", 1000, { tagName: "INPUT", id: "search" }),
    {
      ...interaction("type-1", "input", 1500, {
        tagName: "INPUT",
        id: "search",
        text: "abc",
      }),
      metadata: { value: "abc", valueLength: 3 },
    },
    interaction("btn-1", "click", 5000, { tagName: "BUTTON", text: "提交" }),
  ];

  const ctrl = new PreviewController();
  const cards = groupInteractions(records, (k) => k);
  assert.equal(cards.length, 2);

  ctrl.excludeMany(
    "interaction",
    cards[0].children.map((c) => c.id)
  );
  assert.deepEqual(
    ctrl.includedInteractions(records).map((r) => r.id),
    ["btn-1"]
  );

  assert.equal(ctrl.undo(), true);
  assert.deepEqual(
    ctrl.includedInteractions(records).map((r) => r.id),
    ["focus-1", "type-1", "btn-1"]
  );
});
