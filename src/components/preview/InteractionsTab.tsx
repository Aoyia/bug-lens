import { memo } from "preact/compat";
import { useState, useMemo } from "preact/hooks";
import type {
  InteractionRecord,
  ElementDescriptor,
} from "../../shared/protocol";
import {
  groupInteractions,
  type GroupedInteractionCard,
} from "../../domain/interaction-grouping";

import { copyTextToClipboard } from "../../preview/clipboard";

function formatPlaywrightLocator(
  locator: { kind: string; expression: string },
  element: ElementDescriptor
): string {
  const expression = locator.expression;
  if (expression.startsWith("page.")) return expression;
  if (locator.kind === "role") {
    const roleName =
      expression.match(/^role=(.+)$/)?.[1] ?? element.role ?? "button";
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

function formatStepForAi(
  card: GroupedInteractionCard,
  stepIndex: number
): string {
  const primary = card.primaryRecord;
  const element = primary.element;
  const locators = element.locators || [];
  const primaryLocator = locators[0]
    ? formatPlaywrightLocator(locators[0], element)
    : undefined;

  const classNames = element.classNames?.length
    ? `.${element.classNames.join(".")}`
    : "";
  const tagWithClass = `${element.tagName.toLowerCase()}${classNames}`;
  const textVal = card.aggregatedMeta.finalValue
    ? `值: "${card.aggregatedMeta.finalValue}"`
    : element.text
      ? `文本: "${element.text}"`
      : "";
  const elementSnippet = `<${tagWithClass}${textVal ? ` ${textVal}` : ""}>`;

  const lines = [
    `【步骤 ${stepIndex}】${card.aggregatedMeta.title}`,
    `- 页面 URL: ${primary.page.url}`,
  ];

  if (element.framework?.vue) {
    const vueInfo = element.framework.vue;
    const componentName = vueInfo.targetComponent?.componentName;
    if (componentName) {
      lines.push(`- Vue 组件: <${componentName}> (Vue ${vueInfo.version})`);
    }
  }

  lines.push(`- 目标元素: ${elementSnippet}`);
  if (primaryLocator) {
    lines.push(`- 核心定位器: ${primaryLocator}`);
  }

  return lines.join("\n");
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
  onNotify?: (message: string) => void;
}

export const InteractionsTab = memo(function InteractionsTab({
  snapshot,
  editable,
  onExclude,
  onOpenImage,
  onSeekVideo,
  onNotify,
}: InteractionsTabProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [expandedCardIds, setExpandedCardIds] = useState<
    Record<string, boolean>
  >({});

  const groupedCards = useMemo(() => {
    return groupInteractions(snapshot.included);
  }, [snapshot.included]);

  const toggleExpand = (cardId: string, e: MouseEvent) => {
    e.stopPropagation();
    setExpandedCardIds((prev) => ({
      ...prev,
      [cardId]: !prev[cardId],
    }));
  };

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
      {groupedCards.map((card, cardIndex) => {
        const primary = card.primaryRecord;
        const primaryOriginalIndex = snapshot.all.indexOf(primary);
        const isActive = activeIndex === primaryOriginalIndex;
        const isExpanded = !!expandedCardIds[card.id];
        const element = primary.element;
        const coordinates = primary.coordinates;

        const screenshotRecord =
          card.aggregatedMeta.primaryScreenshotRecord || primary;
        const screenshotDataUrl = screenshotRecord.screenshot.dataUrl;

        const size = element.boundingBox
          ? `${Math.round(element.boundingBox.width)}×${Math.round(element.boundingBox.height)} px`
          : "-";

        const coordinateText = coordinates
          ? `(${Math.round(coordinates.clientX)}, ${Math.round(coordinates.clientY)})`
          : "-";

        const viewport = coordinates?.viewport
          ? `${coordinates.viewport.width}×${coordinates.viewport.height} (${primary.input?.pointerType ?? "mouse"})`
          : "-";

        const classNames = element.classNames?.length
          ? element.classNames.join(" ")
          : "-";
        const role = element.role
          ? `${element.role}${element.accessibleName || element.text ? ` ("${element.accessibleName || element.text}")` : ""}`
          : "-";
        const frame =
          primary.page.frameId === 0
            ? "顶层页面"
            : `Frame #${primary.page.frameId}`;
        const locators = element.locators || [];

        // 计算文本/输入展示内容
        const inputLength =
          card.aggregatedMeta.finalValueLength ??
          (card.aggregatedMeta.finalValue
            ? card.aggregatedMeta.finalValue.length
            : undefined);
        const textDisplay = card.aggregatedMeta.finalValue
          ? `值: "${card.aggregatedMeta.finalValue}"`
          : inputLength !== undefined
            ? `已写入 ${inputLength} 字符 (脱敏)`
            : element.text || "-";

        return (
          <article
            key={card.id}
            className={`item grouped-card ${isActive ? "active" : ""} ${card.kind}`}
            data-index={primaryOriginalIndex}
            data-step={cardIndex + 1}
            onClick={(e) => {
              if (
                (e.target as HTMLElement).closest(
                  ".delete, .accordion-btn, .copy-locator-btn, .copy-step-btn"
                )
              )
                return;
              setActiveIndex(primaryOriginalIndex);
              if ((e.target as HTMLElement).classList.contains("shot")) {
                onOpenImage(screenshotRecord.id);
              } else if (snapshot.hasMedia) {
                onSeekVideo?.(card.aggregatedMeta.startTime);
              }
            }}
          >
            <div className="top">
              <strong data-tooltip={card.aggregatedMeta.title}>
                {card.aggregatedMeta.title}
              </strong>
              <div className="item-actions">
                {inputLength !== undefined && (
                  <span
                    className="badge badge-input-len"
                    title={`包含写入文本内容 ${inputLength} 字符`}
                  >
                    ✍️ 写入 {inputLength} 字符
                  </span>
                )}
                {card.aggregatedMeta.hasEnterSubmit && (
                  <span className="badge badge-enter" title="包含回车提交">
                    Enter
                  </span>
                )}
                {card.children.length > 1 && (
                  <span
                    className="badge badge-count"
                    title={`由 ${card.children.length} 个物理事件聚合`}
                  >
                    {card.children.length} 步骤
                  </span>
                )}
                <span
                  className={`badge ${primary.screenshot.status === "unavailable" ? "partial" : ""}`}
                >
                  {primary.screenshot.source ?? primary.screenshot.status}
                </span>
                <button
                  className="item-copy-btn copy-step-btn"
                  title="复制步骤描述文本"
                  onClick={(e) => {
                    e.stopPropagation();
                    const text = formatStepForAi(card, cardIndex + 1);
                    void copyTextToClipboard(text)
                      .then(() => {
                        onNotify?.(`已复制步骤 ${cardIndex + 1} 描述`);
                      })
                      .catch((err) => {
                        onNotify?.(`复制失败: ${String(err)}`);
                      });
                  }}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.0"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect
                      x="9"
                      y="9"
                      width="13"
                      height="13"
                      rx="2"
                      ry="2"
                    ></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                  </svg>
                </button>
                {editable && (
                  <button
                    className="item-delete-btn delete"
                    title="从预览和导出中删除此聚合步骤"
                    onClick={(e) => {
                      e.stopPropagation();
                      card.children.forEach((child) => onExclude?.(child.id));
                    }}
                  >
                    <svg
                      width="17"
                      height="17"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.0"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="3 6 5 6 21 6"></polyline>
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                      <line x1="10" y1="11" x2="10" y2="17"></line>
                      <line x1="14" y1="11" x2="14" y2="17"></line>
                    </svg>
                  </button>
                )}
              </div>
            </div>
            <div className="text">
              {primary.page.url} ·{" "}
              {new Date(card.aggregatedMeta.startTime).toLocaleTimeString()}
              {card.children.length > 1 &&
                ` ~ ${new Date(card.aggregatedMeta.endTime).toLocaleTimeString()}`}
            </div>

            <div className="aggregated-summary-bar">
              <span className="summary-desc">
                {card.aggregatedMeta.description}
              </span>
              {card.children.length > 1 && (
                <button
                  className={`accordion-btn ${isExpanded ? "expanded" : ""}`}
                  type="button"
                  onClick={(e) => toggleExpand(card.id, e)}
                >
                  {isExpanded ? "收起明细 ▲" : "展开微步骤 明细 ▼"}
                </button>
              )}
            </div>

            {/* 当多步骤且展开时，渲染子时间线 */}
            {card.children.length > 1 && isExpanded && (
              <div className="sub-steps-container">
                <div className="sub-steps-header">微观物理事件列表</div>
                <div className="sub-steps-timeline">
                  {card.children.map((child, subIdx) => (
                    <div className="sub-step-item" key={child.id}>
                      <span className="sub-step-idx">{subIdx + 1}.</span>
                      <span className={`sub-step-kind kind-${child.kind}`}>
                        {child.kind}
                      </span>
                      <span className="sub-step-time">
                        {new Date(child.createdAt).toLocaleTimeString()}
                      </span>

                      {child.kind === "input" && (
                        <span className="sub-step-detail highlight-input-detail">
                          {child.metadata?.value !== undefined
                            ? `✍️ 写入内容: "${child.metadata.value}"`
                            : child.metadata?.valueLength !== undefined
                              ? `✍️ 写入 ${child.metadata.valueLength} 字符 (脱敏)`
                              : "✍️ 写入文本"}
                          {child.metadata?.inputEventCount &&
                          child.metadata.inputEventCount > 1
                            ? ` (${child.metadata.inputEventCount} 次打字)`
                            : ""}
                        </span>
                      )}

                      {child.kind !== "input" &&
                        child.metadata?.value !== undefined && (
                          <span className="sub-step-detail">
                            值: "{child.metadata.value}"
                          </span>
                        )}

                      {child.metadata?.key && (
                        <span className="sub-step-detail">
                          按键: {child.metadata.key}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="step-body-grid">
              {screenshotDataUrl && (
                <div className="step-media">
                  <img
                    className="shot step-shot"
                    src={screenshotDataUrl}
                    alt="点击/操作截图"
                    data-img-id={screenshotRecord.id}
                    title="点击放大查看大图"
                  />
                </div>
              )}
              <div className="step-details-panel">
                <div className="step-section">
                  <div className="step-section-title">目标元素</div>
                  <table className="target-element-table">
                    <tbody>
                      <tr>
                        <td className="td-label">标签</td>
                        <td className="td-value">
                          {element.tagName.toLowerCase()}
                        </td>
                      </tr>
                      <tr>
                        <td className="td-label">类名</td>
                        <td className="td-value" data-tooltip={classNames}>
                          {classNames}
                        </td>
                      </tr>
                      <tr>
                        <td className="td-label">文本/输入</td>
                        <td
                          className={`td-value ${inputLength !== undefined ? "highlight-value-text" : ""}`}
                          data-tooltip={textDisplay}
                        >
                          {textDisplay}
                        </td>
                      </tr>
                      <tr>
                        <td className="td-label">Role</td>
                        <td className="td-value">{role}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className="step-section">
                  <div className="step-section-title">上下文</div>
                  <table className="target-element-table">
                    <tbody>
                      <tr>
                        <td className="td-label">尺寸</td>
                        <td className="td-value">{size}</td>
                      </tr>
                      <tr>
                        <td className="td-label">坐标</td>
                        <td className="td-value">{coordinateText}</td>
                      </tr>
                      <tr>
                        <td className="td-label">视口</td>
                        <td className="td-value">{viewport}</td>
                      </tr>
                      <tr>
                        <td className="td-label">Frame</td>
                        <td className="td-value">{frame}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                {locators.length > 0 && (
                  <div className="step-section">
                    <div className="step-section-title">定位器候选</div>
                    <ol className="locator-list">
                      {locators.map((locator, locatorIndex) => {
                        const formatted = formatPlaywrightLocator(
                          locator,
                          element
                        );
                        return (
                          <li className="locator-item" key={locatorIndex}>
                            <span className="locator-index">
                              {locatorIndex + 1}.
                            </span>
                            <code className="locator-code">{formatted}</code>
                            <span className="locator-meta">
                              {locator.kind} · 匹配{" "}
                              {locator.matchCount > 0
                                ? locator.matchCount
                                : "?"}{" "}
                              · 稳定性{" "}
                              {Math.round(locator.stabilityScore * 100)}%
                            </span>
                            <button
                              className="copy-locator-btn"
                              type="button"
                              data-copy-locator={formatted}
                            >
                              复制
                            </button>
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
