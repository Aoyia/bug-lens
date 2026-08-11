import type {
  AnnotationItem,
  RectBounds,
} from "../domain/screenshot-payload.ts";
import { t } from "../shared/i18n.ts";

/**
 * 截图 Overlay 的两个独立 UI 小组件：
 * - MagnifierRenderer：跟随光标的 3x 放大镜（含取色与元素标签）；
 * - InlineTextEditor：批注文本的浮动 textarea（自动换行/高度、Esc 还原、失焦提交）。
 * 两者均通过构造时注入的依赖与回调与主类解耦，不直接持有主类状态。
 */

export interface MagnifierRendererOptions {
  shadowRoot: ShadowRoot;
  /** 每次渲染时读取当前视口原图（可能尚未加载完成） */
  getViewportImage: () => HTMLImageElement | null;
  /** 返回 true 时隐藏放大镜（选区已确立且未在重新拉框/微拉伸时） */
  shouldHide: () => boolean;
}

export class MagnifierRenderer {
  private readonly shadowRoot: ShadowRoot;
  private readonly getViewportImage: () => HTMLImageElement | null;
  private readonly shouldHide: () => boolean;

  constructor(options: MagnifierRendererOptions) {
    this.shadowRoot = options.shadowRoot;
    this.getViewportImage = options.getViewportImage;
    this.shouldHide = options.shouldHide;
  }

  render(x: number, y: number): void {
    const magBox =
      this.shadowRoot.querySelector<HTMLDivElement>(".magnifier-box");
    const magCanvas =
      this.shadowRoot.querySelector<HTMLCanvasElement>(".magnifier-canvas");
    const magColor =
      this.shadowRoot.querySelector<HTMLDivElement>(".mag-color");
    const magPos = this.shadowRoot.querySelector<HTMLDivElement>(".mag-pos");
    const magTag = this.shadowRoot.querySelector<HTMLDivElement>(".mag-tag");

    if (!magBox || !magCanvas) return;

    // 当选区已经确立，且未在重新拉框/微拉伸手柄时，自动隐藏 Magnifier 放大镜！
    if (this.shouldHide()) {
      magBox.style.display = "none";
      return;
    }

    magBox.style.display = "flex";

    // 边界自适应翻转避让逻辑
    const magW = 130;
    const magH = 130;
    let posX = x + 15;
    let posY = y + 15;

    if (posX + magW > window.innerWidth) {
      posX = x - magW - 15;
    }
    if (posY + magH > window.innerHeight) {
      posY = y - magH - 15;
    }

    magBox.style.left = `${posX}px`;
    magBox.style.top = `${posY}px`;

    if (magPos) magPos.textContent = `X: ${Math.round(x)}, Y: ${Math.round(y)}`;

    const el = document.elementFromPoint(x, y);
    if (magTag && el) {
      const tag = el.tagName.toLowerCase();
      const idStr = el.id ? `#${el.id}` : "";
      magTag.textContent = `${tag}${idStr}`.slice(0, 18);
    }

    const ctx = magCanvas.getContext("2d");
    const viewportImage = this.getViewportImage();
    if (ctx && viewportImage) {
      ctx.imageSmoothingEnabled = false;
      const dpr = window.devicePixelRatio || 1;
      const srcW = 40;
      const srcH = 30;

      ctx.drawImage(
        viewportImage,
        (x - srcW / 2) * dpr,
        (y - srcH / 2) * dpr,
        srcW * dpr,
        srcH * dpr,
        0,
        0,
        magCanvas.width,
        magCanvas.height
      );

      // 十字准星 Crosshair
      const cx = magCanvas.width / 2;
      const cy = magCanvas.height / 2;
      ctx.strokeStyle = "#FA5252";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx - 8, cy);
      ctx.lineTo(cx + 8, cy);
      ctx.moveTo(cx, cy - 8);
      ctx.lineTo(cx, cy + 8);
      ctx.stroke();

      try {
        const pixel = ctx.getImageData(cx, cy, 1, 1).data;
        const hex = `#${((1 << 24) + (pixel[0] << 16) + (pixel[1] << 8) + pixel[2]).toString(16).slice(1).toUpperCase()}`;
        if (magColor) magColor.textContent = hex;
      } catch {
        // 兜底
      }
    }
  }
}

