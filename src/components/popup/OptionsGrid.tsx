import { memo } from "preact/compat";
import { t } from "../../shared/i18n";

export type VideoQuality = "quality" | "balanced" | "small";

interface OptionsGridProps {
  controlsLocked: boolean;
  advancedOpen: boolean;
  captureVideo: boolean;
  captureAudio: boolean;
  captureScreenshots: boolean;
  captureConsole: boolean;
  captureNetwork: boolean;
  captureNetworkBodies: boolean;
  captureFrameworkState: boolean;
  videoQuality: VideoQuality;
  privacyMode: "safe" | "raw";
  onToggleAdvanced: () => void;
  onSetCaptureVideo: (val: boolean) => void;
  onSetCaptureAudio: (val: boolean) => void;
  onSetCaptureScreenshots: (val: boolean) => void;
  onSetCaptureConsole: (val: boolean) => void;
  onSetCaptureNetwork: (val: boolean) => void;
  onSetCaptureNetworkBodies: (val: boolean) => void;
  onSetCaptureFrameworkState: (val: boolean) => void;
  onSetVideoQuality: (val: VideoQuality) => void;
  onSetPrivacyMode: (mode: "safe" | "raw") => void;
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
  captureFrameworkState,
  videoQuality,
  privacyMode,
  onToggleAdvanced,
  onSetCaptureVideo,
  onSetCaptureAudio,
  onSetCaptureScreenshots,
  onSetCaptureConsole,
  onSetCaptureNetwork,
  onSetCaptureNetworkBodies,
  onSetCaptureFrameworkState,
  onSetVideoQuality,
  onSetPrivacyMode,
}: OptionsGridProps) {
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
            <label className="scope-chip">
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
            <label className="scope-chip">
              <input
                id="audio"
                type="checkbox"
                checked={captureAudio}
                disabled={controlsLocked || !captureVideo}
                onChange={(e) => onSetCaptureAudio(e.currentTarget.checked)}
              />
              <span>{t("audio")}</span>
            </label>
            <label className="scope-chip">
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
            <label className="scope-chip">
              <input
                id="console"
                type="checkbox"
                checked={captureConsole}
                disabled={controlsLocked}
                onChange={(e) => onSetCaptureConsole(e.currentTarget.checked)}
              />
              <span>{t("console")}</span>
            </label>
            <label className="scope-chip">
              <input
                id="network"
                type="checkbox"
                checked={captureNetwork}
                disabled={controlsLocked}
                onChange={(e) => {
                  onSetCaptureNetwork(e.currentTarget.checked);
                  if (!e.currentTarget.checked)
                    onSetCaptureNetworkBodies(false);
                }}
              />
              <span>{t("network")}</span>
            </label>
            <label className="scope-chip">
              <input
                id="bodies"
                type="checkbox"
                checked={captureNetworkBodies}
                disabled={controlsLocked || !captureNetwork}
                onChange={(e) =>
                  onSetCaptureNetworkBodies(e.currentTarget.checked)
                }
              />
              <span>{t("responseBodies")}</span>
            </label>
            <label className="scope-chip">
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
          <select
            id="privacy"
            className="privacy-select"
            value={privacyMode}
            disabled={controlsLocked}
            onChange={(e) =>
              onSetPrivacyMode(e.currentTarget.value as "safe" | "raw")
            }
          >
            <option value="safe">{t("safeMode")}</option>
            <option value="raw">{t("rawMode")}</option>
          </select>
          {privacyMode === "raw" && (
            <div className="raw-mode-inline-warning" role="note">
              {t("rawModeWarning")}
            </div>
          )}
          {captureVideo && (
            <label className="video-quality-row">
              <span className="video-quality-label">{t("videoQuality")}</span>
              <select
                id="video-quality"
                className="privacy-select"
                value={videoQuality}
                disabled={controlsLocked}
                onChange={(e) =>
                  onSetVideoQuality(e.currentTarget.value as VideoQuality)
                }
              >
                <option value="quality">{t("videoQualityHigh")}</option>
                <option value="balanced">{t("videoQualityBalanced")}</option>
                <option value="small">{t("videoQualitySmall")}</option>
              </select>
            </label>
          )}
        </div>
      )}
    </div>
  );
});
