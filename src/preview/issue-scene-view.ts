import type { IssueScene } from "../shared/protocol.ts";
import { escapeHtml } from "./rendering.ts";

export type IssueScenePreview = {
  scene: IssueScene;
  originalSource?: string;
  annotatedSource?: string;
};

export type IssueSceneCollection = { all: IssueScenePreview[]; included: IssueScenePreview[] };

export class IssueSceneView {
  private readonly root: HTMLElement;
  private readonly video: HTMLVideoElement;

  constructor(documentRoot: Document, private readonly actions: { exclude?(id: string): Promise<void> | void; notify?(message: string): void }) {
    this.root = documentRoot.querySelector<HTMLElement>("#issue-scenes")!;
    this.video = documentRoot.querySelector<HTMLVideoElement>("#video")!;
  }

  render(collection: IssueSceneCollection, startedAtEpochMs?: number, editable = false): void {
    if (!collection.included.length) {
      this.root.innerHTML = collection.all.length && editable
        ? `<div class="issue-scenes-empty">所有问题现场均已排除，可恢复查看。</div>`
        : `<div class="issue-scenes-empty">尚未标记问题现场。</div>`;
      return;
    }
    this.root.innerHTML = collection.included.map((item) => this.renderScene(item, startedAtEpochMs, editable)).join("");
    this.root.querySelectorAll<HTMLButtonElement>("[data-issue-exclude]").forEach((button) => button.addEventListener("click", (event) => {
      event.stopPropagation();
      void this.actions.exclude?.(button.dataset.issueExclude!);
    }));
    this.root.querySelectorAll<HTMLButtonElement>("[data-issue-toggle-image]").forEach((button) => button.addEventListener("click", () => {
      const card = button.closest<HTMLElement>("[data-issue-scene-id]");
      const image = card?.querySelector<HTMLImageElement>("[data-issue-image]");
      const original = button.dataset.originalSource;
      const annotated = button.dataset.annotatedSource;
      if (!image || !original || !annotated) return;
      const showingOriginal = button.dataset.mode === "original";
      image.src = showingOriginal ? annotated : original;
      button.dataset.mode = showingOriginal ? "annotated" : "original";
      button.textContent = showingOriginal ? "查看原图" : "查看批注图";
    }));
    this.root.querySelectorAll<HTMLButtonElement>("[data-issue-diagnostic-tab]").forEach((button) => button.addEventListener("click", () => {
      const tabName = button.dataset.issueDiagnosticTab;
      if (!tabName) return;
      const tab = this.root.querySelector<HTMLButtonElement>(`[data-tab="${tabName}"]`);
      tab?.click();
      tab?.scrollIntoView({ behavior: "smooth", block: "center" });
    }));
    this.root.querySelectorAll<HTMLButtonElement>("[data-issue-jump]").forEach((button) => button.addEventListener("click", () => {
      const timestamp = Number(button.dataset.issueObservedAt);
      if (!Number.isFinite(timestamp) || startedAtEpochMs == null) return;
      this.video.currentTime = Math.max(0, (timestamp - startedAtEpochMs) / 1000);
      this.video.play().catch(() => undefined);
    }));
  }

