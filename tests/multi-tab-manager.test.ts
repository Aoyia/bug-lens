import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { MultiTabManager } from "../src/recording/multi-tab-manager.ts";
import type { RecordingSession } from "../src/shared/protocol.ts";

let onCreatedNavigationTargetListener: any;
let onCommittedListener: any;
const sentTabMessages: Array<{ tabId: number; message: any }> = [];

beforeEach(() => {
  sentTabMessages.length = 0;
  (globalThis as any).chrome = {
    tabs: {
      get: async (tabId: number) => ({
        id: tabId,
        windowId: 1,
        url: `https://example.com/tab-${tabId}`,
        title: `Tab Title ${tabId}`,
      }),
      sendMessage: async (tabId: number, message: any) => {
        sentTabMessages.push({ tabId, message });
      },
    },
    webNavigation: {
      onCreatedNavigationTarget: {
        addListener(fn: any) {
          onCreatedNavigationTargetListener = fn;
        },
        removeListener(fn: any) {
          if (onCreatedNavigationTargetListener === fn)
            onCreatedNavigationTargetListener = undefined;
        },
      },
      onCommitted: {
        addListener(fn: any) {
          onCommittedListener = fn;
        },
        removeListener(fn: any) {
          if (onCommittedListener === fn) onCommittedListener = undefined;
        },
      },
    },
  };
});

function createMockSession(
  overrides?: Partial<RecordingSession>
): RecordingSession {
  return {
    id: "test-session-123",
    schemaVersion: 2,
    extensionVersion: "0.7.37",
    status: "RECORDING",
    target: {
      tabId: 101,
      windowId: 1,
      initialUrl: "https://admin.example.com",
      initialTitle: "Admin Panel",
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
      maxResponseBodyBytes: 10000,
      maxSessionBytes: 50000000,
      autoTrackDerivedTabs: true,
    },
    timeline: {
      createdAtEpochMs: Date.now() - 10000,
      startedAtEpochMs: Date.now() - 10000,
    },
    quality: {
      overall: "complete",
      interactionCount: 0,
      confirmedInteractionCount: 0,
      primaryScreenshotCount: 0,
      fallbackScreenshotCount: 0,
      unavailableScreenshotCount: 0,
      issueSceneCount: 0,
      consoleEntryCount: 0,
      networkEntryCount: 0,
      issues: [],
    },
    nonce: "nonce-123",
    ...overrides,
  };
}

test("MultiTabManager - 初始化主标签页纳管", () => {
  let session = createMockSession();
  const repo = {
    getActiveSession: async () => session,
    updateSession: async (
      _id: string,
      updater: (s: RecordingSession) => RecordingSession
    ) => {
      session = updater(session);
      return session;
    },
  };

  const contentScripts = {
    activate: async () => {},
    restore: async () => {},
    remove: async () => {},
  } as any;

  const cdpCollector = {
    attach: async () => undefined,
    detach: async () => {},
    verifyOwnership: async () => true,
  } as any;

  const manager = new MultiTabManager(repo, contentScripts, cdpCollector);
  manager.initSession(session);

  assert.equal(manager.hasTab(101), true);
  assert.equal(manager.hasTab(999), false);

  const targets = manager.getTargets();
  assert.equal(targets.length, 1);
  assert.equal(targets[0].tabId, 101);
  assert.equal(targets[0].isPrimary, true);
  assert.equal(targets[0].url, "https://admin.example.com");
});

test("MultiTabManager - 手动添加前台标签页纳管与 CDP/Content 注入", async () => {
  let session = createMockSession();
  const repo = {
    getActiveSession: async () => session,
    updateSession: async (
      _id: string,
      updater: (s: RecordingSession) => RecordingSession
    ) => {
      session = updater(session);
      return session;
    },
  };

  const activatedTabs: number[] = [];
  const contentScripts = {
    activate: async (tabId: number) => {
      activatedTabs.push(tabId);
    },
    restore: async () => {},
    remove: async () => {},
  } as any;

  const attachedTabs: number[] = [];
  const cdpCollector = {
    attach: async (tabId: number) => {
      attachedTabs.push(tabId);
      return undefined;
    },
    detach: async () => {},
    verifyOwnership: async () => true,
  } as any;

  const manager = new MultiTabManager(repo, contentScripts, cdpCollector);
  manager.initSession(session);

  const newTargets = await manager.addTab(202);
  assert.equal(newTargets.length, 2);
  assert.equal(manager.hasTab(202), true);
  assert.deepEqual(activatedTabs, [202]);
  assert.deepEqual(attachedTabs, [202]);

  const added = newTargets.find((t) => t.tabId === 202);
  assert.equal(added?.isPrimary, false);
});

