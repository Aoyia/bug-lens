import { memo } from "preact/compat";
import { t, type LanguagePreference } from "../../shared/i18n";

export type ResponseBodyPolicy = "disabled" | "standard" | "full";

export interface OptionsGridProps {
  controlsLocked: boolean;
  advancedOpen: boolean;
  captureVideo: boolean;
  captureAudio: boolean;
  captureScreenshots: boolean;
  captureConsole: boolean;
  captureNetwork: boolean;
  captureNetworkBodies?: boolean;
  captureFullResponseBody?: boolean;
  responseBodyPolicy?: ResponseBodyPolicy;
  captureFrameworkState: boolean;
  privacyMode: "safe" | "raw";
  languagePreference: LanguagePreference;
  onToggleAdvanced: () => void;
  onSetCaptureVideo: (val: boolean) => void;
  onSetCaptureAudio: (val: boolean) => void;
  onSetCaptureScreenshots: (val: boolean) => void;
  onSetCaptureConsole: (val: boolean) => void;
  onSetCaptureNetwork: (val: boolean) => void;
  onSetCaptureNetworkBodies?: (val: boolean) => void;
  onSetCaptureFullResponseBody?: (val: boolean) => void;
  onSetResponseBodyPolicy?: (policy: ResponseBodyPolicy) => void;
  onSetCaptureFrameworkState: (val: boolean) => void;
  onSetPrivacyMode: (mode: "safe" | "raw") => void;
  onSetLanguagePreference: (pref: LanguagePreference) => void;
}

