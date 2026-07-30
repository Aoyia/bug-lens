import type { ElementDescriptor, InteractionRecord } from "../shared/protocol";
import { escapeHtml } from "./rendering";

export type InteractionListSnapshot = {
  all: InteractionRecord[];
  included: InteractionRecord[];
  hasMedia: boolean;
  startedAtEpochMs?: number;
};

type InteractionListActions = {
  exclude?(interactionId: string): void;
  openImage(interactionId: string): void;
};

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

function renderInteraction(item: InteractionRecord, index: number, originalIndex: number, editable: boolean): string {
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
  const locators = element.locators.map((locator, locatorIndex) => {
    const formatted = formatPlaywrightLocator(locator, element);
    return `
      <li class="locator-item">
        <span class="locator-index">${locatorIndex + 1}.</span>
        <code class="locator-code">${escapeHtml(formatted)}</code>
        <span class="locator-meta">${escapeHtml(locator.kind)} · 匹配 ${locator.matchCount > 0 ? locator.matchCount : "?"} · 稳定性 ${Math.round(locator.stabilityScore * 100)}</span>
        <button class="copy-locator-btn" type="button" data-copy-locator="${escapeHtml(formatted)}">复制</button>
      </li>
    `;
  }).join("");

  return `
    <article class="item" data-index="${originalIndex}" data-step="${index + 1}">
      <div class="top">
        <strong data-tooltip="${escapeHtml(element.text || element.tagName)}">${escapeHtml(element.text || element.tagName)}</strong>
        <div class="item-actions">
          <span class="badge ${item.screenshot.status === "unavailable" ? "partial" : ""}">${item.screenshot.source ?? item.screenshot.status}</span>
          ${editable ? `<button class="item-delete-btn delete" data-delete="${escapeHtml(item.id)}" title="从预览和导出中删除此步骤">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.0" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
          </button>` : ""}
        </div>
      </div>
      <div class="text">${escapeHtml(item.page.url)} · ${new Date(item.createdAt).toLocaleTimeString()}</div>
      <div class="step-body-grid">
        ${item.screenshot.dataUrl ? `<div class="step-media"><img class="shot step-shot" src="${item.screenshot.dataUrl}" alt="点击截图" data-img-id="${escapeHtml(item.id)}" title="点击放大查看大图"></div>` : ""}
        <div class="step-details-panel">
          <div class="step-section">
            <div class="step-section-title">目标元素</div>
            <table class="target-element-table">
              <tr><td class="td-label">标签</td><td class="td-value">${escapeHtml(element.tagName.toLowerCase())}</td></tr>
              <tr><td class="td-label">类名</td><td class="td-value" data-tooltip="${escapeHtml(classNames)}">${escapeHtml(classNames)}</td></tr>
              <tr><td class="td-label">文本</td><td class="td-value" data-tooltip="${escapeHtml(element.text || "")}">${escapeHtml(element.text || "-")}</td></tr>
              <tr><td class="td-label">Role</td><td class="td-value">${escapeHtml(role)}</td></tr>
            </table>
          </div>
          <div class="step-section">
            <div class="step-section-title">点击上下文</div>
            <table class="target-element-table">
              <tr><td class="td-label">尺寸</td><td class="td-value">${escapeHtml(size)}</td></tr>
              <tr><td class="td-label">坐标</td><td class="td-value">${escapeHtml(coordinateText)}</td></tr>
              <tr><td class="td-label">视口</td><td class="td-value">${escapeHtml(viewport)}</td></tr>
              <tr><td class="td-label">Frame</td><td class="td-value">${escapeHtml(frame)}</td></tr>
            </table>
          </div>
          ${locators ? `<div class="step-section"><div class="step-section-title">定位器候选</div><ol class="locator-list">${locators}</ol></div>` : ""}
        </div>
      </div>
    </article>
  `;
}

export class InteractionListView {
  private readonly container: HTMLElement;
  private readonly video: HTMLVideoElement;

  constructor(root: Document, private readonly actions: InteractionListActions) {
    this.container = root.querySelector<HTMLElement>("#interactions")!;
    this.video = root.querySelector<HTMLVideoElement>("#video")!;
  }

  render(snapshot: InteractionListSnapshot): void {
    const editable = Boolean(this.actions.exclude);
    if (!snapshot.included.length) {
      this.container.innerHTML = `<div class="empty">${snapshot.all.length && editable ? "所有交互步骤均已删除，可从右上角恢复。" : "没有捕获到点击"}</div>`;
      return;
    }

    this.container.innerHTML = snapshot.included
      .map((item, index) => renderInteraction(item, index, snapshot.all.indexOf(item), editable))
      .join("");

    this.container.querySelectorAll<HTMLElement>("[data-index]").forEach((node) => node.addEventListener("click", (event) => {
      if ((event.target as HTMLElement).closest(".delete")) return;
      this.container.querySelectorAll<HTMLElement>("[data-index]").forEach((item) => item.classList.remove("active"));
      node.classList.add("active");
      const interaction = snapshot.all[Number(node.dataset.index)];
      if (!interaction) return;
      if ((event.target as HTMLElement).classList.contains("shot")) this.actions.openImage(interaction.id);
      if (snapshot.hasMedia && snapshot.startedAtEpochMs) {
        this.video.currentTime = Math.max(0, (interaction.createdAt - snapshot.startedAtEpochMs) / 1000);
      }
    }));

    this.container.querySelectorAll<HTMLButtonElement>("[data-delete]").forEach((button) => button.addEventListener("click", (event) => {
      event.stopPropagation();
      this.actions.exclude?.(button.dataset.delete!);
    }));
  }
}
