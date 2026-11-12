import { memo } from "preact/compat";
import { t } from "../../shared/i18n";
import { Select, type SelectOption } from "../common/Select";
import {
  applyRecordingOptionPatch,
  normalizeResponseBodyPolicy,
} from "../../domain/recording-options-patch";

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
  privacyMode: "safe" | "strict" | "raw";
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
  onSetPrivacyMode: (mode: "safe" | "strict" | "raw") => void;
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
}: OptionsGridProps) {
  const lockedTitle = controlsLocked
    ? t("configLockedDuringRecording")
    : undefined;

  const currentResponseBodyPolicy: ResponseBodyPolicy =
    normalizeResponseBodyPolicy(responseBodyPolicy, captureFullResponseBody);

  const responseBodiesTitle = lockedTitle;

  const handleResponseBodyPolicyChange = (policy: ResponseBodyPolicy) => {
    const nextPolicy: ResponseBodyPolicy = normalizeResponseBodyPolicy(policy);
    if (onSetResponseBodyPolicy) {
      onSetResponseBodyPolicy(nextPolicy);
    }
    if (onSetCaptureNetworkBodies) {
      onSetCaptureNetworkBodies(true);
    }
    if (onSetCaptureFullResponseBody) {
      onSetCaptureFullResponseBody(nextPolicy === "full");
    }
  };

  const responseBodyOptions: SelectOption<ResponseBodyPolicy>[] = [
    { value: "standard", label: t("responseBodiesStandard") },
    { value: "full", label: t("responseBodiesFull") },
  ];

  const privacyModeOptions: SelectOption<"safe" | "strict" | "raw">[] = [
    { value: "safe", label: t("safeMode") },
    { value: "strict", label: t("strictMode") },
    { value: "raw", label: t("rawMode") },
  ];

  return (
    <div>
      <div className="inline-config">
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

      <div
        className={`advanced-panel-wrapper ${advancedOpen ? "open" : ""}`}
        aria-hidden={!advancedOpen}
      >
        <div className="advanced-panel-inner">
          <div id="advanced-options" className="advanced-panel">
            <div className="scopes-grid">
              <label className="scope-chip" title={lockedTitle}>
                <input
                  id="video"
                  type="checkbox"
                  checked={captureVideo}
                  disabled={controlsLocked}
                  onChange={(e) => {
                    const next = applyRecordingOptionPatch(
                      { captureVideo, captureAudio },
                      { captureVideo: e.currentTarget.checked }
                    );
                    onSetCaptureVideo(next.captureVideo);
                    if (next.captureAudio !== captureAudio) {
                      onSetCaptureAudio(next.captureAudio);
                    }
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
              <div className="video-quality-row" title={responseBodiesTitle}>
                <span className="video-quality-label">
                  {t("responseBodiesLabel")}
                </span>
                <Select
                  id="response-bodies"
                  className="privacy-select"
                  value={currentResponseBodyPolicy}
                  options={responseBodyOptions}
                  disabled={controlsLocked}
                  title={responseBodiesTitle}
                  onChange={handleResponseBodyPolicyChange}
                />
              </div>
            )}
            <div className="video-quality-row" title={lockedTitle}>
              <span className="video-quality-label">
                {t("privacyModeLabel")}
              </span>
              <div className="privacy-select-field">
                <Select
                  id="privacy"
                  className="privacy-select"
                  value={privacyMode}
                  options={privacyModeOptions}
                  disabled={controlsLocked}
                  title={lockedTitle}
                  onChange={onSetPrivacyMode}
                  suffix={
                    privacyMode === "raw" ? (
                      <span
                        className="raw-mode-inline-warning privacy-warning-icon"
                        role="note"
                        tabIndex={0}
                        aria-label={t("rawModeWarning")}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <circle cx="12" cy="12" r="10" />
                          <line x1="12" y1="8" x2="12" y2="12" />
                          <line x1="12" y1="16" x2="12.01" y2="16" />
                        </svg>
                        <span className="privacy-tooltip-bubble" role="tooltip">
                          {t("rawModeWarning")}
                        </span>
                      </span>
                    ) : undefined
                  }
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});