export const OptionsGrid = memo(function OptionsGrid({
  controlsLocked,
  advancedOpen,
  captureVideo,
  captureAudio,
  captureScreenshots,
  captureConsole,
  captureNetwork,
  captureNetworkBodies,
  captureFullResponseBody,
  responseBodyPolicy,
  captureFrameworkState,
  privacyMode,
  languagePreference,
  onToggleAdvanced,
  onSetCaptureVideo,
  onSetCaptureAudio,
  onSetCaptureScreenshots,
  onSetCaptureConsole,
  onSetCaptureNetwork,
  onSetCaptureNetworkBodies,
  onSetCaptureFullResponseBody,
  onSetResponseBodyPolicy,
  onSetCaptureFrameworkState,
  onSetPrivacyMode,
  onSetLanguagePreference,
}: OptionsGridProps) {
  const lockedTitle = controlsLocked
    ? t("configLockedDuringRecording")
    : undefined;

  const currentResponseBodyPolicy: ResponseBodyPolicy =
    responseBodyPolicy ??
    (!captureNetworkBodies
      ? "disabled"
      : captureFullResponseBody
        ? "full"
        : "standard");

  const responseBodiesTitle = lockedTitle;

  const handleResponseBodyPolicyChange = (policy: ResponseBodyPolicy) => {
    if (onSetResponseBodyPolicy) {
      onSetResponseBodyPolicy(policy);
    }
    if (onSetCaptureNetworkBodies) {
      onSetCaptureNetworkBodies(policy !== "disabled");
    }
    if (onSetCaptureFullResponseBody) {
      onSetCaptureFullResponseBody(policy === "full");
    }
  };

  return (
    <div>
      <div className="inline-config">
        <span className="config-text">{t("defaultSafeCollection")}</span>
        <button
          id="toggle-options"
          className={`toggle-options-btn ${advancedOpen ? "open" : ""}`}
          onClick={onToggleAdvanced}
        >
          <span>{t("config")}</span>
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </button>
      </div>

      {advancedOpen && (
        <div id="advanced-options" className="advanced-panel">
          <div className="scopes-grid">
            <label className="scope-chip" title={lockedTitle}>
              <input
                id="video"
                type="checkbox"
                checked={captureVideo}
                disabled={controlsLocked}
                onChange={(e) => {
                  onSetCaptureVideo(e.currentTarget.checked);
                  if (!e.currentTarget.checked) onSetCaptureAudio(false);
                }}
              />
              <span>{t("video")}</span>
            </label>
            <label
              className="scope-chip"
              title={
                lockedTitle ??
                (!captureVideo ? t("audioNeedsVideo") : undefined)
              }
            >
              <input
                id="audio"
                type="checkbox"
                checked={captureAudio}
                disabled={controlsLocked || !captureVideo}
                onChange={(e) => onSetCaptureAudio(e.currentTarget.checked)}
              />
              <span>{t("audio")}</span>
            </label>
            <label className="scope-chip" title={lockedTitle}>
              <input
                id="screenshots"
                type="checkbox"
                checked={captureScreenshots}
                disabled={controlsLocked}
                onChange={(e) =>
                  onSetCaptureScreenshots(e.currentTarget.checked)
                }
              />
              <span>{t("clickScreenshots")}</span>
            </label>
            <label className="scope-chip" title={lockedTitle}>
              <input
                id="console"
                type="checkbox"
                checked={captureConsole}
                disabled={controlsLocked}
                onChange={(e) => onSetCaptureConsole(e.currentTarget.checked)}
              />
              <span>{t("console")}</span>
            </label>
            <label className="scope-chip" title={lockedTitle}>
              <input
                id="network"
                type="checkbox"
                checked={captureNetwork}
                disabled={controlsLocked}
                onChange={(e) => {
                  onSetCaptureNetwork(e.currentTarget.checked);
                }}
              />
              <span>{t("network")}</span>
            </label>
            <label className="scope-chip" title={lockedTitle}>
              <input
                id="framework-state"
                type="checkbox"
                checked={captureFrameworkState}
                disabled={controlsLocked}
                onChange={(e) =>
                  onSetCaptureFrameworkState(e.currentTarget.checked)
                }
              />
              <span>{t("frameworkStates")}</span>
            </label>
          </div>
          {captureNetwork && (
            <label className="video-quality-row" title={responseBodiesTitle}>
              <span className="video-quality-label">
                {t("responseBodiesLabel")}
              </span>
              <select
                id="response-bodies"
                className="privacy-select"
                value={currentResponseBodyPolicy}
                disabled={controlsLocked}
                title={responseBodiesTitle}
                onChange={(e) =>
                  handleResponseBodyPolicyChange(
                    e.currentTarget.value as ResponseBodyPolicy
                  )
                }
              >
                <option value="disabled">{t("responseBodiesDisabled")}</option>
                <option value="standard">{t("responseBodiesStandard")}</option>
                <option value="full">{t("responseBodiesFull")}</option>
              </select>
            </label>
          )}
          <label className="video-quality-row" title={lockedTitle}>
            <span className="video-quality-label">{t("privacyModeLabel")}</span>
            <select
              id="privacy"
              className="privacy-select"
              value={privacyMode}
              disabled={controlsLocked}
              title={lockedTitle}
              onChange={(e) =>
                onSetPrivacyMode(e.currentTarget.value as "safe" | "raw")
              }
            >
              <option value="safe">{t("safeMode")}</option>
              <option value="raw">{t("rawMode")}</option>
            </select>
          </label>
          {privacyMode === "raw" && (
            <div className="raw-mode-inline-warning" role="note">
              {t("rawModeWarning")}
            </div>
          )}
          <label className="video-quality-row" title={lockedTitle}>
            <span className="video-quality-label">{t("language")}</span>
            <select
              id="language-preference"
              className="privacy-select"
              value={languagePreference}
              disabled={controlsLocked}
              title={lockedTitle}
              onChange={(e) =>
                onSetLanguagePreference(
                  e.currentTarget.value as LanguagePreference
                )
              }
            >
              <option value="auto">{t("languageAuto")}</option>
              <option value="zh-CN">{t("languageZhCN")}</option>
              <option value="en-US">{t("languageEnUS")}</option>
            </select>
          </label>
        </div>
      )}
    </div>
  );
});
