import {
  type RecordingSession,
  type TargetTabInfo,
  message,
} from "../shared/protocol.ts";
import type { ContentScriptManager } from "./content-script-manager.ts";
import type { CdpEvidenceCollector } from "../evidence/cdp-evidence-collector.ts";
import { recordMicroOp } from "../diagnostics/diagnostics-store.ts";

export type MultiTabRepository = {
  getActiveSession(): Promise<RecordingSession | undefined>;
  updateSession(
    sessionId: string,
    updater: (session: RecordingSession) => RecordingSession
  ): Promise<RecordingSession | undefined>;
};

export class MultiTabManager {
  private readonly targets = new Map<number, TargetTabInfo>();
  private readonly pendingAddTabs = new Map<number, Promise<TargetTabInfo[]>>();
  private activeSessionId: string | undefined;
  private attached = false;

  private readonly onCreatedTargetListener: (
    details: chrome.webNavigation.WebNavigationSourceCallbackDetails
  ) => void;
  private readonly onCommittedListener: (
    details: chrome.webNavigation.WebNavigationTransitionCallbackDetails
  ) => void;
  private readonly onActivatedListener: (
    activeInfo: chrome.tabs.OnActivatedInfo
  ) => void;
  private readonly onUpdatedListener: (
    tabId: number,
    changeInfo: chrome.tabs.OnUpdatedInfo,
    tab: chrome.tabs.Tab
  ) => void;

  constructor(
    private readonly repository: MultiTabRepository,
    private readonly contentScripts: ContentScriptManager,
    private readonly cdpCollector: CdpEvidenceCollector,
    private readonly onAllTabsClosed?: () => Promise<void>
  ) {
    this.onCreatedTargetListener =
      this.handleCreatedNavigationTarget.bind(this);
    this.onCommittedListener = this.handleNavigationCommitted.bind(this);
    this.onActivatedListener = this.handleTabActivated.bind(this);
    this.onUpdatedListener = this.handleTabUpdated.bind(this);
  }

  /** 初始化会话纳管的初始标签页（及已持久化的副标签页列表） */
  initSession(session: RecordingSession): void {
    this.targets.clear();
    this.pendingAddTabs.clear();
    this.activeSessionId = session.id;
    const initialTarget: TargetTabInfo = {
      tabId: session.target.tabId,
      windowId: session.target.windowId,
      url: session.target.initialUrl,
      title: session.target.initialTitle,
      isPrimary: true,
      addedAtEpochMs: Date.now(),
    };
    this.targets.set(session.target.tabId, initialTarget);
    if (Array.isArray(session.targets)) {
      for (const target of session.targets) {
        if (
          typeof target?.tabId === "number" &&
          !this.targets.has(target.tabId)
        ) {
          this.targets.set(target.tabId, target);
        }
      }
    }
    this.attach();
  }

  /** 挂载全局标签页导航与派生监听 */
  attach(): void {
    if (this.attached) return;
    this.attached = true;
    if (
      typeof chrome !== "undefined" &&
      chrome.webNavigation?.onCreatedNavigationTarget
    ) {
      chrome.webNavigation.onCreatedNavigationTarget.addListener(
        this.onCreatedTargetListener
      );
    }
    if (typeof chrome !== "undefined" && chrome.webNavigation?.onCommitted) {
      chrome.webNavigation.onCommitted.addListener(this.onCommittedListener);
    }
    if (typeof chrome !== "undefined" && chrome.tabs?.onActivated) {
      chrome.tabs.onActivated.addListener(this.onActivatedListener);
    }
    if (typeof chrome !== "undefined" && chrome.tabs?.onUpdated) {
      chrome.tabs.onUpdated.addListener(this.onUpdatedListener);
    }
  }

