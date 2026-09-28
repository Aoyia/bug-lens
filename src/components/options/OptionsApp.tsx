import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from "preact/hooks";
import {
  type AppSettings,
  DEFAULT_APP_SETTINGS,
  loadAppSettings,
  saveAppSettings,
} from "../../shared/settings";
import {
  applyI18n,
  getLocale,
  initI18nPreference,
  setUserLanguagePreference,
  t,
  isEn,
  type LanguagePreference,
} from "../../shared/i18n";
import { useRpc } from "../../hooks/useRpc";
import {
  buildAiPrompt,
  type EvidencePackageSnapshot,
} from "../../preview/evidence-package";

type NavTab =
  "workflow" | "ai" | "recording" | "privacy" | "storage" | "shortcuts";

const SAMPLE_SNAPSHOT: EvidencePackageSnapshot = {
  interactions: [
    {
      id: "int-1",
      sessionId: "mock-session-001",
      kind: "click",
      status: "confirmed",
      createdAt: Date.now() - 6000,
      page: {
        url: "https://app.example.com/checkout",
        title: "Checkout Page",
        frameId: 0,
      },
      input: { pointerType: "mouse", button: 0, isTrusted: true },
      coordinates: {
        clientX: 320,
        clientY: 480,
        pageX: 320,
        pageY: 480,
        scrollX: 0,
        scrollY: 0,
        devicePixelRatio: 2,
        viewport: { width: 1440, height: 900 },
      },
      element: {
        tagName: "button",
        classNames: ["btn-submit-order", "primary"],
        attributes: { id: "checkout-submit-btn" },
        text: "Confirm & Pay ($99.00)",
        accessibleName: "Confirm & Pay",
        locators: [
          {
            kind: "id",
            expression: "#checkout-submit-btn",
            confidence: 1,
            reasons: ["Unique ID"],
          },
        ],
      },
      screenshot: {
        status: "captured",
        bounds: { x: 300, y: 460, width: 160, height: 44 },
      },
    } as any,
  ],
  consoleEntries: [
    {
      timestampEpochMs: Date.now() - 3500,
      level: "error",
      text: "Uncaught TypeError: Cannot read properties of undefined (reading 'token')",
      url: "https://app.example.com/static/js/checkout-bundle.js",
      category: "javascript",
    } as any,
  ],
  networkEntries: [
    {
      id: "req-1",
      url: "https://api.example.com/v1/orders/pay",
      method: "POST",
      status: 500,
      statusText: "Internal Server Error",
      requestHeaders: { Authorization: "Bearer [REDACTED]" },
      responseHeaders: { "content-type": "application/json" },
      durationMs: 320,
    } as any,
  ],
  issueScenes: [
    {
      id: "scene-1",
      sessionId: "mock-session-001",
      capturedAtEpochMs: Date.now() - 2000,
      observedTimestampMs: Date.now() - 2000,
      page: {
        url: "https://app.example.com/checkout",
        title: "Checkout Page",
        frameId: 0,
      },
      target: {
        capturedAtEpochMs: Date.now() - 2000,
        element: {
          tagName: "button",
          classNames: ["btn-submit-order"],
          attributes: { id: "checkout-submit-btn" },
          text: "Confirm & Pay",
          locators: [
            {
              kind: "id",
              expression: "#checkout-submit-btn",
              confidence: 1,
              reasons: [],
            },
          ],
        },
        ancestors: [],
        computedStyle: {},
      },
      narrative: {
        actual:
          "点击支付按钮后页面无跳转，控制台抛出 TypeError 且支付接口返回 500",
        expected: {
          text: "应当正确校验支付网关状态并跳转至已完成页面",
          confidence: "explicit",
        },
      },
      annotation: {},
      issues: [
        {
          type: "error",
          message: "500 Internal Server Error / Payment Failed",
        },
      ],
    } as any,
  ],
  session: {
    id: "mock-session-001",
    schemaVersion: 2,
    extensionVersion: "0.7.34",
    status: "PREVIEW_READY",
    target: {
      initialUrl: "https://app.example.com/checkout",
      initialTitle: "Checkout App",
      environment: {
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        platform: "MacIntel",
        language: "zh-CN",
        screenWidth: 1920,
        screenHeight: 1080,
        devicePixelRatio: 2,
        viewportWidth: 1440,
        viewportHeight: 900,
      },
    },
    options: {} as any,
    timeline: { createdAtEpochMs: Date.now() - 10000 },
    quality: { overall: "healthy", issues: [] },
  } as any,
  excluded: {
    interaction: 0,
    console: 0,
    network: 0,
    issueScene: 0,
  },
  hasMedia: false,
};

