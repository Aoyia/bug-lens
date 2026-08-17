import { memo } from "preact/compat";
import type { FrameworkStateEvidence } from "../../shared/protocol";
import { renderFrameworkSnapshot } from "../../preview/framework-view";
import { formatElapsedEpochTime } from "../../domain/evidence-clock";
import { t, getLocale } from "../../shared/i18n.ts";

export interface FrameworkStateTabProps {
  states: FrameworkStateEvidence[];
  startedAtEpochMs?: number;
}

const TRIGGER_LABEL_KEYS: Record<FrameworkStateEvidence["trigger"], string> = {
  start: "fwTriggerStart",
  interaction: "fwTriggerInteraction",
  "issue-scene": "fwTriggerIssueScene",
  resume: "fwTriggerResume",
};

function renderJsonValue(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function StateSection({ title, value }: { title: string; value: unknown }) {
  if (value === undefined) return null;
  return (
    <div className="framework-state-section">
      <div className="framework-state-section-title">{title}</div>
      <pre className="framework-state-json">{renderJsonValue(value)}</pre>
    </div>
  );
}

export const FrameworkStateTab = memo(function FrameworkStateTab({
  states,
  startedAtEpochMs,
}: FrameworkStateTabProps) {
  if (!states || states.length === 0) {
    return <div className="framework-state-empty">{t("fwEmpty")}</div>;
  }

  return (
    <div className="framework-state-list" data-testid="framework-state-list">
      {states.map((state) => {
        const elapsed = startedAtEpochMs
          ? formatElapsedEpochTime(state.capturedAtEpochMs, startedAtEpochMs)
          : undefined;
        const snapshotHtml = state.snapshot
          ? renderFrameworkSnapshot(state.snapshot)
          : "";
        return (
          <article
            key={state.id}
            className="framework-state-card"
            data-framework-state-id={state.id}
          >
            <header className="framework-state-card-header">
              <span className="framework-state-trigger">
                {t(TRIGGER_LABEL_KEYS[state.trigger]) ?? state.trigger}
              </span>
              <time>
                {elapsed ??
                  new Date(state.capturedAtEpochMs).toLocaleTimeString(
                    getLocale()
                  )}
              </time>
              <span className="framework-state-url" title={state.page.url}>
                {state.page.url}
              </span>
            </header>

            {snapshotHtml ? (
              <div
                className="framework-state-tree"
                dangerouslySetInnerHTML={{ __html: snapshotHtml }}
              />
            ) : null}

            {state.globalState ? (
              <StateSection
                title={t("fwGlobalState")}
                value={state.globalState}
              />
            ) : null}

            {state.webStorage ? (
              <div className="framework-state-section">
                <div className="framework-state-section-title">
                  {t("fwWebStorage")}
                  {state.webStorage.redactedValues
                    ? t("fwWebStorageRedacted")
                    : ""}
                </div>
                {state.webStorage.localStorage ? (
                  <div className="framework-state-storage">
                    <div className="framework-state-storage-label">
                      localStorage
                    </div>
                    <pre className="framework-state-json">
                      {renderJsonValue(state.webStorage.localStorage)}
                    </pre>
                  </div>
                ) : null}
                {state.webStorage.sessionStorage ? (
                  <div className="framework-state-storage">
                    <div className="framework-state-storage-label">
                      sessionStorage
                    </div>
                    <pre className="framework-state-json">
                      {renderJsonValue(state.webStorage.sessionStorage)}
                    </pre>
                  </div>
                ) : null}
              </div>
            ) : null}

            {!snapshotHtml && !state.globalState && !state.webStorage ? (
              <div className="framework-state-empty">{t("fwNoState")}</div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
});