export interface InlineTextEditorOptions {
  wrapper: HTMLDivElement;
  getSelection: () => RectBounds | null;
  /** 提交文本批注（text 非空时） */
  commitAnnotation: (ann: AnnotationItem) => void;
  /** Esc 取消时还原原有文本批注 */
  cancelAnnotation: (ann: AnnotationItem) => void;
  /** 仅重绘 Canvas（清空确认场景） */
  rerender: () => void;
}

export class InlineTextEditor {
  private readonly wrapper: HTMLDivElement;
  private readonly getSelection: () => RectBounds | null;
  private readonly commitAnnotation: (ann: AnnotationItem) => void;
  private readonly cancelAnnotation: (ann: AnnotationItem) => void;
  private readonly rerender: () => void;

  constructor(options: InlineTextEditorOptions) {
    this.wrapper = options.wrapper;
    this.getSelection = options.getSelection;
    this.commitAnnotation = options.commitAnnotation;
    this.cancelAnnotation = options.cancelAnnotation;
    this.rerender = options.rerender;
  }

  spawn(x: number, y: number, initialText?: string): void {
    const wrapper = this.wrapper;

    const existing = wrapper.querySelector(".inline-text-input");
    if (existing) existing.remove();

    const selection = this.getSelection();

    // 边界 Clamp 矫正：防止靠边缘产生抖动与超出选区/屏幕
    const boundsRight = selection
      ? selection.x + selection.width
      : window.innerWidth;
    const boundsBottom = selection
      ? selection.y + selection.height
      : window.innerHeight;

    const availableWidth = Math.max(120, boundsRight - x - 10);
    const availableHeight = Math.max(40, boundsBottom - y - 10);
    const maxWidth = Math.min(320, availableWidth);

    // 位置语义诚实：点击位置即气泡锚点（不再"靠右左跳"改写 position）。
    // 靠近右边界时气泡由渲染层按 maxWidth 压缩自适应，数据不漂移。
    const input = document.createElement("textarea");
    input.rows = 1;
    input.className = "inline-text-input";
    input.placeholder = t("shotTextPlaceholder");
    input.style.cssText = `
      position: absolute;
      left: ${x}px;
      top: ${y}px;
      max-width: ${maxWidth}px;
      max-height: ${availableHeight}px;
      min-width: 120px;
      background: transparent;
      color: #ff3b30;
      border: 1.5px dashed #007aff;
      border-radius: 4px;
      padding: 4px 6px;
      font-size: 14px;
      font-weight: 700;
      line-height: 1.4;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      text-shadow: 0 1px 3px rgba(0, 0, 0, 0.7);
      outline: none;
      z-index: 100;
      resize: none;
      overflow: hidden;
      white-space: pre-wrap;
      word-break: break-word;
      box-sizing: border-box;
    `;

    if (initialText) {
      input.value = initialText;
    }

    // 监听输入自动调整高度
    const autoResize = () => {
      input.style.height = "auto";
      input.style.height = `${Math.min(input.scrollHeight, availableHeight)}px`;
    };
    input.addEventListener("input", autoResize);

    let isHandled = false;
    const commitText = () => {
      if (isHandled) return;
      isHandled = true;
      const text = input.value.trim();
      if (text) {
        this.commitAnnotation({
          id: `ann_${Date.now()}`,
          type: "text",
          position: { x, y },
          text,
        });
      } else if (initialText) {
        // 如果原本有字但清空确认了，则重新绘制 Canvas 清除原文字
        this.rerender();
      }
      input.remove();
    };

    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (isHandled) return;
        isHandled = true;
        if (initialText) {
          // 按 Escape 取消时，还原原本的文字批注
          this.cancelAnnotation({
            id: `ann_${Date.now()}`,
            type: "text",
            position: { x, y },
            text: initialText,
          });
        }
        input.remove();
      }
    });

    input.addEventListener("blur", () => {
      commitText();
    });

    wrapper.appendChild(input);
    setTimeout(() => {
      input.focus();
      if (input.value) {
        input.setSelectionRange(input.value.length, input.value.length);
      }
      autoResize();
    }, 20);
  }
}
