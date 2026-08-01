import { memo } from "preact/compat";
import { useState } from "preact/hooks";
import type { InteractionRecord, ElementDescriptor } from "../../shared/protocol";

function formatPlaywrightLocator(locator: { kind: string; expression: string }, element: ElementDescriptor): string {
  const expression = locator.expression;
  if (expression.startsWith("page.")) return expression;
  if (locator.kind === "role") {
    const roleName = expression.match(/^role=(.+)$/)?.[1] ?? element.role ?? "button";
    const name = element.accessibleName || element.text;
    if (name && name.length < 50) {
      return `page.getByRole("${roleName}", { name: "${name.replace(/"/g, '\\"')}" })`;
    }
    return `page.getByRole("${roleName}")`;
  }
  if (locator.kind === "text") {
    return `page.getByText("${expression.replace(/"/g, '\\"')}")`;
  }
  if (locator.kind === "testId") {
    const testId = expression.match(/\[data-[^=]+="([^"]+)"\]/)?.[1];
    if (testId) return `page.getByTestId("${testId}")`;
  }
  return `page.locator("${expression.replace(/"/g, '\\"')}")`;
}

export interface InteractionsTabProps {
  snapshot: {
    all: InteractionRecord[];
    included: InteractionRecord[];
    hasMedia: boolean;
    startedAtEpochMs?: number;
  };
  editable: boolean;
  onExclude?: (interactionId: string) => void;
  onOpenImage: (interactionId: string) => void;
  onSeekVideo?: (timestampMs: number) => void;
}

export const InteractionsTab = memo(function InteractionsTab({
  snapshot,
  editable,
  onExclude,
  onOpenImage,
  onSeekVideo
}: InteractionsTabProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  if (snapshot.included.length === 0) {
    return (
      <div className="empty">
        {snapshot.all.length > 0 && editable
          ? "所有交互步骤均已删除，可从右上角恢复。"
          : "没有捕获到点击"}
      </div>
    );
  }

  return (
    <>
      {snapshot.included.map((item, index) => {
        const originalIndex = snapshot.all.indexOf(item);
        const isActive = activeIndex === originalIndex;
        const element = item.element;
        const coordinates = item.coordinates;

        const size = element.boundingBox
          ? `${Math.round(element.boundingBox.width)}×${Math.round(element.boundingBox.height)} px`
          : "-";

        const coordinateText = coordinates
          ? `(${Math.round(coordinates.clientX)}, ${Math.round(coordinates.clientY)})`
          : "-";

        const viewport = coordinates?.viewport
          ? `${coordinates.viewport.width}×${coordinates.viewport.height} (${item.input?.pointerType ?? "mouse"})`
          : "-";

        const classNames = element.classNames?.length ? element.classNames.join(" ") : "-";

        const role = element.role
          ? `${element.role}${element.accessibleName || element.text ? ` ("${element.accessibleName || element.text}")` : ""}`
          : "-";

        const frame = item.page.frameId === 0 ? "顶层页面" : `Frame #${item.page.frameId}`;

        const locators = element.locators || [];

        return (
          <article
            key={item.id}
            className={`item ${isActive ? "active" : ""}`}
            data-index={originalIndex}
            data-step={index + 1}
            onClick={(e) => {
              if ((e.target as HTMLElement).closest(".delete")) return;
              setActiveIndex(originalIndex);
              if ((e.target as HTMLElement).classList.contains("shot")) {
                onOpenImage(item.id);
              } else if (snapshot.hasMedia) {
                onSeekVideo?.(item.createdAt);
              }
            }}
          >
            <div className="top">
              <strong data-tooltip={element.text || element.tagName}>
                {element.text || element.tagName}
              </strong>
              <div className="item-actions">
                <span className={`badge ${item.screenshot.status === "unavailable" ? "partial" : ""}`}>
                  {item.screenshot.source ?? item.screenshot.status}
                </span>
                {editable && (
                  <button
                    className="item-delete-btn delete"
                    title="从预览和导出中删除此步骤"
                    onClick={(e) => {
                      e.stopPropagation();
                      onExclude?.(item.id);
                    }}
                  >
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.0" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6"></polyline>
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                      <line x1="10" y1="11" x2="10" y2="17"></line>
                      <line x1="14" y1="11" x2="14" y2="17"></line>
                    </svg>
                  </button>
                )}
              </div>
            </div>
            <div className="text">{item.page.url} · {new Date(item.createdAt).toLocaleTimeString()}</div>
            <div className="step-body-grid">
              {item.screenshot.dataUrl && (
                <div className="step-media">
                  <img
                    className="shot step-shot"
                    src={item.screenshot.dataUrl}
                    alt="点击截图"
                    data-img-id={item.id}
                    title="点击放大查看大图"
                  />
                </div>
              )}
              <div className="step-details-panel">
                <div className="step-section">
                  <div className="step-section-title">目标元素</div>
                  <table className="target-element-table">
                    <tbody>
                      <tr><td className="td-label">标签</td><td className="td-value">{element.tagName.toLowerCase()}</td></tr>
                      <tr><td className="td-label">类名</td><td className="td-value" data-tooltip={classNames}>{classNames}</td></tr>
                      <tr><td className="td-label">文本</td><td className="td-value" data-tooltip={element.text || ""}>{element.text || "-"}</td></tr>
                      <tr><td className="td-label">Role</td><td className="td-value">{role}</td></tr>
                    </tbody>
                  </table>
                </div>
                <div className="step-section">
                  <div className="step-section-title">点击上下文</div>
                  <table className="target-element-table">
                    <tbody>
                      <tr><td className="td-label">尺寸</td><td className="td-value">{size}</td></tr>
                      <tr><td className="td-label">坐标</td><td className="td-value">{coordinateText}</td></tr>
                      <tr><td className="td-label">视口</td><td className="td-value">{viewport}</td></tr>
                      <tr><td className="td-label">Frame</td><td className="td-value">{frame}</td></tr>
                    </tbody>
                  </table>
                </div>
                {locators.length > 0 && (
                  <div className="step-section">
                    <div className="step-section-title">定位器候选</div>
                    <ol className="locator-list">
                      {locators.map((locator, locatorIndex) => {
                        const formatted = formatPlaywrightLocator(locator, element);
                        return (
                          <li className="locator-item" key={locatorIndex}>
                            <span className="locator-index">{locatorIndex + 1}.</span>
                            <code className="locator-code">{formatted}</code>
                            <span className="locator-meta">
                              {locator.kind} · 匹配 {locator.matchCount > 0 ? locator.matchCount : "?"} · 稳定性 {Math.round(locator.stabilityScore * 100)}%
                            </span>
                            <button className="copy-locator-btn" type="button" data-copy-locator={formatted}>复制</button>
                          </li>
                        );
                      })}
                    </ol>
                  </div>
                )}
              </div>
            </div>
          </article>
        );
      })}
    </>
  );
});
