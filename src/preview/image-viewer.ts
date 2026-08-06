import type { InteractionRecord } from "../shared/protocol";
import type { IssueScenePreview } from "./issue-scene-view";

type ViewerImageItem = {
  id: string;
  title: string;
  downloadName: string;
  dataUrl: string;
};

function dataUrlToBlob(dataUrl: string): Blob {
  const [metadata, encoded = ""] = dataUrl.split(",", 2);
  const mimeType = metadata.match(/^data:([^;,]+)/)?.[1] || "image/png";
  if (metadata.includes(";base64")) {
    const binary = atob(encoded);
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0)
    );
    return new Blob([bytes], { type: mimeType });
  }
  return new Blob([decodeURIComponent(encoded)], { type: mimeType });
}

export class ImageViewer {
  private readonly root: Document;
  private readonly notify: (message: string) => void;
  private items: ViewerImageItem[] = [];
  private currentIndex = 0;
  private scale = 1;
  private translateX = 0;
  private translateY = 0;
  private rotation = 0;
  private isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;

  constructor(root: Document, notify: (message: string) => void) {
    this.root = root;
    this.notify = notify;
    this.bindEvents();
  }

  open(interactions: InteractionRecord[], interactionId: string): void {
    const items: ViewerImageItem[] = interactions.flatMap(
      (interaction, stepIndex) => {
        const dataUrl = interaction.screenshot.dataUrl;
        if (!dataUrl) return [];
        return [
          {
            id: interaction.id,
            title: `步骤 ${stepIndex + 1}. ${interaction.element.text || interaction.element.tagName}`,
            downloadName: `step-${stepIndex + 1}-screenshot.png`,
            dataUrl,
          },
        ];
      }
    );
    this.openItems(items, interactionId);
  }

  openScenes(
    scenes: IssueScenePreview[],
    sceneId: string,
    mode: "original" | "annotated" = "annotated"
  ): void {
    const items: ViewerImageItem[] = [];
    let selectedId: string | undefined;
    for (const [sceneIndex, item] of scenes.entries()) {
      const scene = item.scene;
      const candidates: Array<{
        mode: "original" | "annotated";
        url?: string;
      }> = [
        { mode: "annotated", url: item.annotatedSource },
        { mode: "original", url: item.originalSource },
      ];
      let sceneFirstId: string | undefined;
      for (const candidate of candidates) {
        if (!candidate.url) continue;
        const id = `${scene.id}:${candidate.mode}`;
        items.push({
          id,
          title: `问题现场 ${sceneIndex + 1} · ${new Date(scene.observedAtEpochMs).toLocaleTimeString()}（${candidate.mode === "annotated" ? "批注图" : "原图"}）`,
          downloadName: `issue-scene-${sceneIndex + 1}-${candidate.mode}.png`,
          dataUrl: candidate.url,
        });
        if (!sceneFirstId) sceneFirstId = id;
        if (scene.id === sceneId && candidate.mode === mode) selectedId = id;
      }
      if (scene.id === sceneId && !selectedId && sceneFirstId) {
        selectedId = sceneFirstId;
      }
    }
    this.openItems(items, selectedId);
  }

  private openItems(items: ViewerImageItem[], selectedId?: string): void {
    this.items = items;
    const selectedIndex = selectedId
      ? this.items.findIndex((item) => item.id === selectedId)
      : -1;
    this.currentIndex = selectedIndex < 0 ? 0 : selectedIndex;
    if (!this.items.length) return;
    this.updateView();
    this.element("#image-modal").hidden = false;
  }

  private element<T extends HTMLElement = HTMLElement>(selector: string): T {
    return this.root.querySelector<T>(selector)!;
  }

  private resetTransform(): void {
    this.scale = 1;
    this.translateX = 0;
    this.translateY = 0;
    this.rotation = 0;
    this.applyTransform();
  }

  private applyTransform(): void {
    this.element("#modal-img-container").style.transform =
      `translate(${this.translateX}px, ${this.translateY}px) scale(${this.scale}) rotate(${this.rotation}deg)`;
    this.element("#modal-zoom-ratio").textContent =
      `${Math.round(this.scale * 100)}%`;
  }

  private zoom(factor: number): void {
    this.scale = Number(
      Math.min(Math.max(0.25, this.scale * factor), 5).toFixed(2)
    );
    this.applyTransform();
  }

  private rotate(): void {
    this.rotation = (this.rotation + 90) % 360;
    this.applyTransform();
  }

  private updateView(): void {
    const current = this.items[this.currentIndex];
    if (!current) return;
    this.element<HTMLImageElement>("#modal-image").src = current.dataUrl;
    this.element("#modal-step-title").textContent = current.title;
    this.element("#modal-step-counter").textContent =
      `${this.currentIndex + 1} / ${this.items.length}`;
    this.element<HTMLButtonElement>("#modal-prev-btn").disabled =
      this.currentIndex === 0;
    this.element<HTMLButtonElement>("#modal-next-btn").disabled =
      this.currentIndex === this.items.length - 1;
    const copyText = this.root.querySelector<HTMLElement>("#modal-copy-text");
    if (copyText) copyText.textContent = "复制";
    this.element("#modal-copy-btn").classList.remove("copied");
    this.resetTransform();
  }