  private renderScene(item: IssueScenePreview, startedAtEpochMs: number | undefined, editable: boolean): string {
    const scene = item.scene;
    const image = item.annotatedSource || item.originalSource;
    const imageToggle = item.annotatedSource && item.originalSource
      ? `<button class="ghost" data-issue-toggle-image data-mode="annotated" data-original-source="${escapeHtml(item.originalSource)}" data-annotated-source="${escapeHtml(item.annotatedSource)}">查看原图</button>`
      : "";
    const description = scene.narrative;
    const status = scene.status === "complete" ? "完成" : scene.status === "partial" ? "部分完成" : scene.status === "failed" ? "失败" : "草稿";
    const dom = scene.target.sanitizedHtml || `<${scene.target.element.tagName}>`;

    const locators = scene.target.element.locators || [];
    const bestLocator = locators[0];
    const locatorsMarkup = bestLocator
      ? `<div style="display:flex;align-items:center;gap:6px;font-size:11px;background:#f2f3f5;padding:3px 8px;border-radius:2px;margin-top:4px">
          <span style="font-weight:700;font-size:10px;background:#e8f3ff;color:#165dff;padding:1px 4px;border-radius:2px;white-space:nowrap">${escapeHtml(bestLocator.kind)}</span>
          <code style="font-family:SFMono-Regular,Consolas,monospace;color:#1d2129;font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(bestLocator.expression)}">${escapeHtml(bestLocator.expression)}</code>
          <span style="color:#86909c;font-size:10px;white-space:nowrap">匹配: ${bestLocator.matchCount} | 稳定: ${bestLocator.stabilityScore}</span>
        </div>`
      : "";

    const ancestors = scene.target.ancestors || [];
    const ancestorItems = ancestors.slice().reverse().map((anc) => {
      const idStr = anc.id ? `#${anc.id}` : "";
      const clsStr = anc.classNames?.slice(0, 2).map((c) => `.${c}`).join("") || "";
      return `${anc.tagName}${idStr}${clsStr}`;
    });
    const elId = scene.target.element.id ? `#${scene.target.element.id}` : "";
    const elCls = scene.target.element.classNames?.slice(0, 2).map((c) => `.${c}`).join("") || "";
    ancestorItems.push(`${scene.target.element.tagName}${elId}${elCls}`);

    const domPathMarkup = ancestorItems.length
      ? `<div style="margin-top:4px;font-size:11px;color:#4e5969;overflow-x:auto;white-space:nowrap">
          <span style="font-weight:600;color:#86909c;margin-right:4px">路径:</span> ${ancestorItems.map((item, idx) => idx === ancestorItems.length - 1 ? `<strong style="color:#ef233c;font-weight:600">${escapeHtml(item)}</strong>` : `<span>${escapeHtml(item)}</span>`).join(" <span style='color:#c9cdd4'>&gt;</span> ")}
        </div>`
      : "";

    return `<article class="issue-scene-card" data-issue-scene-id="${escapeHtml(scene.id)}">
      <div class="issue-scene-card-header"><div><span class="issue-scene-kicker">问题现场</span><strong>${escapeHtml(new Date(scene.observedAtEpochMs).toLocaleTimeString())}</strong><span class="issue-scene-status ${escapeHtml(scene.status)}">${status}</span></div><div class="issue-scene-actions">${imageToggle}${startedAtEpochMs != null ? `<button class="ghost" data-issue-jump data-issue-observed-at="${scene.observedAtEpochMs}">跳转录像</button>` : ""}${editable ? `<button class="item-delete-btn delete" data-issue-exclude="${escapeHtml(scene.id)}" title="从预览和导出中排除">排除</button>` : ""}</div></div>
      <div class="issue-scene-grid">
        <div class="issue-scene-image-wrap">${image ? `<img data-issue-image class="issue-scene-image" src="${escapeHtml(image)}" alt="问题现场批注截图">` : `<div class="issue-scene-image-missing">截图不可用</div>`}</div>
        <div class="issue-scene-details">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;padding-bottom:8px;border-bottom:1px solid #f2f3f5">
            <div>
              <span style="font-size:11px;font-weight:600;color:#86909c">实际表现</span>
              <p style="margin:2px 0 0;font-size:13px;font-weight:500;color:#1d2129">${escapeHtml(description?.actual || "未填写")}</p>
            </div>
            <div>
              <span style="font-size:11px;font-weight:600;color:#86909c">预期表现</span>
              <p style="margin:2px 0 0;font-size:13px;color:#4e5969">${escapeHtml(description?.expected || "未填写")}</p>
            </div>
          </div>
          ${description?.note ? `<div style="padding-bottom:8px;border-bottom:1px solid #f2f3f5"><span style="font-size:11px;font-weight:600;color:#86909c">补充说明</span><p style="margin:2px 0 0;font-size:12px;color:#4e5969">${escapeHtml(description.note)}</p></div>` : ""}
          <div style="display:flex;flex-direction:column;gap:4px">
            <div style="display:flex;align-items:center;justify-content:space-between">
              <span style="font-size:11px;font-weight:600;color:#86909c">目标元素</span>
              <span class="issue-scene-target-meta">${escapeHtml(scene.target.element.tagName)}${scene.target.element.role ? ` · ${escapeHtml(scene.target.element.role)}` : ""} (${Math.round(scene.target.element.boundingBox.width)}×${Math.round(scene.target.element.boundingBox.height)}px)</span>
            </div>
            ${locatorsMarkup}
            ${domPathMarkup}
            <pre style="margin-top:4px">${escapeHtml(dom)}</pre>
          </div>
        </div>
      </div>
    </article>`;
  }
}
