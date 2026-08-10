import { useState, useEffect, useCallback, useMemo } from "preact/hooks";
import {
  type EvidenceSummary,
  type RecordingOptions,
  type RecordingSession,
  type SessionOverview,
  type StorageOverview,
} from "../../shared/protocol.ts";
import { applyI18n, t } from "../../shared/i18n.ts";
import {
  DEFAULT_RECORDING_OPTIONS,
  VIDEO_BITRATE_BY_COMPRESSION,
} from "../../domain/storage-policy.ts";
import { useRpc } from "../../hooks/useRpc.ts";
import { copyTextToClipboard } from "../../preview/clipboard";
import { useSessionState } from "../../hooks/useSessionState.ts";
import { RecordPanel } from "./RecordPanel.tsx";
import { OptionsGrid, type VideoQuality } from "./OptionsGrid.tsx";
import { HistoryList } from "./HistoryList.tsx";

const HISTORY_SEARCH_DEBOUNCE_MS = 300;

export function PopupApp() {
  const { send } = useRpc();
  const {
    activeSession,
    timerText,
    active,
    previewReady,
    controlsLocked,
    updateSessionState,
  } = useSessionState();

  const [currentView, setCurrentView] = useState<"record" | "history">(
    "record"
  );
  const [activeTab, setActiveTab] = useState<chrome.tabs.Tab | undefined>(
    undefined
  );
  const [errorText, setErrorText] = useState<string>("");
  const [advancedOpen, setAdvancedOpen] = useState<boolean>(false);

  // Options state
  const [captureVideo, setCaptureVideo] = useState<boolean>(true);
  const [captureAudio, setCaptureAudio] = useState<boolean>(false);
  const [captureScreenshots, setCaptureScreenshots] = useState<boolean>(true);
  const [captureConsole, setCaptureConsole] = useState<boolean>(true);
  const [captureNetwork, setCaptureNetwork] = useState<boolean>(true);
  const [captureNetworkBodies, setCaptureNetworkBodies] =
    useState<boolean>(true);
  const [captureFrameworkState, setCaptureFrameworkState] =
    useState<boolean>(true);
  const [videoQuality, setVideoQuality] = useState<VideoQuality>("balanced");
  const [privacyMode, setPrivacyMode] = useState<"safe" | "raw">("safe");

  // History state
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState<string>("");
  const [sessions, setSessions] = useState<SessionOverview[]>([]);
  const [storage, setStorage] = useState<StorageOverview | undefined>(
    undefined
  );

  useEffect(() => {
    applyI18n();
    refreshRecord();
    void (async () => {
      try {
        // 首次引导已迁移至 GitHub Pages 网页（安装后自动打开），扩展内不再内嵌引导
        const stored = (await chrome.storage.local.get([
          "last-recording-options",
        ])) as {
          "last-recording-options"?: Partial<RecordingOptions>;
        };
        // 回填上次录制选项，保证 Popup 与全局快捷键使用一致的配置
        const last = stored?.["last-recording-options"];
        if (last) {
          if (typeof last.captureVideo === "boolean")
            setCaptureVideo(last.captureVideo);
          if (typeof last.captureAudio === "boolean")
            setCaptureAudio(last.captureAudio);
          if (typeof last.captureScreenshots === "boolean")
            setCaptureScreenshots(last.captureScreenshots);
          if (typeof last.captureConsole === "boolean")
            setCaptureConsole(last.captureConsole);
          if (typeof last.captureNetwork === "boolean")
            setCaptureNetwork(last.captureNetwork);
          if (typeof last.captureNetworkBodies === "boolean")
            setCaptureNetworkBodies(last.captureNetworkBodies);
          if (typeof last.captureFrameworkState === "boolean")
            setCaptureFrameworkState(last.captureFrameworkState);
          if (last.privacyMode === "safe" || last.privacyMode === "raw")
            setPrivacyMode(last.privacyMode);
          const bitrate = last.videoBitsPerSecond;
          if (bitrate === VIDEO_BITRATE_BY_COMPRESSION.quality) {
            setVideoQuality("quality");
          } else if (bitrate === VIDEO_BITRATE_BY_COMPRESSION.small) {
            setVideoQuality("small");
          }
        }
      } catch {
        // 存储不可用时静默跳过引导与选项回填
      }
    })();
  }, []);

  // 错误提示自动消失：出现后 6 秒自动清除，避免残留阻塞弹窗空间
  useEffect(() => {
    if (!errorText) return;
    const timer = window.setTimeout(() => setErrorText(""), 6000);
    return () => window.clearTimeout(timer);
  }, [errorText]);

  const formatBytes = useCallback((bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KiB`;
    return `${(bytes / 1024 / 1024).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1)} MiB`;
  }, []);

  const activeEvidence = useCallback(
    (session?: RecordingSession): EvidenceSummary[] => {
      if (!session) return [];
      const issue = (source: string) =>
        session.quality.issues.some((entry) => entry.source === source);
      const state = (enabled: boolean, source: string) =>
        !enabled ? "disabled" : issue(source) ? "partial" : "captured";
      return [
        {
          kind: "video",
          state: state(session.options.captureVideo, "media"),
          count: 0,
          sizeBytes: 0,
          detail: "",
        },
        {
          kind: "screenshots",
          state: state(session.options.captureScreenshots, "screenshot"),
          count: session.quality.primaryScreenshotCount,
          sizeBytes: 0,
          detail: "",
        },
        {
          kind: "issueScenes",
          state: session.quality.issues.some(
            (entry) => entry.source === "issue-scene"
          )
            ? "partial"
            : "captured",
          count: session.quality.issueSceneCount ?? 0,
          sizeBytes: 0,
          detail: "",
        },
        {
          kind: "console",
          state: state(session.options.captureConsole, "debugger"),
          count: session.quality.consoleEntryCount,
          sizeBytes: 0,
          detail: "",
        },
        {
          kind: "network",
          state: state(session.options.captureNetwork, "debugger"),
          count: session.quality.networkEntryCount,
          sizeBytes: 0,
          detail: "",
        },
        {
          kind: "networkBodies",
          state: !session.options.captureNetworkBodies ? "disabled" : "pending",
          count: 0,
          sizeBytes: 0,
          detail: "",
        },
        {
          kind: "frameworkStates",
          state: !session.options.captureFrameworkState
            ? "disabled"
            : "captured",
          count: 0,
          sizeBytes: 0,
          detail: "",
        },
      ];
    },
    []
  );

  const evidenceLabel = useCallback((evidence: EvidenceSummary): string => {
    const map: Record<string, string> = {
      video: t("video"),
      audio: t("audio"),
      screenshots: t("clickScreenshots"),
      issueScenes: t("issueScenes"),
      console: t("console"),
      network: t("network"),
      networkBodies: t("responseBodies"),
      frameworkStates: t("frameworkStates"),
    };
    return map[evidence.kind] ?? evidence.kind;
  }, []);

  const evidenceStateLabel = useCallback((state: string): string => {
    const map: Record<string, string> = {
      captured: t("statusCaptured"),
      partial: t("statusPartial"),
      failed: t("statusFailed"),
      redacted: t("statusRedacted"),
      pending: t("statusPending"),
      disabled: t("statusDisabled"),
    };
    return map[state] ?? state;
  }, []);

  const refreshRecord = async () => {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const forcedTabId = urlParams.get("tabId");
      let targetTab: chrome.tabs.Tab | undefined;
      if (forcedTabId) {
        targetTab = await chrome.tabs
          .get(Number(forcedTabId))
          .catch(() => undefined);
      }
      if (!targetTab) {
        const tabs = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        targetTab = tabs[0];
      }
      if (targetTab?.url?.startsWith("chrome-extension://")) {
        const allTabs = await chrome.tabs.query({});
        const webTab = allTabs.find(
          (t) =>
            t.url &&
            (t.url.startsWith("http://") || t.url.startsWith("https://"))
        );
        if (webTab) targetTab = webTab;
      }
      setActiveTab(targetTab);
      const result = await send("session/status", {});
      if (result.ok) updateSessionState(result.data?.session);
    } catch (err) {
      setErrorText(String(err));
    }
  };

  const refreshHistory = async (query = searchQuery) => {
    try {
      const [sessionsResult, storageResult] = await Promise.all([
        send("session/list", { query }),
        send("storage/get", {}),
      ]);
      if (sessionsResult.ok)
        setSessions((sessionsResult.data?.sessions ?? []) as SessionOverview[]);
      if (storageResult.ok && storageResult.data?.storage) {
        setStorage(storageResult.data.storage as StorageOverview);
      }
    } catch (err) {
      setErrorText(String(err));
    }
  };

  // 历史搜索只在用户暂停输入后查询，首次打开历史页仍立即加载。
  useEffect(() => {
    const timer = window.setTimeout(
      () => setDebouncedSearchQuery(searchQuery),
      HISTORY_SEARCH_DEBOUNCE_MS
    );
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    if (currentView === "history") {
      void refreshHistory(debouncedSearchQuery);
    }
  }, [currentView, debouncedSearchQuery]);

  // Modal state for custom in-extension confirmation (replacing browser native window.confirm)
  const [confirmModal, setConfirmModal] = useState<{
    message: string;
    onConfirm: () => void;
  } | null>(null);

  const handleStart = useCallback(async () => {
    if (!activeTab?.id) return;
    if (!captureVideo && captureAudio) {
      setErrorText(t("audioNeedsVideo"));
      return;
    }
    const options: RecordingOptions = {
      captureVideo,
      captureAudio: captureVideo ? captureAudio : false,
      captureScreenshots,
      captureConsole,
      captureNetwork,
      captureNetworkBodies: captureNetwork ? captureNetworkBodies : false,
      captureFrameworkState,
      privacyMode,
      mediaTimesliceMs: DEFAULT_RECORDING_OPTIONS.mediaTimesliceMs,
      videoBitsPerSecond: VIDEO_BITRATE_BY_COMPRESSION[videoQuality],
      maxSessionBytes: DEFAULT_RECORDING_OPTIONS.maxSessionBytes,
      maxResponseBodyBytes: DEFAULT_RECORDING_OPTIONS.maxResponseBodyBytes,
    };

    // 持久化最近一次选项，供全局快捷键一键录制复用
    void chrome.storage.local
      .set({ "last-recording-options": options })
      .catch(() => undefined);

    setErrorText("");
    try {
      // 非 localhost 的 http/https 页面需要全站访问权限才能注入采集脚本；
      // 未授权时引导用户到权限授权中转页主动授权（走用户授权流程）。
      const isLocalhost =
        activeTab.url?.includes("127.0.0.1") ||
        activeTab.url?.includes("localhost");
      const isHttpOrHttps =
        (activeTab.url?.startsWith("http://") ||
          activeTab.url?.startsWith("https://")) &&
        !isLocalhost;
      if (isHttpOrHttps) {
        const hasPermission = await chrome.permissions
          .contains({ origins: ["http://*/*", "https://*/*"] })
          .catch(() => false);
        if (!hasPermission) {
          await chrome.storage.local.set({
            pendingRecordingRequest: { tabId: activeTab.id, options },
          });
          await chrome.tabs.create({
            url: chrome.runtime.getURL("permission.html"),
          });
          window.close();
          return;
        }
      }
      const result = await send("session/start", {
        tabId: activeTab.id!,
        options,
        commandId: crypto.randomUUID(),
      });
      if (!result.ok) throw new Error(result.error || t("startFailed"));
      updateSessionState(result.data?.session);
    } catch (error) {
      setErrorText(String(error));
      await refreshRecord();
    }
  }, [
    activeTab,
    captureVideo,
    captureAudio,
    captureScreenshots,
    captureConsole,
    captureNetwork,
    captureNetworkBodies,
    captureFrameworkState,
    videoQuality,
    privacyMode,
  ]);

  const handleStop = useCallback(async () => {
    setErrorText("");
    try {
      const result = await send("session/stop", {
        commandId: crypto.randomUUID(),
        silentExport: true,
      });
      if (!result.ok) throw new Error(result.error || t("stopFailed"));
      const prompt = result.data?.session?.silentPrompt;
      if (prompt) {
        try {
          await copyTextToClipboard(prompt);
        } catch {
          // ignore
        }
      }
      updateSessionState(result.data?.session);
    } catch (error) {
      setErrorText(String(error));
    }
  }, []);

  const handleOpenPreview = useCallback(
    (sessionId?: string) => {
      const id = sessionId || activeSession?.id;
      if (id) {
        void send("session/open-preview", { sessionId: id });
      }
    },
    [activeSession]
  );

  const handleStartNew = useCallback(() => {
    // 重置客户端会话状态回到闲置态：已完成的会话仍保留在历史中，
    // 用户可重新调整选项并点击「开始录制」开启下一次录制。
    updateSessionState(undefined);
  }, [updateSessionState]);

  const handleDeleteSession = useCallback(
    async (sessionId: string) => {
      const result = await send("session/delete", { sessionId });
      if (!result.ok) setErrorText(result.error || t("deleteFailed"));
      else await refreshHistory();
    },
    [searchQuery]
  );

  const handleResumeSession = useCallback(async (sessionId: string) => {
    const result = await send("session/resume", {
      sessionId,
      commandId: crypto.randomUUID(),
    });
    if (!result.ok) setErrorText(result.error || t("resumeFailed"));
    else {
      setCurrentView("record");
      updateSessionState(result.data?.session);
    }
  }, []);

  const handleClearHistory = useCallback(() => {
    setConfirmModal({
      message: t("clearHistoryPrompt"),
      onConfirm: async () => {
        const result = await send("storage/clear-all", {});
        if (!result.ok) setErrorText(result.error || t("clearHistoryFailed"));
        else await refreshHistory();
      },
    });
  }, [searchQuery]);

  const getStatusText = useCallback(() => {
    if (active) {
      if (activeSession?.status === "PREPARING") return t("recordingStarting");
      if (activeSession?.status === "DEGRADED") return t("recordingDegraded");
      return t("recording");
    }
    if (previewReady) return t("recordingCompleted");
    return t("notRecording");
  }, [active, previewReady, activeSession?.status]);

  return (
    <main className="shell">
      {/* 动态主 Header (录制模式) */}
      <header
        id="main-header"
        className="brand"
        style={{ display: currentView === "record" ? "flex" : "none" }}
      >
        <div className="brand-left">
          <img src="icons/icon_idle.png" alt="Bug Lens" />
          <h1>Bug Lens</h1>
        </div>
        <div className="header-actions">
          <button
            className="icon-action-btn tab"
            onClick={() => setCurrentView("history")}
            title={t("history")}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
          </button>
        </div>
      </header>

      {/* 动态主 Header (历史记录模式) */}
      <header
        id="history-header"
        className="history-header-bar"
        style={{ display: currentView === "history" ? "flex" : "none" }}
      >
        <button
          className="back-btn tab"
          onClick={() => setCurrentView("record")}
          title={t("backToRecord")}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="19" y1="12" x2="5" y2="12"></line>
            <polyline points="12 19 5 12 12 5"></polyline>
          </svg>
          <span>{t("history")}</span>
        </button>
        <div className="history-actions">
          <button
            id="refresh-history"
            className="icon-action-btn"
            onClick={() => void refreshHistory()}
            title={t("refreshList")}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="23 4 23 10 17 10"></polyline>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
            </svg>
          </button>
          <button
            id="cleanup"
            className="icon-action-btn"
            onClick={handleClearHistory}
            title={t("cleanupExpired")}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
      </header>

      {/* 录制视图 */}
      <section
        id="record-view"
        style={{ display: currentView === "record" ? "block" : "none" }}
      >
        <RecordPanel
          activeSession={activeSession}
          activeTab={activeTab}
          active={active}
          ready={previewReady}
          timerText={timerText}
          getStatusText={getStatusText}
          activeEvidence={activeEvidence}
          evidenceLabel={evidenceLabel}
          evidenceStateLabel={evidenceStateLabel}
          onStart={handleStart}
          onStop={handleStop}
          onOpenPreview={() => handleOpenPreview()}
          onStartNew={handleStartNew}
          onError={setErrorText}
        />

        <OptionsGrid
          controlsLocked={controlsLocked}
          advancedOpen={advancedOpen}
          captureVideo={captureVideo}
          captureAudio={captureAudio}
          captureScreenshots={captureScreenshots}
          captureConsole={captureConsole}
          captureNetwork={captureNetwork}
          captureNetworkBodies={captureNetworkBodies}
          captureFrameworkState={captureFrameworkState}
          videoQuality={videoQuality}
          privacyMode={privacyMode}
          onToggleAdvanced={() => setAdvancedOpen(!advancedOpen)}
          onSetCaptureVideo={setCaptureVideo}
          onSetCaptureAudio={setCaptureAudio}
          onSetCaptureScreenshots={setCaptureScreenshots}
          onSetCaptureConsole={setCaptureConsole}
          onSetCaptureNetwork={setCaptureNetwork}
          onSetCaptureNetworkBodies={setCaptureNetworkBodies}
          onSetCaptureFrameworkState={setCaptureFrameworkState}
          onSetVideoQuality={setVideoQuality}
          onSetPrivacyMode={setPrivacyMode}
        />
      </section>

      {/* 历史记录视图 */}
      <section
        id="history-view"
        style={{ display: currentView === "history" ? "block" : "none" }}
      >
        <HistoryList
          searchQuery={searchQuery}
          sessions={sessions}
          storage={storage}
          formatBytes={formatBytes}
          evidenceLabel={evidenceLabel}
          evidenceStateLabel={evidenceStateLabel}
          onSearchChange={setSearchQuery}
          onOpenPreview={(id) => handleOpenPreview(id)}
          onDeleteSession={handleDeleteSession}
          onResumeSession={handleResumeSession}
        />
      </section>

      {errorText && (
        <div id="error" className="error" role="alert">
          <span className="error-text">{errorText}</span>
          <button
            id="error-close"
            className="error-close"
            aria-label={t("dismissError")}
            title={t("dismissError")}
            onClick={() => setErrorText("")}
          >
            ×
          </button>
        </div>
      )}

      {/* 自定义内联 Confirm 模态框 */}
      {confirmModal && (
        <div className="confirm-overlay">
          <div className="confirm-dialog">
            <div className="confirm-message">{confirmModal.message}</div>
            <div className="confirm-actions">
              <button
                className="btn-confirm-cancel"
                onClick={() => setConfirmModal(null)}
              >
                取消
              </button>
              <button
                className="btn-confirm-danger"
                onClick={() => {
                  confirmModal.onConfirm();
                  setConfirmModal(null);
                }}
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