interface CustomSelectOption<T extends string | number> {
  value: T;
  label: string;
}

function CustomSelect<T extends string | number>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: CustomSelectOption<T>[];
  onChange: (val: T) => void;
  ariaLabel?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const selectedOption = options.find((o) => o.value === value) || options[0];

  return (
    <div ref={wrapRef} className={`custom-select-wrap ${isOpen ? "open" : ""}`}>
      <button
        type="button"
        className="custom-select-trigger"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-label={ariaLabel}
      >
        <span>{selectedOption?.label}</span>
        <svg
          className="custom-select-chevron"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {isOpen && (
        <div className="custom-select-dropdown" role="listbox">
          {options.map((opt) => {
            const isSelected = opt.value === value;
            return (
              <div
                key={String(opt.value)}
                role="option"
                aria-selected={isSelected}
                className={`custom-select-option ${isSelected ? "selected" : ""}`}
                onClick={() => {
                  onChange(opt.value);
                  setIsOpen(false);
                }}
              >
                <span>{opt.label}</span>
                {isSelected && (
                  <svg
                    className="custom-select-check"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SegmentedControl<T extends string | number>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (val: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div className="segmented-control" role="radiogroup" aria-label={ariaLabel}>
      {options.map((opt) => {
        const isActive = opt.value === value;
        return (
          <button
            key={String(opt.value)}
            type="button"
            role="radio"
            aria-checked={isActive}
            className={`segmented-btn ${isActive ? "active" : ""}`}
            data-text={opt.label}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export function OptionsApp() {
  const { send } = useRpc();
  const [activeTab, setActiveTab] = useState<NavTab>("workflow");
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string>("");
  const [showPromptPreview, setShowPromptPreview] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [clearStatus, setClearStatus] = useState<string>("");

  const [customKeysText, setCustomKeysText] = useState("");
  const [excludeUrlsText, setExcludeUrlsText] = useState("");
  const [customInstructionsText, setCustomInstructionsText] = useState("");

  const saveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    void (async () => {
      await initI18nPreference();
      applyI18n();
      document.documentElement.lang = getLocale();

      const loadedSettings = await loadAppSettings();
      setSettings(loadedSettings);
      setCustomKeysText(loadedSettings.privacy.customSensitiveKeys.join(", "));
      setExcludeUrlsText(loadedSettings.privacy.excludeUrlPatterns.join("\n"));
      setCustomInstructionsText(loadedSettings.ai.customInstructions);
      setLoaded(true);
    })();
  }, []);

  const triggerAutoSave = useCallback(async (next: AppSettings) => {
    setSettings(next);
    await saveAppSettings(next);

    if (next.workflow.language !== getLocale()) {
      await setUserLanguagePreference(next.workflow.language);
      applyI18n();
      document.documentElement.lang = getLocale();
    }

    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    setSaveStatus(t("savedSuccess"));
    saveTimerRef.current = window.setTimeout(() => {
      setSaveStatus("");
    }, 1500);
  }, []);

  const commitTextSettings = useCallback(() => {
    const sensitiveKeys = customKeysText
      .split(/[,，\n]/)
      .map((s) => s.trim())
      .filter(Boolean);

    const excludeUrls = excludeUrlsText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

    const next: AppSettings = {
      ...settings,
      ai: {
        ...settings.ai,
        customInstructions: customInstructionsText,
      },
      privacy: {
        ...settings.privacy,
        customSensitiveKeys: sensitiveKeys,
        excludeUrlPatterns: excludeUrls,
      },
    };

    void triggerAutoSave(next);
  }, [
    settings,
    customInstructionsText,
    customKeysText,
    excludeUrlsText,
    triggerAutoSave,
  ]);

  const handleReset = useCallback(async () => {
    if (!window.confirm("确定将所有设置恢复为默认值吗？")) return;
    setSettings(DEFAULT_APP_SETTINGS);
    setCustomKeysText(
      DEFAULT_APP_SETTINGS.privacy.customSensitiveKeys.join(", ")
    );
    setExcludeUrlsText(
      DEFAULT_APP_SETTINGS.privacy.excludeUrlPatterns.join("\n")
    );
    setCustomInstructionsText(DEFAULT_APP_SETTINGS.ai.customInstructions);
    await triggerAutoSave(DEFAULT_APP_SETTINGS);
  }, [triggerAutoSave]);

  const handleClearAllData = useCallback(async () => {
    const confirmed = window.confirm(t("clearHistoryPrompt"));
    if (!confirmed) return;
    try {
      const res = await send("storage/clear-all", {});
      if (!res.ok) {
        setClearStatus(res.error);
      } else {
        setClearStatus(t("clearAllDataSuccess"));
        window.setTimeout(() => setClearStatus(""), 3000);
      }
    } catch (e) {
      setClearStatus(String(e));
    }
  }, [send]);

  const openShortcutsPage = useCallback(() => {
    if (typeof chrome !== "undefined" && chrome.tabs) {
      void chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
    }
  }, []);

  // 动态生成 AI Prompt 模板预览（仅在用户展开折叠时供内联预览查看）
  const liveAiPrompt = useMemo(() => {
    return buildAiPrompt(
      SAMPLE_SNAPSHOT,
      "/Users/developer/Downloads/bug-lens-checkout-error.zip",
      {
        targetAssistant: settings.ai.targetAssistant,
        customInstructions: customInstructionsText,
      }
    );
  }, [settings.ai.targetAssistant, customInstructionsText]);

  if (!loaded) {
    return (
      <div
        style={{ padding: 60, textAlign: "center", color: "var(--ink-muted)" }}
      >
        {t("loading")}
      </div>
    );
  }

  return (
    <div className="options-layout">
      {/* 1. Chrome 风格全宽贯穿顶栏 */}
      <header className="options-topbar">
        <div className="topbar-left">
          <img
            src="icons/icon_idle_32.png"
            alt="Bug Lens"
            className="topbar-logo"
          />
          <h1 className="topbar-title">Bug Lens 设置</h1>
        </div>

        <div className="topbar-center">
          <div className="topbar-search-box">
            <svg
              className="search-icon"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              className="topbar-search-input"
              placeholder="搜索设置项..."
              value={searchQuery}
              onInput={(e) => setSearchQuery(e.currentTarget.value)}
            />
            {searchQuery && (
              <button
                type="button"
                className="search-clear-btn"
                onClick={() => setSearchQuery("")}
              >
                ×
              </button>
            )}
          </div>
        </div>

        <div className="topbar-right">
          {saveStatus ? (
            <span className="save-status-badge">
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span>{saveStatus}</span>
            </span>
          ) : (
            <span className="auto-save-pill">
              <span className="status-dot"></span>
              <span>{t("autoSaveActive")}</span>
            </span>
          )}
          <button className="btn-text-subtle" onClick={handleReset}>
            {t("resetDefaults")}
          </button>
        </div>
      </header>

      {/* 2. 主体滚动区与居中对称工作台 (Chrome 核心黄金区域) */}
      <div className="options-body-scroll">
        <div className="options-center-container">
          {/* 左侧胶囊导航菜单 */}
          <aside className="options-sidebar">
            <nav className="sidebar-nav">
              <button
                className={`nav-item ${activeTab === "workflow" ? "active" : ""}`}
                onClick={() => setActiveTab("workflow")}
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                <span>{t("navWorkflow")}</span>
              </button>

              <button
                className={`nav-item ${activeTab === "ai" ? "active" : ""}`}
                onClick={() => setActiveTab("ai")}
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <rect x="3" y="11" width="18" height="10" rx="2" />
                  <circle cx="12" cy="5" r="2" />
                  <path d="M12 7v4" />
                  <line x1="8" y1="16" x2="8" y2="16" />
                  <line x1="16" y1="16" x2="16" y2="16" />
                </svg>
                <span>{t("navAi")}</span>
              </button>

              <button
                className={`nav-item ${activeTab === "recording" ? "active" : ""}`}
                onClick={() => setActiveTab("recording")}
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <circle cx="12" cy="12" r="6" />
                  <path d="M22 12h-4" />
                  <path d="M6 12H2" />
                </svg>
                <span>{t("navRecording")}</span>
              </button>

              <button
                className={`nav-item ${activeTab === "privacy" ? "active" : ""}`}
                onClick={() => setActiveTab("privacy")}
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
                <span>{t("navPrivacy")}</span>
              </button>

              <button
                className={`nav-item ${activeTab === "storage" ? "active" : ""}`}
                onClick={() => setActiveTab("storage")}
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <ellipse cx="12" cy="5" rx="9" ry="3" />
                  <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
                  <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
                </svg>
                <span>{t("navStorage")}</span>
              </button>

              <button
                className={`nav-item ${activeTab === "shortcuts" ? "active" : ""}`}
                onClick={() => setActiveTab("shortcuts")}
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <rect x="2" y="4" width="20" height="16" rx="2" />
                  <line x1="6" y1="8" x2="6" y2="8" />
                  <line x1="10" y1="8" x2="10" y2="8" />
                  <line x1="14" y1="8" x2="14" y2="8" />
                  <line x1="18" y1="8" x2="18" y2="8" />
                  <line x1="8" y1="16" x2="16" y2="16" />
                </svg>
                <span>{t("navShortcuts")}</span>
              </button>
            </nav>
            <div className="sidebar-footer">Bug Lens v0.7.34</div>
          </aside>

          {/* 右侧主配置卡片区 */}
          <main className="options-main-container">
            <div className="section-header-row">
              <h2 className="section-title">
                {activeTab === "workflow" && t("navWorkflow")}
                {activeTab === "ai" && t("navAi")}
                {activeTab === "recording" && t("navRecording")}
                {activeTab === "privacy" && t("navPrivacy")}
                {activeTab === "storage" && t("navStorage")}
                {activeTab === "shortcuts" && t("navShortcuts")}
              </h2>
              <p className="section-subtitle">
                {activeTab === "workflow" && t("settingStopActionDesc")}
                {activeTab === "ai" && t("settingTargetAssistantDesc")}
                {activeTab === "recording" && t("defaultSafeCollection")}
                {activeTab === "privacy" && t("safeMode")}
                {activeTab === "storage" && t("settingRetentionDesc")}
                {activeTab === "shortcuts" && "Chrome 浏览器全局命令与热键支持"}
              </p>
            </div>

            {/* 1. 工作流与通用 */}
            {activeTab === "workflow" && (
              <div className="settings-card">
                <div className="setting-row">
                  <div className="setting-info">
                    <span className="setting-label">
                      {t("settingLanguage")}
                    </span>
                    <span className="setting-desc">
                      {t("settingLanguageDesc")}
                    </span>
                  </div>
                  <div className="setting-control">
                    <SegmentedControl
                      ariaLabel={t("settingLanguage")}
                      value={settings.workflow.language}
                      options={[
                        { value: "auto", label: t("languageAuto") },
                        { value: "zh-CN", label: t("languageZhCN") },
                        { value: "en-US", label: t("languageEnUS") },
                      ]}
                      onChange={(val) =>
                        triggerAutoSave({
                          ...settings,
                          workflow: {
                            ...settings.workflow,
                            language: val as LanguagePreference,
                          },
                        })
                      }
                    />
                  </div>
                </div>

                <div className="setting-row">
                  <div className="setting-info">
                    <span className="setting-label">
                      {t("settingStopAction")}
                    </span>
                    <span className="setting-desc">
                      {t("settingStopActionDesc")}
                    </span>
                  </div>
                  <div className="setting-control">
                    <SegmentedControl
                      ariaLabel={t("settingStopAction")}
                      value={settings.workflow.stopAction}
                      options={[
                        { value: "preview", label: t("stopActionPreview") },
                        {
                          value: "silentExport",
                          label: t("stopActionSilentExport"),
                        },
                      ]}
                      onChange={(val) =>
                        triggerAutoSave({
                          ...settings,
                          workflow: {
                            ...settings.workflow,
                            stopAction: val as any,
                          },
                        })
                      }
                    />
                  </div>
                </div>

                <div className="setting-row">
                  <div className="setting-info">
                    <span className="setting-label">
                      {t("settingAutoCopyPrompt")}
                    </span>
                    <span className="setting-desc">
                      {t("settingAutoCopyPromptDesc")}
                    </span>
                  </div>
                  <div className="setting-control">
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={settings.workflow.autoCopyPrompt}
                        onChange={(e) =>
                          triggerAutoSave({
                            ...settings,
                            workflow: {
                              ...settings.workflow,
                              autoCopyPrompt: e.currentTarget.checked,
                            },
                          })
                        }
                      />
                      <span className="slider"></span>
                    </label>
                  </div>
                </div>

                <div className="setting-row">
                  <div className="setting-info">
                    <span className="setting-label">
                      {t("settingShowGuide")}
                    </span>
                    <span className="setting-desc">
                      {t("settingShowGuideDesc")}
                    </span>
                  </div>
                  <div className="setting-control">
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={settings.workflow.showWorkflowGuide}
                        onChange={(e) =>
                          triggerAutoSave({
                            ...settings,
                            workflow: {
                              ...settings.workflow,
                              showWorkflowGuide: e.currentTarget.checked,
                            },
                          })
                        }
                      />
                      <span className="slider"></span>
                    </label>
                  </div>
                </div>
              </div>
            )}

            {/* 2. AI 与导出 */}
            {activeTab === "ai" && (
              <div className="settings-card">
                <div className="setting-row">
                  <div className="setting-info">
                    <span className="setting-label">
                      {t("settingTargetAssistant")}
                    </span>
                    <span className="setting-desc">
                      {t("settingTargetAssistantDesc")}
                    </span>
                  </div>
                  <div className="setting-control">
                    <CustomSelect
                      value={settings.ai.targetAssistant}
                      ariaLabel={t("settingTargetAssistant")}
                      options={[
                        { value: "generic", label: t("assistantGeneric") },
                        { value: "cursor", label: t("assistantCursor") },
                        {
                          value: "claude-code",
                          label: t("assistantClaudeCode"),
                        },
                        {
                          value: "antigravity",
                          label: t("assistantAntigravity"),
                        },
                      ]}
                      onChange={(val) =>
                        triggerAutoSave({
                          ...settings,
                          ai: {
                            ...settings.ai,
                            targetAssistant: val as any,
                          },
                        })
                      }
                    />
                  </div>
                </div>

                <div className="setting-row">
                  <div className="setting-info">
                    <span className="setting-label">
                      {t("settingPromptLanguage")}
                    </span>
                    <span className="setting-desc">
                      {t("settingPromptLanguageDesc")}
                    </span>
                  </div>
                  <div className="setting-control">
                    <SegmentedControl
                      ariaLabel={t("settingPromptLanguage")}
                      value={settings.ai.promptLanguage}
                      options={[
                        { value: "auto", label: t("languageAuto") },
                        { value: "zh-CN", label: t("languageZhCN") },
                        { value: "en-US", label: t("languageEnUS") },
                      ]}
                      onChange={(val) =>
                        triggerAutoSave({
                          ...settings,
                          ai: {
                            ...settings.ai,
                            promptLanguage: val as any,
                          },
                        })
                      }
                    />
                  </div>
                </div>

                <div
                  className="setting-row"
                  style={{ flexDirection: "column", alignItems: "stretch" }}
                >
                  <div className="setting-info" style={{ maxWidth: "100%" }}>
                    <span className="setting-label">
                      {t("settingCustomInstructions")}
                    </span>
                    <span className="setting-desc">
                      {t("settingCustomInstructionsDesc")}
                    </span>
                  </div>
                  <textarea
                    className="textarea-input"
                    style={{ marginTop: 10, minHeight: 110 }}
                    placeholder="例如：优先分析 React 组件渲染时序；重点排查 Authorization 与跨域 header..."
                    value={customInstructionsText}
                    onInput={(e) =>
                      setCustomInstructionsText(e.currentTarget.value)
                    }
                    onBlur={commitTextSettings}
                  />

                  {/* 方案 A: 内联折叠预览生成的 AI_PROMPT 模板 */}
                  <div className="inline-prompt-preview-wrap">
                    <button
                      type="button"
                      className="btn-inline-toggle"
                      onClick={() => setShowPromptPreview(!showPromptPreview)}
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        style={{
                          transform: showPromptPreview
                            ? "rotate(90deg)"
                            : "none",
                          transition: "transform 0.15s ease",
                        }}
                      >
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                      <span>
                        {showPromptPreview
                          ? "收起生成的 AI Prompt 效果预览"
                          : "展开预览生成的 AI Prompt 模板 (AI_PROMPT.md)"}
                      </span>
                      <span className="inline-preview-badge">
                        {settings.ai.targetAssistant}
                      </span>
                    </button>

                    {showPromptPreview && (
                      <div className="inline-prompt-preview-box">
                        <pre className="inline-code-content">
                          {liveAiPrompt}
                        </pre>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* 3. 默认录制通道 */}
            {activeTab === "recording" && (
              <div className="settings-card">
                <div className="setting-row">
                  <div className="setting-info">
                    <span className="setting-label">{t("video")}</span>
                  </div>
                  <div className="setting-control">
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={settings.defaultRecording.captureVideo}
                        onChange={(e) =>
                          triggerAutoSave({
                            ...settings,
                            defaultRecording: {
                              ...settings.defaultRecording,
                              captureVideo: e.currentTarget.checked,
                              captureAudio: e.currentTarget.checked
                                ? settings.defaultRecording.captureAudio
                                : false,
                            },
                          })
                        }
                      />
                      <span className="slider"></span>
                    </label>
                  </div>
                </div>

                <div className="setting-row">
                  <div className="setting-info">
                    <span className="setting-label">{t("audio")}</span>
                  </div>
                  <div className="setting-control">
                    <label className="switch">
                      <input
                        type="checkbox"
                        disabled={!settings.defaultRecording.captureVideo}
                        checked={settings.defaultRecording.captureAudio}
                        onChange={(e) =>
                          triggerAutoSave({
                            ...settings,
                            defaultRecording: {
                              ...settings.defaultRecording,
                              captureAudio: e.currentTarget.checked,
                            },
                          })
                        }
                      />
                      <span className="slider"></span>
                    </label>
                  </div>
                </div>

                <div className="setting-row">
                  <div className="setting-info">
                    <span className="setting-label">
                      {t("clickScreenshots")}
                    </span>
                  </div>
                  <div className="setting-control">
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={settings.defaultRecording.captureScreenshots}
                        onChange={(e) =>
                          triggerAutoSave({
                            ...settings,
                            defaultRecording: {
                              ...settings.defaultRecording,
                              captureScreenshots: e.currentTarget.checked,
                            },
                          })
                        }
                      />
                      <span className="slider"></span>
                    </label>
                  </div>
                </div>

                <div className="setting-row">
                  <div className="setting-info">
                    <span className="setting-label">{t("console")}</span>
                  </div>
                  <div className="setting-control">
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={settings.defaultRecording.captureConsole}
                        onChange={(e) =>
                          triggerAutoSave({
                            ...settings,
                            defaultRecording: {
                              ...settings.defaultRecording,
                              captureConsole: e.currentTarget.checked,
                            },
                          })
                        }
                      />
                      <span className="slider"></span>
                    </label>
                  </div>
                </div>

                <div className="setting-row">
                  <div className="setting-info">
                    <span className="setting-label">{t("network")}</span>
                  </div>
                  <div className="setting-control">
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={settings.defaultRecording.captureNetwork}
                        onChange={(e) =>
                          triggerAutoSave({
                            ...settings,
                            defaultRecording: {
                              ...settings.defaultRecording,
                              captureNetwork: e.currentTarget.checked,
                            },
                          })
                        }
                      />
                      <span className="slider"></span>
                    </label>
                  </div>
                </div>

                <div className="setting-row">
                  <div className="setting-info">
                    <span className="setting-label">
                      {t("responseBodiesLabel")}
                    </span>
                  </div>
                  <div className="setting-control">
                    <SegmentedControl
                      ariaLabel={t("responseBodiesLabel")}
                      value={settings.defaultRecording.responseBodyPolicy}
                      options={[
                        {
                          value: "disabled",
                          label: t("responseBodiesDisabled"),
                        },
                        {
                          value: "standard",
                          label: t("responseBodiesStandard"),
                        },
                        { value: "full", label: t("responseBodiesFull") },
                      ]}
                      onChange={(val) =>
                        triggerAutoSave({
                          ...settings,
                          defaultRecording: {
                            ...settings.defaultRecording,
                            responseBodyPolicy: val as any,
                          },
                        })
                      }
                    />
                  </div>
                </div>

                <div className="setting-row">
                  <div className="setting-info">
                    <span className="setting-label">
                      {t("frameworkStates")}
                    </span>
                  </div>
                  <div className="setting-control">
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={
                          settings.defaultRecording.captureFrameworkState
                        }
                        onChange={(e) =>
                          triggerAutoSave({
                            ...settings,
                            defaultRecording: {
                              ...settings.defaultRecording,
                              captureFrameworkState: e.currentTarget.checked,
                            },
                          })
                        }
                      />
                      <span className="slider"></span>
                    </label>
                  </div>
                </div>

                <div className="setting-row">
                  <div className="setting-info">
                    <span className="setting-label">
                      {t("privacyModeLabel")}
                    </span>
                  </div>
                  <div className="setting-control">
                    <SegmentedControl
                      ariaLabel={t("privacyModeLabel")}
                      value={settings.defaultRecording.privacyMode}
                      options={[
                        { value: "safe", label: t("safeMode") },
                        { value: "raw", label: t("rawMode") },
                      ]}
                      onChange={(val) =>
                        triggerAutoSave({
                          ...settings,
                          defaultRecording: {
                            ...settings.defaultRecording,
                            privacyMode: val as any,
                          },
                        })
                      }
                    />
                  </div>
                </div>
              </div>
            )}

            {/* 4. 安全与脱敏 */}
            {activeTab === "privacy" && (
              <div className="settings-card">
                <div
                  className="setting-row"
                  style={{ flexDirection: "column", alignItems: "stretch" }}
                >
                  <div className="setting-info" style={{ maxWidth: "100%" }}>
                    <span className="setting-label">
                      {t("settingCustomSensitiveKeys")}
                    </span>
                    <span className="setting-desc">
                      {t("settingCustomSensitiveKeysDesc")}
                    </span>
                  </div>
                  <input
                    type="text"
                    className="text-input"
                    style={{ marginTop: 10 }}
                    placeholder="token, secret, auth_token, user_pin"
                    value={customKeysText}
                    onInput={(e) => setCustomKeysText(e.currentTarget.value)}
                    onBlur={commitTextSettings}
                  />
                </div>

                <div
                  className="setting-row"
                  style={{ flexDirection: "column", alignItems: "stretch" }}
                >
                  <div className="setting-info" style={{ maxWidth: "100%" }}>
                    <span className="setting-label">
                      {t("settingExcludeUrls")}
                    </span>
                    <span className="setting-desc">
                      {t("settingExcludeUrlsDesc")}
                    </span>
                  </div>
                  <textarea
                    className="textarea-input"
                    style={{ marginTop: 10, minHeight: 90 }}
                    placeholder="*.internal-auth.com&#10;analytics.google.com"
                    value={excludeUrlsText}
                    onInput={(e) => setExcludeUrlsText(e.currentTarget.value)}
                    onBlur={commitTextSettings}
                  />
                </div>
              </div>
            )}

            {/* 5. 存储与配额 */}
            {activeTab === "storage" && (
              <div className="settings-card">
                <div className="setting-row">
                  <div className="setting-info">
                    <span className="setting-label">
                      {t("settingVideoQuality")}
                    </span>
                    <span className="setting-desc">
                      {t("settingVideoQualityDesc")}
                    </span>
                  </div>
                  <div className="setting-control">
                    <SegmentedControl
                      ariaLabel={t("settingVideoQuality")}
                      value={settings.storage.compressionLevel}
                      options={[
                        { value: "small", label: t("qualitySmall") },
                        { value: "balanced", label: t("qualityBalanced") },
                        { value: "quality", label: t("qualityHigh") },
                      ]}
                      onChange={(val) =>
                        triggerAutoSave({
                          ...settings,
                          storage: {
                            ...settings.storage,
                            compressionLevel: val as any,
                          },
                        })
                      }
                    />
                  </div>
                </div>

                <div className="setting-row">
                  <div className="setting-info">
                    <span className="setting-label">
                      {t("settingRetention")}
                    </span>
                    <span className="setting-desc">
                      {t("settingRetentionDesc")}
                    </span>
                  </div>
                  <div className="setting-control">
                    <SegmentedControl
                      ariaLabel={t("settingRetention")}
                      value={settings.storage.retentionDays}
                      options={[7, 14, 30, 90].map((days) => ({
                        value: days,
                        label: t(`retentionDays${days}` as any) || `${days}天`,
                      }))}
                      onChange={(val) =>
                        triggerAutoSave({
                          ...settings,
                          storage: {
                            ...settings.storage,
                            retentionDays: val,
                          },
                        })
                      }
                    />
                  </div>
                </div>

                <div className="setting-row">
                  <div className="setting-info">
                    <span className="setting-label">
                      {t("settingMaxSessionBytes")}
                    </span>
                    <span className="setting-desc">
                      {t("settingMaxSessionBytesDesc")}
                    </span>
                  </div>
                  <div className="setting-control">
                    <SegmentedControl
                      ariaLabel={t("settingMaxSessionBytes")}
                      value={settings.storage.maxSessionBytes}
                      options={[
                        { value: 256 * 1024 * 1024, label: "256 MB" },
                        { value: 512 * 1024 * 1024, label: "512 MB" },
                        { value: 1024 * 1024 * 1024, label: "1 GB" },
                      ]}
                      onChange={(val) =>
                        triggerAutoSave({
                          ...settings,
                          storage: {
                            ...settings.storage,
                            maxSessionBytes: val,
                          },
                        })
                      }
                    />
                  </div>
                </div>

                <div className="setting-row">
                  <div className="setting-info">
                    <span className="setting-label">{t("clearAllData")}</span>
                    <span className="setting-desc">
                      {t("clearAllDataDesc")}
                    </span>
                  </div>
                  <div className="setting-control">
                    <button
                      className="btn btn-danger"
                      onClick={handleClearAllData}
                    >
                      {t("clearAllData")}
                    </button>
                  </div>
                </div>
                {clearStatus && (
                  <div
                    style={{
                      fontSize: 12.5,
                      color: "var(--primary)",
                      marginTop: 4,
                    }}
                  >
                    {clearStatus}
                  </div>
                )}
              </div>
            )}

            {/* 6. 快捷键指南 */}
            {activeTab === "shortcuts" && (
              <div className="settings-card">
                <div className="setting-row">
                  <div className="setting-info">
                    <span className="setting-label">
                      {t("shortcutStartRecording")}
                    </span>
                    <span className="setting-desc">
                      {t("commandStartRecordingDescription")}
                    </span>
                  </div>
                  <div className="setting-control">
                    <span className="shortcut-badge">Alt + R (macOS: ⌥R)</span>
                  </div>
                </div>

                <div className="setting-row">
                  <div className="setting-info">
                    <span className="setting-label">
                      {t("shortcutTakeScreenshot")}
                    </span>
                    <span className="setting-desc">
                      {t("commandTakeScreenshotDescription")}
                    </span>
                  </div>
                  <div className="setting-control">
                    <span className="shortcut-badge">Alt + X (macOS: ⌥X)</span>
                  </div>
                </div>

                <div className="setting-row">
                  <div className="setting-info">
                    <span className="setting-label">
                      {t("shortcutOpenPopup")}
                    </span>
                    <span className="setting-desc">
                      快速呼出 Bug Lens 操作面板
                    </span>
                  </div>
                  <div className="setting-control">
                    <span className="shortcut-badge">
                      Ctrl + Shift + Y (macOS: ⌘⇧Y)
                    </span>
                  </div>
                </div>

                <div className="setting-row" style={{ paddingTop: 6 }}>
                  <button
                    className="btn btn-default"
                    onClick={openShortcutsPage}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                    <span>{t("openChromeShortcuts")}</span>
                  </button>
                </div>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
