import { memo } from "preact/compat";
import type { FrameworkStateEvidence } from "../../shared/protocol";
import { renderFrameworkSnapshot } from "../../preview/framework-view";
import { formatElapsedEpochTime } from "../../domain/evidence-clock";

export interface FrameworkStateTabProps {
  states: FrameworkStateEvidence[];
  startedAtEpochMs?: number;
}

const TRIGGER_LABEL: Record<FrameworkStateEvidence["trigger"], string> = {
  start: "会话开始",
  interaction: "交互确认",
  "issue-scene": "标记问题",
  resume: "继续录制",
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
    return (
      <div className="framework-state-empty">
        未采集到 React/Vue
        组件状态快照。录制时页面未识别到框架，或未开启框架状态采集。
      </div>
    );
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
                {TRIGGER_LABEL[state.trigger] ?? state.trigger}
              </span>
              <time>
                {elapsed ??
                  new Date(state.capturedAtEpochMs).toLocaleTimeString()}
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
                title="全局状态 (globalState)"
                value={state.globalState}
              />
            ) : null}

            {state.webStorage ? (
              <div className="framework-state-section">
                <div className="framework-state-section-title">
                  Web Storage
                  {state.webStorage.redactedValues
                    ? "（安全模式，值已脱敏）"
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
              <div className="framework-state-empty">
                该帧未包含可展示的状态。
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
});