  /** 卸载监听 */
  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    if (
      typeof chrome !== "undefined" &&
      chrome.webNavigation?.onCreatedNavigationTarget
    ) {
      chrome.webNavigation.onCreatedNavigationTarget.removeListener(
        this.onCreatedTargetListener
      );
    }
    if (typeof chrome !== "undefined" && chrome.webNavigation?.onCommitted) {
      chrome.webNavigation.onCommitted.removeListener(this.onCommittedListener);
    }
    if (typeof chrome !== "undefined" && chrome.tabs?.onActivated) {
      chrome.tabs.onActivated.removeListener(this.onActivatedListener);
    }
    if (typeof chrome !== "undefined" && chrome.tabs?.onUpdated) {
      chrome.tabs.onUpdated.removeListener(this.onUpdatedListener);
    }
    this.targets.clear();
    this.pendingAddTabs.clear();
    this.activeSessionId = undefined;
  }

  /** 获取当前所有受纳管的标签页列表 */
  getTargets(): TargetTabInfo[] {
    return Array.from(this.targets.values());
  }

  /** 判定指定 tab 是否受纳管 */
  hasTab(tabId: number): boolean {
    return this.targets.has(tabId);
  }

  /** 手动纳管一个新标签页（例如用户在前台点击“+ 纳入录制”） */
  async addTab(tabId: number): Promise<TargetTabInfo[]> {
    const existingTask = this.pendingAddTabs.get(tabId);
    if (existingTask) return existingTask;
    if (this.targets.has(tabId)) return this.getTargets();

    const task = this.performAddTab(tabId);
    this.pendingAddTabs.set(tabId, task);
    try {
      return await task;
    } finally {
      if (this.pendingAddTabs.get(tabId) === task) {
        this.pendingAddTabs.delete(tabId);
      }
    }
  }

  private async performAddTab(tabId: number): Promise<TargetTabInfo[]> {
    const t0 = performance.now();
    const session = await this.repository.getActiveSession();
    if (!session || !["RECORDING", "DEGRADED"].includes(session.status)) {
      throw new Error("当前无有效录制中的会话");
    }

    if (this.targets.has(tabId)) {
      return this.getTargets();
    }

    let tab: chrome.tabs.Tab | undefined;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch {
      // 兼容非浏览器环境或无权限
    }

    const targetInfo: TargetTabInfo = {
      tabId,
      windowId: tab?.windowId,
      url: tab?.url ?? "",
      title: tab?.title ?? "",
      isPrimary: false,
      addedAtEpochMs: Date.now(),
    };

    this.targets.set(tabId, targetInfo);

    // 注入采集脚本与 CDP 附着
    await this.contentScripts.activate(tabId).catch(() => undefined);
    if (session.options.captureConsole || session.options.captureNetwork) {
      await this.cdpCollector.attach(tabId, session).catch(() => undefined);
    }

    // 更新持久化会话中的 targets
    await this.syncTargetsToSession(session.id);
    this.broadcastStateSync(session);

    recordMicroOp(session.id, {
      category: "multi-tab-event",
      name: "add-tab",
      durationMs: performance.now() - t0,
      status: "ok",
      detail: {
        tabId,
        url: targetInfo.url,
        totalTabs: this.targets.size,
      },
    });

    return this.getTargets();
  }

  /** 从录制中移出指定标签页（不终止整体录制） */
  async removeTab(tabId: number): Promise<TargetTabInfo[]> {
    if (!this.targets.has(tabId)) return this.getTargets();

    const wasPrimary = this.targets.get(tabId)?.isPrimary;
    this.targets.delete(tabId);

    // 卸载该 Tab 的 content script 与 CDP 附着
    await this.contentScripts.remove(tabId).catch(() => undefined);
    await this.cdpCollector.detach(tabId).catch(() => undefined);

    const remaining = this.getTargets();
    if (remaining.length === 0) {
      // 若所有标签页均被移出，触发结束回调
      await this.onAllTabsClosed?.();
      return [];
    }

    // 若移除的是主标签页，将第一个副标签页提升为主标签页
    if (wasPrimary && remaining[0]) {
      remaining[0].isPrimary = true;
      this.targets.set(remaining[0].tabId, remaining[0]);
    }

    const session = await this.repository.getActiveSession();
    if (session) {
      await this.syncTargetsToSession(session.id);
      this.broadcastStateSync(session);
    }

    return this.getTargets();
  }

  /** 处理标签页被关闭事件 */
  async handleTabRemoved(tabId: number): Promise<boolean> {
    if (!this.targets.has(tabId)) return false;
    await this.removeTab(tabId);
    return true;
  }

  /** 向所有受纳管的标签页广播状态同步（保持挂件计时与操作双向同步） */
  broadcastStateSync(session: RecordingSession): void {
    const targets = this.getTargets();
    const durationMs = session.timeline.startedAtEpochMs
      ? Date.now() -
        session.timeline.startedAtEpochMs -
        (session.timeline.pausedDurationMs ?? 0)
      : 0;

    const syncMessage = message(
      "tab/state-sync",
      {
        sessionId: session.id,
        isPaused: Boolean(session.timeline.isPaused),
        durationMs: Math.max(0, durationMs),
        targets,
      },
      session.id,
      "content"
    );

    for (const target of targets) {
      chrome.tabs.sendMessage(target.tabId, syncMessage).catch(() => undefined);
    }
  }

  /** 监听主页派生打开的新标签页 (target="_blank" 或 window.open) */
  private async handleCreatedNavigationTarget(
    details: chrome.webNavigation.WebNavigationSourceCallbackDetails
  ): Promise<void> {
    // 检查源标签页是否属于当前录制纳管范围
    if (!this.targets.has(details.sourceTabId)) return;

    const session = await this.repository.getActiveSession();
    if (!session || !["RECORDING", "DEGRADED"].includes(session.status)) return;
    if (session.options.autoTrackDerivedTabs === false) return;

    const newTarget: TargetTabInfo = {
      tabId: details.tabId,
      url: details.url ?? "",
      title: "",
      isPrimary: false,
      addedAtEpochMs: Date.now(),
    };

    this.targets.set(details.tabId, newTarget);
    await this.syncTargetsToSession(session.id);
  }

  /** 监听纳管标签页的导航提交，自动激活采集器与重连 CDP */
  private async handleNavigationCommitted(
    details: chrome.webNavigation.WebNavigationTransitionCallbackDetails
  ): Promise<void> {
    if (details.frameId !== 0) return;
    const session = await this.repository.getActiveSession();
    if (!session || !["RECORDING", "DEGRADED"].includes(session.status)) return;
    if (session.options.autoTrackDerivedTabs === false) return;

    const url = details.url.toLowerCase();
    const isWebUrl = url.startsWith("http://") || url.startsWith("https://");

    if (this.targets.has(details.tabId)) {
      const existing = this.targets.get(details.tabId)!;
      existing.url = details.url;
      this.targets.set(details.tabId, existing);

      // 重新注入 content script 与 CDP
      await this.contentScripts.restore(details.tabId).catch(() => undefined);
      if (session.options.captureConsole || session.options.captureNetwork) {
        const isOwner = await this.cdpCollector
          .verifyOwnership(details.tabId)
          .catch(() => false);
        if (!isOwner) {
          await this.cdpCollector
            .attach(details.tabId, session)
            .catch(() => undefined);
        }
      }

      this.broadcastStateSync(session);
    } else if (isWebUrl) {
      // 新打开并导航到普通网页的标签页，全自动纳管（支持同窗口及跨窗口/分屏）
      await this.addTab(details.tabId);
    }
  }

  private async syncTargetsToSession(sessionId: string): Promise<void> {
    const list = this.getTargets();
    await this.repository.updateSession(sessionId, (current) => ({
      ...current,
      targets: list,
    }));
  }

  /** 监听用户切换当前活动标签页，全自动纳管前台普通网页并在切出初始页时刷盘固化媒体 */
  private async handleTabActivated(
    activeInfo: chrome.tabs.OnActivatedInfo
  ): Promise<void> {
    const t0 = performance.now();
    const session = await this.repository.getActiveSession();
    if (!session || !["RECORDING", "DEGRADED"].includes(session.status)) return;

    recordMicroOp(session.id, {
      category: "multi-tab-event",
      name: "tab-switch",
      durationMs: performance.now() - t0,
      status: "ok",
      detail: {
        activeTabId: activeInfo.tabId,
        windowId: activeInfo.windowId,
        isTracked: this.targets.has(activeInfo.tabId),
      },
    });

    // 当用户切离初始录制标签页时，第一时间通知 offscreen 强行将第一标签页的视频数据刷盘固化
    if (session.target?.tabId && activeInfo.tabId !== session.target.tabId) {
      if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
        chrome.runtime
          .sendMessage(
            message(
              "offscreen/flush-media",
              { sessionId: session.id },
              session.id,
              "offscreen"
            )
          )
          .catch(() => undefined);
      }
    }

    if (session.options.autoTrackDerivedTabs === false) return;

    if (this.targets.has(activeInfo.tabId)) {
      this.broadcastStateSync(session);
      return;
    }

    try {
      const tab = await chrome.tabs.get(activeInfo.tabId);
      if (!tab?.url) return;
      const url = tab.url.toLowerCase();
      // 仅自动纳管普通网页（http/https），跳过内部特权页
      if (!url.startsWith("http://") && !url.startsWith("https://")) return;

      await this.addTab(activeInfo.tabId);
    } catch {
      // 忽略无法访问的 tab
    }
  }

  /** 监听标签页状态更新（如从 about:blank 变更为有效 http/https 网址，或加载完成） */
  private async handleTabUpdated(
    tabId: number,
    changeInfo: chrome.tabs.OnUpdatedInfo,
    tab: chrome.tabs.Tab
  ): Promise<void> {
    if (this.pendingAddTabs.has(tabId)) return;
    if (this.targets.has(tabId) && changeInfo.status !== "complete") return;

    const targetUrl = (changeInfo.url ?? tab.url ?? "").toLowerCase();
    if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://"))
      return;

    const session = await this.repository.getActiveSession();
    if (!session || !["RECORDING", "DEGRADED"].includes(session.status)) return;
    if (session.options.autoTrackDerivedTabs === false) return;

    if (!this.targets.has(tabId)) {
      await this.addTab(tabId);
    } else if (changeInfo.status === "complete") {
      this.broadcastStateSync(session);
    }
  }
}
