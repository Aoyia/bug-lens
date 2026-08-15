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
import { formatElapsedEpochTime } from "../../domain/evidence-clock";

import { copyTextToClipboard } from "../../preview/clipboard";
import { t } from "../../shared/i18n.ts";

/**
 * 步骤卡片时间的统一时间语言：优先显示相对录制起点的 MM:SS.mmm
 * （与 NetworkTab / StreamTab / ConsoleTab 的证据时间线契约一致，
 *  点击卡片 seek 视频时行时间必须与视频时间轴同基准）。
 * 无起点或时间早于起点时回退到本地绝对时间，不丢信息、不抛异常。
 */
function formatStepTime(
  epochMs: number,
  originEpochMs: number | undefined
): string {
  if (originEpochMs != null) {
    const relative = formatElapsedEpochTime(epochMs, originEpochMs);
    if (relative !== undefined) return relative;
  }
  return new Date(epochMs).toLocaleTimeString();
}

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
    ? t("aiStepValue", card.aggregatedMeta.finalValue)
    : element.text
      ? t("aiStepText", element.text)
      : "";
  const elementSnippet = `<${tagWithClass}${textVal ? ` ${textVal}` : ""}>`;

  const lines = [
    t("aiStepTitle", [String(stepIndex), card.aggregatedMeta.title]),
    t("aiStepUrl", primary.page.url),
  ];

  if (element.framework?.targetComponent) {
    const fw = element.framework.targetComponent;
    const label = fw.framework === "vue" ? "Vue" : "React";
    lines.push(
      t("aiStepComponent", [label, fw.componentName, label, String(fw.version)])
    );
  }

  lines.push(t("aiStepTarget", elementSnippet));
  if (primaryLocator) {
    lines.push(t("aiStepLocator", primaryLocator));
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
    return groupInteractions(snapshot.included, t);
  }, [snapshot.included]);

  // 会话时间原点：与 NetworkTab / StreamTab / ConsoleTab 一致，行时间优先显示相对录制起点的耗时
  const originEpochMs = snapshot.startedAtEpochMs;

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
          ? t("allInteractionsDeleted")
          : t("noInteractions")}
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
            ? t("topLevelPage")
            : `Frame #${primary.page.frameId}`;
        const locators = element.locators || [];

        // 计算文本/输入展示内容
        const inputLength =
          card.aggregatedMeta.finalValueLength ??
          (card.aggregatedMeta.finalValue
            ? card.aggregatedMeta.finalValue.length
            : undefined);
        const textDisplay = card.aggregatedMeta.finalValue
          ? t("aiStepValue", card.aggregatedMeta.finalValue)
          : inputLength !== undefined
            ? t("inputCharsRedacted", String(inputLength))
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
                    title={t("inputCharsTitle", String(inputLength))}
                  >
                    {t("writeCharsShort", String(inputLength))}
                  </span>
                )}
                {card.aggregatedMeta.hasEnterSubmit && (
                  <span
                    className="badge badge-enter"
                    title={t("enterKeyTitle")}
                  >
                    Enter
                  </span>
                )}
                {card.children.length > 1 && (
                  <span
                    className="badge badge-count"
                    title={t("aggregatedEvents", String(card.children.length))}
                  >
                    {t("stepCountShort", String(card.children.length))}
                  </span>
                )}
                <span
                  className={`badge ${primary.screenshot.status === "unavailable" ? "partial" : ""}`}
                >
                  {primary.screenshot.source ?? primary.screenshot.status}
                </span>
                <button
                  className="item-copy-btn copy-step-btn"
                  title={t("copyStepText")}
                  onClick={(e) => {
                    e.stopPropagation();
                    const text = formatStepForAi(card, cardIndex + 1);
                    void copyTextToClipboard(text)
                      .then(() => {
                        onNotify?.(t("stepCopied", String(cardIndex + 1)));
                      })
                      .catch((err) => {
                        onNotify?.(t("copyStepFailed", String(err)));
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
                    title={t("deleteStep")}
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
              <span
                className="step-time"
                title={t(
                  "absoluteTime",
                  new Date(card.aggregatedMeta.startTime).toLocaleString()
                )}
              >
                {formatStepTime(card.aggregatedMeta.startTime, originEpochMs)}
              </span>
              {card.children.length > 1 && (
                <>
                  {" ~ "}
                  <span
                    className="step-time"
                    title={t(
                      "absoluteTime",
                      new Date(card.aggregatedMeta.endTime).toLocaleString()
                    )}
                  >
                    {formatStepTime(card.aggregatedMeta.endTime, originEpochMs)}
                  </span>
                </>
              )}
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
                  {isExpanded ? t("collapseDetails") : t("expandDetails")}
                </button>
              )}
            </div>

            {/* 当多步骤且展开时，渲染子时间线 */}
            {card.children.length > 1 && isExpanded && (
              <div className="sub-steps-container">
                <div className="sub-steps-header">{t("microEventsTitle")}</div>
                <div className="sub-steps-timeline">
                  {card.children.map((child, subIdx) => (
                    <div className="sub-step-item" key={child.id}>
                      <span className="sub-step-idx">{subIdx + 1}.</span>
                      <span className={`sub-step-kind kind-${child.kind}`}>
                        {child.kind}
                      </span>
                      <span className="sub-step-time">
                        <span
                          title={t(
                            "absoluteTime",
                            new Date(child.createdAt).toLocaleString()
                          )}
                        >
                          {formatStepTime(child.createdAt, originEpochMs)}
                        </span>
                      </span>

                      {child.kind === "input" && (
                        <span className="sub-step-detail highlight-input-detail">
                          {child.metadata?.value !== undefined
                            ? t("writeContent", child.metadata.value)
                            : child.metadata?.valueLength !== undefined
                              ? t(
                                  "writeRedacted",
                                  String(child.metadata.valueLength)
                                )
                              : t("writeText")}
                          {child.metadata?.inputEventCount &&
                          child.metadata.inputEventCount > 1
                            ? t(
                                "keystrokeCount",
                                String(child.metadata.inputEventCount)
                              )
                            : ""}
                        </span>
                      )}

                      {child.kind !== "input" &&
                        child.metadata?.value !== undefined && (
                          <span className="sub-step-detail">
                            {t("aiStepValue", child.metadata.value)}
                          </span>
                        )}

                      {child.metadata?.key && (
                        <span className="sub-step-detail">
                          {t("keyPressLabel", child.metadata.key)}
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
                    alt={t("stepScreenshotAlt")}
                    data-img-id={screenshotRecord.id}
                    title={t("clickToZoom")}
                  />
                </div>
              )}
              <div className="step-details-panel">
                <div className="step-section">
                  <div className="step-section-title">
                    {t("labelTargetElement")}
                  </div>
                  <table className="target-element-table">
                    <tbody>
                      <tr>
                        <td className="td-label">{t("labelTag")}</td>
                        <td className="td-value">
                          {element.tagName.toLowerCase()}
                        </td>
                      </tr>
                      <tr>
                        <td className="td-label">{t("labelClassName")}</td>
                        <td className="td-value" data-tooltip={classNames}>
                          {classNames}
                        </td>
                      </tr>
                      <tr>
                        <td className="td-label">{t("labelTextInput")}</td>
                        <td
                          className={`td-value ${inputLength !== undefined ? "highlight-value-text" : ""}`}
                          data-tooltip={textDisplay}
                        >
                          {textDisplay}
                        </td>
                      </tr>
                      <tr>
                        <td className="td-label">{t("labelRole")}</td>
                        <td className="td-value">{role}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className="step-section">
                  <div className="step-section-title">
                    {t("labelSectionContext")}
                  </div>
                  <table className="target-element-table">
                    <tbody>
                      <tr>
                        <td className="td-label">{t("labelSize")}</td>
                        <td className="td-value">{size}</td>
                      </tr>
                      <tr>
                        <td className="td-label">{t("labelCoordinates")}</td>
                        <td className="td-value">{coordinateText}</td>
                      </tr>
                      <tr>
                        <td className="td-label">{t("labelViewport")}</td>
                        <td className="td-value">{viewport}</td>
                      </tr>
                      <tr>
                        <td className="td-label">{t("labelFrame")}</td>
                        <td className="td-value">{frame}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                {locators.length > 0 && (
                  <div className="step-section">
                    <div className="step-section-title">
                      {t("labelLocatorCandidates")}
                    </div>
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
                              {t("locatorMeta", [
                                locator.kind,
                                locator.matchCount > 0
                                  ? String(locator.matchCount)
                                  : "?",
                                String(
                                  Math.round(locator.stabilityScore * 100)
                                ),
                              ])}
                            </span>
                            <button
                              className="copy-locator-btn"
                              type="button"
                              data-copy-locator={formatted}
                            >
                              {t("copyShort")}
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