test("MultiTabManager - 移出单个副标签页不影响主录制", async () => {
  let session = createMockSession();
  const repo = {
    getActiveSession: async () => session,
    updateSession: async (
      _id: string,
      updater: (s: RecordingSession) => RecordingSession
    ) => {
      session = updater(session);
      return session;
    },
  };

  const removedTabs: number[] = [];
  const contentScripts = {
    activate: async () => {},
    restore: async () => {},
    remove: async (tabId: number) => {
      removedTabs.push(tabId);
    },
  } as any;

  const detachedTabs: number[] = [];
  const cdpCollector = {
    attach: async () => undefined,
    detach: async (tabId: number) => {
      detachedTabs.push(tabId);
    },
    verifyOwnership: async () => true,
  } as any;

  let allClosed = false;
  const manager = new MultiTabManager(
    repo,
    contentScripts,
    cdpCollector,
    async () => {
      allClosed = true;
    }
  );

  manager.initSession(session);
  await manager.addTab(202);
  assert.equal(manager.getTargets().length, 2);

  // 移出副 Tab 202
  const remaining = await manager.removeTab(202);
  assert.equal(remaining.length, 1);
  assert.equal(manager.hasTab(202), false);
  assert.equal(manager.hasTab(101), true);
  assert.deepEqual(removedTabs, [202]);
  assert.deepEqual(detachedTabs, [202]);
  assert.equal(allClosed, false);
});

test("MultiTabManager - 主标签页关闭时自动晋升副标签页，全部关闭触发停止", async () => {
  let session = createMockSession();
  const repo = {
    getActiveSession: async () => session,
    updateSession: async (
      _id: string,
      updater: (s: RecordingSession) => RecordingSession
    ) => {
      session = updater(session);
      return session;
    },
  };

  const contentScripts = {
    activate: async () => {},
    restore: async () => {},
    remove: async () => {},
  } as any;

  const cdpCollector = {
    attach: async () => undefined,
    detach: async () => {},
    verifyOwnership: async () => true,
  } as any;

  let allClosedCalled = false;
  const manager = new MultiTabManager(
    repo,
    contentScripts,
    cdpCollector,
    async () => {
      allClosedCalled = true;
    }
  );

  manager.initSession(session);
  await manager.addTab(202);

  // 关闭主 Tab 101
  const afterPrimaryClosed = await manager.removeTab(101);
  assert.equal(afterPrimaryClosed.length, 1);
  assert.equal(afterPrimaryClosed[0].tabId, 202);
  assert.equal(afterPrimaryClosed[0].isPrimary, true);
  assert.equal(allClosedCalled, false);

  // 关闭最后一个 Tab 202
  const afterAllClosed = await manager.removeTab(202);
  assert.equal(afterAllClosed.length, 0);
  assert.equal(allClosedCalled, true);
});

