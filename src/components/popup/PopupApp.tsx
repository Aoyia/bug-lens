import { useState, useEffect, useRef, useCallback, useMemo } from "preact/hooks";
import { message, type EvidenceSummary, type RecordingOptions, type RecordingSession, type SessionOverview, type StorageOverview } from "../../shared/protocol";
import { applyI18n, t } from "../../shared/i18n";
import { RecordPanel } from "./RecordPanel";
import { OptionsGrid } from "./OptionsGrid";
import { HistoryList } from "./HistoryList";

export function PopupApp() {
  const [currentView, setCurrentView] = useState<"record" | "history">("record");
  const [activeSession, setActiveSession] = useState<RecordingSession | undefined>(undefined);
  const [activeTab, setActiveTab] = useState<chrome.tabs.Tab | undefined>(undefined);
  const [errorText, setErrorText] = useState<string>("");
  const [timerText, setTimerText] = useState<string>("");
  const [advancedOpen, setAdvancedOpen] = useState<boolean>(false);

  // Options state
  const [captureVideo, setCaptureVideo] = useState<boolean>(true);
  const [captureAudio, setCaptureAudio] = useState<boolean>(false);
  const [captureScreenshots, setCaptureScreenshots] = useState<boolean>(true);
  const [captureConsole, setCaptureConsole] = useState<boolean>(true);
  const [captureNetwork, setCaptureNetwork] = useState<boolean>(true);
  const [captureNetworkBodies, setCaptureNetworkBodies] = useState<boolean>(true);
  const [privacyMode, setPrivacyMode] = useState<"safe" | "raw">("safe");

  // History state
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [sessions, setSessions] = useState<SessionOverview[]>([]);
  const [storage, setStorage] = useState<StorageOverview | undefined>(undefined);

  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    applyI18n();
    refreshRecord();
  }, []);

  const isActive = useCallback((session?: RecordingSession): boolean => {
    return Boolean(session && ["PREPARING", "RECORDING", "DEGRADED", "STOPPING"].includes(session.status));
  }, []);

  const isPreviewReady = useCallback((session?: RecordingSession): boolean => {
    return Boolean(session && ["PREVIEW_READY", "EXPORTED"].includes(session.status));
  }, []);

  const formatBytes = useCallback((bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KiB`;
    return `${(bytes / 1024 / 1024).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1)} MiB`;
  }, []);

  const formatDuration = useCallback((ms: number): string => {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  }, []);

  const activeEvidence = useCallback((session?: RecordingSession): EvidenceSummary[] => {
    if (!session) return [];
    const issue = (source: string) => session.quality.issues.some((entry) => entry.source === source);
    const state = (enabled: boolean, source: string) => (!enabled ? "disabled" : issue(source) ? "partial" : "captured");
    return [
      { kind: "video", state: state(session.options.captureVideo, "media"), count: 0, sizeBytes: 0, detail: "" },
      { kind: "screenshots", state: state(session.options.captureScreenshots, "screenshot"), count: session.quality.primaryScreenshotCount, sizeBytes: 0, detail: "" },
      { kind: "issueScenes", state: session.quality.issues.some((entry) => entry.source === "issue-scene") ? "partial" : "captured", count: session.quality.issueSceneCount ?? 0, sizeBytes: 0, detail: "" },
      { kind: "console", state: state(session.options.captureConsole, "debugger"), count: session.quality.consoleEntryCount, sizeBytes: 0, detail: "" },
      { kind: "network", state: state(session.options.captureNetwork, "debugger"), count: session.quality.networkEntryCount, sizeBytes: 0, detail: "" },
      { kind: "networkBodies", state: !session.options.captureNetworkBodies ? "disabled" : "pending", count: 0, sizeBytes: 0, detail: "" }
    ];
  }, []);

  const evidenceLabel = useCallback((evidence: EvidenceSummary): string => {
    const map: Record<string, string> = {
      video: t("video"),
      audio: t("audio"),
      screenshots: t("clickScreenshots"),
      issueScenes: t("issueScenes"),
      console: t("console"),
      network: t("network"),
      networkBodies: t("responseBodies")
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
      disabled: t("statusDisabled")
    };
    return map[state] ?? state;
  }, []);

  const updateSessionState = (session?: RecordingSession) => {
    setActiveSession(session);
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = undefined;
    }
    const active = isActive(session);
    if (active && session?.timeline.startedAtEpochMs) {
      const updateTimer = () => {
        setTimerText(formatDuration(Date.now() - session.timeline.startedAtEpochMs!));
      };
      updateTimer();
      timerRef.current = window.setInterval(updateTimer, 1000);
    } else {
      setTimerText("");
    }
  };

  const refreshRecord = async () => {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      let targetTab = tabs[0];
      if (targetTab?.url?.startsWith("chrome-extension://")) {
        const allTabs = await chrome.tabs.query({});
        const webTab = allTabs.find((t) => t.url && (t.url.startsWith("http://") || t.url.startsWith("https://")));
        if (webTab) targetTab = webTab;
      }
      setActiveTab(targetTab);
      const response = await chrome.runtime.sendMessage(message("session/status", {}));
      updateSessionState(response?.session);
    } catch (err) {
      setErrorText(String(err));
    }
  };

  const refreshHistory = async () => {
    try {
      const [sessionsResponse, storageResponse] = await Promise.all([
        chrome.runtime.sendMessage(message("session/list", { query: searchQuery })),
        chrome.runtime.sendMessage(message("storage/get", {}))
      ]);
      setSessions((sessionsResponse?.sessions ?? []) as SessionOverview[]);
      if (storageResponse?.storage) {
        setStorage(storageResponse.storage as StorageOverview);
      }
    } catch (err) {
      setErrorText(String(err));
    }
  };

  useEffect(() => {
    if (currentView === "history") {
      refreshHistory();
    }
  }, [currentView, searchQuery]);

  // Modal state for custom in-extension confirmation (replacing browser native window.confirm)
  const [confirmModal, setConfirmModal] = useState<{ message: string; onConfirm: () => void } | null>(null);

  const handleStart = useCallback(async () => {
    if (!activeTab?.id) return;
    if (!captureVideo && captureAudio) {
      setErrorText(t("audioNeedsVideo"));
      return;
    }
    const startRecording = async () => {
      const options: RecordingOptions = {
        captureVideo,
        captureAudio: captureVideo ? captureAudio : false,
        captureScreenshots,
        captureConsole,
        captureNetwork,
        captureNetworkBodies: captureNetwork ? captureNetworkBodies : false,
        privacyMode,
        mediaTimesliceMs: 1000,
        maxSessionBytes: 512 * 1024 * 1024,
        maxResponseBodyBytes: 2 * 1024 * 1024
      };

      setErrorText("");
      try {
        const isLocalhost = activeTab.url?.includes("127.0.0.1") || activeTab.url?.includes("localhost");
        const isHttpOrHttps = (activeTab.url?.startsWith("http://") || activeTab.url?.startsWith("https://")) && !isLocalhost;
        if (isHttpOrHttps) {
          const hasPermission = await chrome.permissions.contains({ origins: ["http://*/*", "https://*/*"] }).catch(() => false);
          if (!hasPermission) {
            await chrome.storage.local.set({ pendingRecordingRequest: { tabId: activeTab.id, options } });
            await chrome.tabs.create({ url: chrome.runtime.getURL("permission.html") });
            window.close();
            return;
          }
        }
        const response = await chrome.runtime.sendMessage(message("session/start", { tabId: activeTab.id, options, commandId: crypto.randomUUID() }));
        if (!response?.ok) throw new Error(response?.error || t("startFailed"));
        updateSessionState(response.session);
      } catch (error) {
        setErrorText(String(error));
        await refreshRecord();
      }
    };

    if (privacyMode === "raw") {
      setConfirmModal({
        message: t("rawModeWarning"),
        onConfirm: () => void startRecording()
      });
    } else {
      void startRecording();
    }
  }, [activeTab, captureVideo, captureAudio, captureScreenshots, captureConsole, captureNetwork, captureNetworkBodies, privacyMode]);

  const handleStop = useCallback(async () => {
    setErrorText("");
    try {
      const response = await chrome.runtime.sendMessage(message("session/stop", { commandId: crypto.randomUUID() }));
      if (!response?.ok) throw new Error(response?.error || t("stopFailed"));
      updateSessionState(response.session);
    } catch (error) {
      setErrorText(String(error));
    }
  }, []);

  const handleOpenPreview = useCallback((sessionId?: string) => {
    const id = sessionId || activeSession?.id;
    if (id) {
      void chrome.runtime.sendMessage(message("session/open-preview", { sessionId: id }));
    }
  }, [activeSession]);

  const handleDeleteSession = useCallback(async (sessionId: string) => {
    const response = await chrome.runtime.sendMessage(message("session/delete", { sessionId }));
    if (!response?.ok) setErrorText(response?.error || t("deleteFailed"));
    else await refreshHistory();
  }, [searchQuery]);

  const handleResumeSession = useCallback(async (sessionId: string) => {
    const response = await chrome.runtime.sendMessage(message("session/resume", { sessionId, commandId: crypto.randomUUID() }));
    if (!response?.ok) setErrorText(response?.error || t("resumeFailed"));
    else {
      setCurrentView("record");
      updateSessionState(response.session);
    }
  }, []);

  const handleClearHistory = useCallback(() => {
    setConfirmModal({
      message: t("clearHistoryPrompt"),
      onConfirm: async () => {
        const response = await chrome.runtime.sendMessage(message("storage/clear-all", {}));
        if (!response?.ok) setErrorText(response?.error || t("clearHistoryFailed"));
        else await refreshHistory();
      }
    });
  }, [searchQuery]);

  const active = isActive(activeSession);
  const ready = isPreviewReady(activeSession);
  const controlsLocked = active || ready;

  const getStatusText = useCallback(() => {
    if (active) {
      if (activeSession?.status === "PREPARING") return t("recordingStarting");
      if (activeSession?.status === "DEGRADED") return t("recordingDegraded");
      return t("recording");
    }
    if (ready) return t("recordingCompleted");
    return t("notRecording");
  }, [active, ready, activeSession?.status]);

  return (
    <main className="shell">
      {/* 动态主 Header (录制模式) */}
      <header id="main-header" className="brand" style={{ display: currentView === "record" ? "flex" : "none" }}>
        <div className="brand-left">
          <img src="icons/icon_idle.png" alt="Bug Lens" />
          <h1>Bug Lens</h1>
        </div>
        <div className="header-actions">
          <button className="icon-action-btn tab" onClick={() => setCurrentView("history")} title={t("history")}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
          </button>
        </div>
      </header>

      {/* 动态主 Header (历史记录模式) */}
      <header id="history-header" className="history-header-bar" style={{ display: currentView === "history" ? "flex" : "none" }}>
        <button className="back-btn tab" onClick={() => setCurrentView("record")} title={t("backToRecord")}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"></line>
            <polyline points="12 19 5 12 12 5"></polyline>
          </svg>
          <span>{t("history")}</span>
        </button>
        <div className="history-actions">
          <button id="refresh-history" className="icon-action-btn" onClick={refreshHistory} title={t("refreshList")}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10"></polyline>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
            </svg>
          </button>
          <button id="cleanup" className="icon-action-btn" onClick={handleClearHistory} title={t("cleanupExpired")}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
      </header>

      {/* 录制视图 */}
      <section id="record-view" style={{ display: currentView === "record" ? "block" : "none" }}>
        <RecordPanel
          activeSession={activeSession}
          activeTab={activeTab}
          active={active}
          ready={ready}
          timerText={timerText}
          getStatusText={getStatusText}
          activeEvidence={activeEvidence}
          evidenceLabel={evidenceLabel}
          evidenceStateLabel={evidenceStateLabel}
          onStart={handleStart}
          onStop={handleStop}
          onOpenPreview={() => handleOpenPreview()}
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
          privacyMode={privacyMode}
          onToggleAdvanced={() => setAdvancedOpen(!advancedOpen)}
          onSetCaptureVideo={setCaptureVideo}
          onSetCaptureAudio={setCaptureAudio}
          onSetCaptureScreenshots={setCaptureScreenshots}
          onSetCaptureConsole={setCaptureConsole}
          onSetCaptureNetwork={setCaptureNetwork}
          onSetCaptureNetworkBodies={setCaptureNetworkBodies}
          onSetPrivacyMode={setPrivacyMode}
        />
      </section>

      {/* 历史记录视图 */}
      <section id="history-view" style={{ display: currentView === "history" ? "block" : "none" }}>
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

      {errorText && <div id="error" className="error">{errorText}</div>}

      {/* 自定义内联 Confirm 模态框 */}
      {confirmModal && (
        <div className="confirm-overlay">
          <div className="confirm-dialog">
            <div className="confirm-message">{confirmModal.message}</div>
            <div className="confirm-actions">
              <button className="btn-confirm-cancel" onClick={() => setConfirmModal(null)}>取消</button>
              <button className="btn-confirm-danger" onClick={() => { confirmModal.onConfirm(); setConfirmModal(null); }}>确定</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