  private close(): void {
    this.element("#image-modal").hidden = true;
    this.resetTransform();
  }

  private previous(): void {
    if (this.currentIndex > 0) {
      this.currentIndex -= 1;
      this.updateView();
    }
  }

  private next(): void {
    if (this.currentIndex < this.items.length - 1) {
      this.currentIndex += 1;
      this.updateView();
    }
  }

  private async copyCurrent(): Promise<void> {
    const dataUrl = this.items[this.currentIndex]?.dataUrl;
    if (!dataUrl) return;
    try {
      const blob = dataUrlToBlob(dataUrl);
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type || "image/png"]: blob }),
      ]);
      const copyText = this.root.querySelector<HTMLElement>("#modal-copy-text");
      if (copyText) copyText.textContent = "已复制 ✓";
      this.element("#modal-copy-btn").classList.add("copied");
      this.notify("已成功复制图片到剪贴板");
    } catch (error) {
      this.notify(`复制失败：${String(error)}`);
    }
  }

  private downloadCurrent(): void {
    const current = this.items[this.currentIndex];
    const dataUrl = current?.dataUrl;
    if (!dataUrl) return;
    const link = this.root.createElement("a");
    link.href = dataUrl;
    link.download = current.downloadName;
    this.root.body.appendChild(link);
    link.click();
    link.remove();
    this.notify("已开始下载图片截图");
  }

  private bindEvents(): void {
    const modal = this.element("#image-modal");
    const stage = this.element("#modal-stage");
    const image = this.element("#modal-image");

    this.element("#modal-close-btn").addEventListener("click", () =>
      this.close()
    );
    stage.addEventListener("click", (event) => {
      if (
        event.target === stage ||
        event.target === this.element("#modal-img-container")
      )
        this.close();
    });
    this.element("#modal-prev-btn").addEventListener("click", (event) => {
      event.stopPropagation();
      this.previous();
    });
    this.element("#modal-next-btn").addEventListener("click", (event) => {
      event.stopPropagation();
      this.next();
    });
    this.element("#modal-copy-btn").addEventListener("click", (event) => {
      event.stopPropagation();
      void this.copyCurrent();
    });
    this.element("#modal-download-btn").addEventListener("click", (event) => {
      event.stopPropagation();
      this.downloadCurrent();
    });
    this.element("#modal-zoom-in-btn").addEventListener("click", (event) => {
      event.stopPropagation();
      this.zoom(1.25);
    });
    this.element("#modal-zoom-out-btn").addEventListener("click", (event) => {
      event.stopPropagation();
      this.zoom(0.8);
    });
    this.element("#modal-reset-btn").addEventListener("click", (event) => {
      event.stopPropagation();
      if (
        this.scale !== 1 ||
        this.translateX ||
        this.translateY ||
        this.rotation
      )
        this.resetTransform();
      else this.zoom(2);
    });
    this.element("#modal-rotate-btn").addEventListener("click", (event) => {
      event.stopPropagation();
      this.rotate();
    });

    stage.addEventListener("mousedown", (event) => {
      if (
        (event.target as HTMLElement).closest(
          ".arco-preview-nav-btn, .arco-preview-toolbar"
        )
      )
        return;
      this.isDragging = true;
      this.dragStartX = event.clientX - this.translateX;
      this.dragStartY = event.clientY - this.translateY;
      stage.classList.add("is-dragging");
    });
    window.addEventListener("mousemove", (event) => {
      if (!this.isDragging) return;
      this.translateX = event.clientX - this.dragStartX;
      this.translateY = event.clientY - this.dragStartY;
      this.applyTransform();
    });
    window.addEventListener("mouseup", () => {
      if (!this.isDragging) return;
      this.isDragging = false;
      stage.classList.remove("is-dragging");
    });
    stage.addEventListener(
      "wheel",
      (event) => {
        if (modal.hidden) return;
        event.preventDefault();
        this.zoom(event.deltaY < 0 ? 1.15 : 0.85);
      },
      { passive: false }
    );
    image.addEventListener("dblclick", (event) => {
      event.stopPropagation();
      if (this.scale === 1) this.scale = 2;
      else {
        this.scale = 1;
        this.translateX = 0;
        this.translateY = 0;
      }
      this.applyTransform();
    });
    window.addEventListener("keydown", (event) => {
      if (modal.hidden) return;
      if (event.key === "Escape") this.close();
      else if (["ArrowLeft", "a", "A"].includes(event.key)) this.previous();
      else if (["ArrowRight", "d", "D"].includes(event.key)) this.next();
      else if (["+", "="].includes(event.key)) this.zoom(1.25);
      else if (["-", "_"].includes(event.key)) this.zoom(0.8);
      else if (["r", "R"].includes(event.key)) this.rotate();
      else if (event.key === "0") this.resetTransform();
    });
  }
}