test("MultiTabManager - 智能派生标签页自动纳管与导航恢复", async () => {
  let session = createMockSession();
  const repo = {
    getActiveSession: async () => session,
    updateSession: async (
      _id: string,
      updater: (s: RecordingSession) => RecordingSession
    ) => {
      session = updater(session);
      return session;
    },
  };

  const restoredTabs: number[] = [];
  const contentScripts = {
    activate: async () => {},
    restore: async (tabId: number) => {
      restoredTabs.push(tabId);
    },
    remove: async () => {},
  } as any;

  const cdpCollector = {
    attach: async () => undefined,
    detach: async () => {},
    verifyOwnership: async () => false,
  } as any;

  const manager = new MultiTabManager(repo, contentScripts, cdpCollector);
  manager.initSession(session);

  // 模拟从 Tab 101 打开了新 Tab 303 (target="_blank")
  await (manager as any).handleCreatedNavigationTarget({
    sourceTabId: 101,
    tabId: 303,
    url: "https://shop.example.com",
  });

  assert.equal(manager.hasTab(303), true);

  // 模拟 Tab 303 页面导航提交 (onCommitted)
  await (manager as any).handleNavigationCommitted({
    tabId: 303,
    url: "https://shop.example.com/checkout",
    frameId: 0,
  });

  assert.deepEqual(restoredTabs, [303]);
  const targets = manager.getTargets();
  const target303 = targets.find((t) => t.tabId === 303);
  assert.equal(target303?.url, "https://shop.example.com/checkout");
  assert.equal(sentTabMessages.length > 0, true);
});

test("MultiTabManager - 切换活动标签页时全自动纳管前台普通网页并广播状态", async () => {
  let session = createMockSession();
  const repo = {
    getActiveSession: async () => session,
    updateSession: async (
      _id: string,
      updater: (s: RecordingSession) => RecordingSession
    ) => {
      session = updater(session);
      return session;
    },
  };

  const activatedTabs: number[] = [];
  const contentScripts = {
    activate: async (tabId: number) => {
      activatedTabs.push(tabId);
    },
    restore: async () => {},
    remove: async () => {},
  } as any;

  const attachedTabs: number[] = [];
  const cdpCollector = {
    attach: async (tabId: number) => {
      attachedTabs.push(tabId);
      return undefined;
    },
    detach: async () => {},
    verifyOwnership: async () => true,
  } as any;

  const manager = new MultiTabManager(repo, contentScripts, cdpCollector);
  manager.initSession(session);

  // 模拟用户在同一窗口内切换到了 Tab 404（前台页面）
  await (manager as any).handleTabActivated({
    tabId: 404,
    windowId: 1,
  });

  assert.equal(manager.hasTab(404), true);
  assert.deepEqual(activatedTabs, [404]);
  assert.deepEqual(attachedTabs, [404]);
  assert.equal(sentTabMessages.length > 0, true);
  const syncMsg = sentTabMessages.find((m) => m.tabId === 404);
  assert.equal(syncMsg?.message?.type, "tab/state-sync");
});

test("MultiTabManager - 并发重复 addTab 自动合并去重，且已纳管标签页非 complete 的 onUpdated 不查询 DB", async () => {
  let session = createMockSession();
  let getActiveSessionCalls = 0;
  const repo = {
    getActiveSession: async () => {
      getActiveSessionCalls += 1;
      await new Promise((r) => setTimeout(r, 10));
      return session;
    },
    updateSession: async (
      _id: string,
      updater: (s: RecordingSession) => RecordingSession
    ) => {
      session = updater(session);
      return session;
    },
  };

  const activatedTabs: number[] = [];
  const contentScripts = {
    activate: async (tabId: number) => {
      activatedTabs.push(tabId);
    },
    restore: async () => {},
    remove: async () => {},
  } as any;

  const attachedTabs: number[] = [];
  const cdpCollector = {
    attach: async (tabId: number) => {
      attachedTabs.push(tabId);
      return undefined;
    },
    detach: async () => {},
    verifyOwnership: async () => true,
  } as any;

  const manager = new MultiTabManager(repo, contentScripts, cdpCollector);
  manager.initSession(session);

  // 并发调用 3 次 addTab(505)
  await Promise.all([
    manager.addTab(505),
    manager.addTab(505),
    manager.addTab(505),
  ]);

  assert.deepEqual(activatedTabs, [505]);
  assert.deepEqual(attachedTabs, [505]);

  // 已纳管的标签页触发 loading / title 更新时不应查询 getActiveSession
  const beforeCalls = getActiveSessionCalls;
  await (manager as any).handleTabUpdated(
    505,
    { status: "loading" },
    { id: 505, url: "https://example.com/tab-505" }
  );
  assert.equal(getActiveSessionCalls, beforeCalls);
});
