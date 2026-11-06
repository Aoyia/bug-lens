import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTicketTemplate,
  buildTicketHtml,
  buildTicketBundle,
  uint8ArrayToBase64,
  type EvidencePackageSnapshot,
} from "../src/preview/evidence-package.ts";
import { setUserLanguagePreference } from "../src/shared/i18n.ts";
import type { RecordingSession } from "../src/shared/protocol.ts";

function createMockSession(): RecordingSession {
  return {
    id: "session-12345678-abcd",
    schemaVersion: 2,
    extensionVersion: "0.7.37",
    status: "PREVIEW_READY",
    target: {
      tabId: 1,
      initialUrl: "https://example.com/checkout",
      initialTitle: "Checkout Page",
      environment: {
        os: "Mac OS X",
        browser: "Chrome",
        browserVersion: "132.0.0.0",
        viewport: { width: 1440, height: 900 },
        devicePixelRatio: 2,
        language: "zh-CN",
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
      maxResponseBodyBytes: 1024 * 1024,
      maxSessionBytes: 50 * 1024 * 1024,
    },
    timeline: {
      createdAtEpochMs: 1730000000000,
      startedAtEpochMs: 1730000000000,
      stoppedAtEpochMs: 1730000015000,
      durationMs: 15000,
    },
    quality: {
      overall: "complete",
      interactionCount: 0,
      confirmedInteractionCount: 0,
      primaryScreenshotCount: 0,
      fallbackScreenshotCount: 0,
      unavailableScreenshotCount: 0,
      issueSceneCount: 0,
      partialIssueSceneCount: 0,
      consoleEntryCount: 0,
      networkEntryCount: 0,
      issues: [],
    },
    nonce: "mock-nonce",
  };
}

test("buildTicketTemplate: 中文默认模板与占位符生成（无异常时彻底不输出异常区块）", async () => {
  await setUserLanguagePreference("zh-CN");
  const session = createMockSession();
  const snapshot: EvidencePackageSnapshot = {
    session,
    interactions: [],
    consoleEntries: [],
    networkEntries: [],
    excluded: { interaction: 0, console: 0, network: 0 },
    hasMedia: true,
  };

  const result = buildTicketTemplate(snapshot, "web-bug-report-session-.zip");
  assert.ok(result.includes("## 【问题说明】"));
  assert.ok(result.includes("- 实际表现：[请在此补充客户反馈的问题现象]"));
  assert.ok(!result.includes("预期表现"));
  assert.ok(result.includes("## 【复现环境】"));
  assert.ok(result.includes("Checkout Page (https://example.com/checkout)"));
  assert.ok(result.includes("（录制时长 15s）"));
  assert.ok(result.includes("## 【关键操作步骤】"));
  assert.ok(result.includes("- 未记录点击交互"));
  // 无异常时不输出【自动捕获异常】这一区块
  assert.ok(!result.includes("## 【自动捕获异常】"));
  assert.ok(!result.includes("未捕获接口失败或控制台报错"));
  assert.ok(result.includes("## 【证据包附件】"));
  assert.ok(result.includes("- 附件文件名：`web-bug-report-session-.zip`"));
  assert.ok(
    result.includes("请使用 bug-lens-triage 技能或按包内 AI_PROMPT.md 分析")
  );
});

test("buildTicketTemplate: 包含标记问题、操作步骤、失败接口与报错", async () => {
  await setUserLanguagePreference("zh-CN");
  const session = createMockSession();
  const snapshot: EvidencePackageSnapshot = {
    session,
    issueScenes: [
      {
        id: "scene-1",
        sessionId: session.id,
        capturedAtEpochMs: 1730000010000,
        observedTimestampMs: 1730000010000,
        page: {
          url: "https://example.com/checkout",
          title: "Checkout Page",
          frameId: 0,
        },
        target: {
          capturedAtEpochMs: 1730000010000,
          ancestors: [],
          computedStyle: {},
        } as any,
        narrative: {
          actual: "点击支付按钮无反应，提示网络错误",
          expected: {
            text: "应该正常跳转到支付完成页",
            confidence: "explicit",
          },
        },
        annotation: {} as any,
        issues: [],
      },
    ],
    interactions: [
      {
        id: "int-1",
        sessionId: session.id,
        kind: "click",
        status: "confirmed",
        createdAt: 1730000002000,
        page: {
          url: "https://example.com/checkout",
          title: "Checkout",
          frameId: 0,
        },
        input: { pointerType: "mouse", button: 0, isTrusted: true },
        coordinates: {} as any,
        element: {
          tagName: "BUTTON",
          text: "确认支付",
          accessibleName: "确认支付",
        },
      },
    ],
    networkEntries: [
      {
        id: "req-1",
        sessionId: session.id,
        createdAt: 1730000003000,
        url: "https://api.example.com/pay",
        method: "POST",
        status: 500,
        statusText: "Internal Server Error",
        durationMs: 320,
      },
    ],
    consoleEntries: [
      {
        id: "err-1",
        sessionId: session.id,
        timestampEpochMs: 1730000004000,
        level: "error",
        text: "Uncaught TypeError: Cannot read properties of null",
      },
    ],
    excluded: { interaction: 0, console: 0, network: 0 },
    hasMedia: true,
  };

  const result = buildTicketTemplate(snapshot);
  assert.ok(result.includes("- 实际表现：点击支付按钮无反应，提示网络错误"));
  assert.ok(result.includes("- 预期表现：应该正常跳转到支付完成页"));
  assert.ok(result.includes('1. 点击 button "确认支付"'));
  assert.ok(result.includes("## 【自动捕获异常】"));
  assert.ok(result.includes("- 失败接口（1 个）："));
  assert.ok(
    result.includes(
      "POST https://api.example.com/pay -> 500 Internal Server Error (320ms)"
    )
  );
  assert.ok(result.includes("- 控制台报错（1 条）："));
  assert.ok(
    result.includes("Uncaught TypeError: Cannot read properties of null")
  );
});

test("buildTicketTemplate: 交互全量保留不截断，且被删除步骤不包含", async () => {
  await setUserLanguagePreference("zh-CN");
  const session = createMockSession();
  // 模拟全量 12 步交互，且 int-3 已被排除（未放入 snapshot.interactions）
  const interactions = Array.from({ length: 12 }, (_, i) => ({
    id: `int-${i}`,
    sessionId: session.id,
    kind: "click" as const,
    status: "confirmed" as const,
    createdAt: 1730000000000 + (i + 1) * 1000,
    page: { url: "https://example.com", title: "Home", frameId: 0 },
    input: { pointerType: "mouse", button: 0, isTrusted: true },
    coordinates: {} as any,
    element: {
      tagName: "A",
      text: `Link ${i + 1}`,
      accessibleName: `Link ${i + 1}`,
    },
  })).filter((item) => item.id !== "int-2"); // 模拟用户删除了第 3 步 (int-2)

  const snapshot: EvidencePackageSnapshot = {
    session,
    interactions,
    consoleEntries: [],
    networkEntries: [],
    excluded: { interaction: 1, console: 0, network: 0 },
    hasMedia: true,
  };

  const result = buildTicketTemplate(snapshot);
  // 全量输出，不出现前略与时间戳
  assert.ok(!result.includes("前略"));
  assert.ok(!result.includes("[00:"));
  assert.ok(result.includes('1. 点击 a "Link 1"'));
  assert.ok(result.includes('2. 点击 a "Link 2"'));
  // 确认已删除的 Link 3 不在步骤中
  assert.ok(!result.includes('点击 a "Link 3"'));
  // 后续步骤紧跟并重新连续编号
  assert.ok(result.includes('3. 点击 a "Link 4"'));
  assert.ok(result.includes('11. 点击 a "Link 12"'));
});

test("buildTicketHtml & buildTicketBundle: 包含内嵌 Base64 步骤截图富文本 HTML", async () => {
  await setUserLanguagePreference("zh-CN");
  const session = createMockSession();
  const mockImageBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  const base64Expected = uint8ArrayToBase64(mockImageBytes);

  const snapshot: EvidencePackageSnapshot = {
    session,
    interactions: [
      {
        id: "int-click-btn",
        sessionId: session.id,
        kind: "click",
        status: "confirmed",
        createdAt: 1730000003000,
        page: { url: "https://example.com", title: "Home", frameId: 0 },
        input: { pointerType: "mouse", button: 0, isTrusted: true },
        coordinates: {} as any,
        element: {
          tagName: "BUTTON",
          text: "Create New",
          accessibleName: "Create New",
        },
      },
    ],
    interactionAssets: [
      {
        interactionId: "int-click-btn",
        bytes: mockImageBytes,
        mimeType: "image/jpeg",
      },
    ],
    consoleEntries: [],
    networkEntries: [],
    excluded: { interaction: 0, console: 0, network: 0 },
    hasMedia: true,
  };

  const bundle = buildTicketBundle(snapshot, "web-bug-report-abc.zip");
  assert.ok(bundle.markdown.includes('1. 点击 button "Create New"'));
  assert.ok(!bundle.markdown.includes("[00:"));
  assert.ok(!bundle.markdown.includes("【自动捕获异常】"));

  // 富文本 HTML 校验（飞书与 TAPD 兼容的扁平段落排版，无 ul/ol/li 换行错乱）
  assert.ok(bundle.html.includes("【问题说明】"));
  assert.ok(bundle.html.includes("【关键操作步骤】"));
  assert.ok(!bundle.html.includes("<ul"));
  assert.ok(!bundle.html.includes("<ol"));
  assert.ok(!bundle.html.includes("<li"));
  assert.ok(
    bundle.html.includes(`src="data:image/jpeg;base64,${base64Expected}"`)
  );
  assert.ok(bundle.html.includes('alt="Step 1 screenshot"'));
  assert.ok(bundle.html.includes('data-interaction-id="int-click-btn"'));
  assert.ok(bundle.html.includes("cursor: zoom-in"));
  assert.ok(bundle.html.includes('title="点击放大查看大图"'));
  assert.ok(bundle.html.includes("[步骤 1 截图]"));
  assert.ok(!bundle.html.includes("【自动捕获异常】"));
});

test("buildTicketTemplate: 英文模式格式校验", async () => {
  await setUserLanguagePreference("en-US");
  const session = createMockSession();
  const snapshot: EvidencePackageSnapshot = {
    session,
    interactions: [],
    consoleEntries: [],
    networkEntries: [],
    excluded: { interaction: 0, console: 0, network: 0 },
    hasMedia: true,
  };

  const result = buildTicketTemplate(snapshot);
  assert.ok(result.includes("## [Problem Description]"));
  assert.ok(result.includes("## [Environment]"));
  assert.ok(result.includes("## [Key Steps]"));
  // 无异常时不输出
  assert.ok(!result.includes("## [Captured Anomalies]"));
  assert.ok(result.includes("## [Evidence Package]"));
  assert.ok(result.includes("Please analyze"));
  // 恢复中文
  await setUserLanguagePreference("zh-CN");
});

test("buildTicketTemplate: 方案一（DOM 语义提升、动作合并、去除机械底层标签与字体图标清洗）", async () => {
  await setUserLanguagePreference("zh-CN");
  const session = createMockSession();

  // 模拟真实工单上报数据（包含 span、i "i"、input 聚焦+输入、div "《"）
  const interactions = [
    {
      id: "int-1",
      sessionId: session.id,
      kind: "click" as const,
      status: "confirmed" as const,
      createdAt: 1000,
      page: { url: "https://example.com", title: "Test", frameId: 0 },
      coordinates: {} as any,
      element: { tagName: "SPAN", text: "单人验收" },
    },
    {
      id: "int-2",
      sessionId: session.id,
      kind: "click" as const,
      status: "confirmed" as const,
      createdAt: 2000,
      page: { url: "https://example.com", title: "Test", frameId: 0 },
      coordinates: {} as any,
      element: { tagName: "I", text: "i", classNames: ["el-icon-info"] },
    },
    {
      id: "int-3",
      sessionId: session.id,
      kind: "click" as const,
      status: "confirmed" as const,
      createdAt: 3000,
      page: { url: "https://example.com", title: "Test", frameId: 0 },
      coordinates: {} as any,
      element: { tagName: "SPAN", text: "单人验收" },
    },
    {
      id: "int-4",
      sessionId: session.id,
      kind: "click" as const,
      status: "confirmed" as const,
      createdAt: 4000,
      page: { url: "https://example.com", title: "Test", frameId: 0 },
      coordinates: {} as any,
      element: { tagName: "SPAN", text: "不通过" },
    },
    // 对 input 的聚焦点击 + 随后的输入操作
    {
      id: "int-5",
      sessionId: session.id,
      kind: "click" as const,
      status: "confirmed" as const,
      createdAt: 5000,
      page: { url: "https://example.com", title: "Test", frameId: 0 },
      coordinates: {} as any,
      element: { tagName: "INPUT", id: "input-reason", text: "2" },
    },
    {
      id: "int-6",
      sessionId: session.id,
      kind: "input" as const,
      status: "confirmed" as const,
      createdAt: 5500,
      page: { url: "https://example.com", title: "Test", frameId: 0 },
      coordinates: {} as any,
      element: { tagName: "INPUT", id: "input-reason", text: "2" },
    },
    {
      id: "int-7",
      sessionId: session.id,
      kind: "click" as const,
      status: "confirmed" as const,
      createdAt: 6000,
      page: { url: "https://example.com", title: "Test", frameId: 0 },
      coordinates: {} as any,
      element: { tagName: "BUTTON", text: "确认离开" },
    },
    {
      id: "int-8",
      sessionId: session.id,
      kind: "click" as const,
      status: "confirmed" as const,
      createdAt: 7000,
      page: { url: "https://example.com", title: "Test", frameId: 0 },
      coordinates: {} as any,
      element: { tagName: "LI", text: "节点移交" },
    },
    {
      id: "int-9",
      sessionId: session.id,
      kind: "click" as const,
      status: "confirmed" as const,
      createdAt: 8000,
      page: { url: "https://example.com", title: "Test", frameId: 0 },
      coordinates: {} as any,
      element: { tagName: "INPUT", text: "input" },
    },
    {
      id: "int-10",
      sessionId: session.id,
      kind: "click" as const,
      status: "confirmed" as const,
      createdAt: 9000,
      page: { url: "https://example.com", title: "Test", frameId: 0 },
      coordinates: {} as any,
      element: { tagName: "LI", text: "kentest41" },
    },
    {
      id: "int-11",
      sessionId: session.id,
      kind: "click" as const,
      status: "confirmed" as const,
      createdAt: 10000,
      page: { url: "https://example.com", title: "Test", frameId: 0 },
      coordinates: {} as any,
      element: { tagName: "DIV", text: "《" },
    },
  ];

  const snapshot: EvidencePackageSnapshot = {
    session,
    interactions: interactions as any,
    consoleEntries: [],
    networkEntries: [],
    excluded: { interaction: 0, console: 0, network: 0 },
    hasMedia: true,
  };

  const result = buildTicketTemplate(snapshot);

  // 1. span 包装标签不再原样暴露
  assert.ok(result.includes('1. 点击 "单人验收"'));
  assert.ok(!result.includes('点击 span "单人验收"'));

  // 2. 字体图标 "i" 被清洗，转化为图标语义描述
  assert.ok(!result.includes('点击 i "i"'));
  assert.ok(result.includes("2. 点击 详情/提示图标"));

  // 3. span "不通过" 转为自然可读点击
  assert.ok(result.includes('3. 点击 "单人验收"'));
  assert.ok(result.includes('4. 点击 "不通过"'));
  assert.ok(!result.includes('点击 span "不通过"'));

  // 4. 对同一 input 的聚焦 click 与 input 操作被合并，只保留输入
  assert.ok(!result.includes('点击 input "2"'));
  assert.ok(result.includes('5. 输入 input "2"'));

  // 5. 按钮与列表项正常保留
  assert.ok(result.includes('6. 点击 button "确认离开"'));
  assert.ok(result.includes('7. 点击 li "节点移交"'));

  // 6. 重复的 input 标签名被清洗
  assert.ok(result.includes("8. 点击 input"));
  assert.ok(!result.includes('点击 input "input"'));

  assert.ok(result.includes('9. 点击 li "kentest41"'));

  // 7. 特殊符号 "《" 识别为折叠/返回
  assert.ok(result.includes('10. 点击 折叠/返回 "《"'));
  assert.ok(!result.includes('点击 div "《"'));
});
