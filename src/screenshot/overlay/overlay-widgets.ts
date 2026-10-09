import type {
  AnnotationItem,
  RectBounds,
} from "../../domain/screenshot-payload";
import {
  computeTextLayout,
  estimateTextWidth,
  getTextHaloColor,
  TEXT_ANNOTATION_FONT_FAMILY,
  TEXT_ANNOTATION_FONT_SIZE,
  TEXT_ANNOTATION_FONT_WEIGHT,
  TEXT_DEFAULT_COLOR,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_WIDTH,
} from "../annotations/text-layout";
import { t } from "../../shared/i18n";

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
  /** 输入框关闭且未产出有效批注时触发（空文本 / 清空原有文字），由组合根恢复状态机 */
  onClose: () => void;
  /** 仅重绘 Canvas（清空确认场景） */
  rerender: () => void;
}

export class InlineTextEditor {
  private readonly wrapper: HTMLDivElement;
  private readonly getSelection: () => RectBounds | null;
  private readonly commitAnnotation: (ann: AnnotationItem) => void;
  private readonly cancelAnnotation: (ann: AnnotationItem) => void;
  private readonly onClose: () => void;
  private readonly rerender: () => void;

  /** 当前活动文本输入上下文（供 cancelEdit 复用 Esc 语义，保证关闭必恢复状态机） */
  private activeInput: HTMLElement | null = null;
  private activeInitialText = "";
  private activeColor: string | undefined = undefined;
  private activePosition = { x: 0, y: 0 };
  private activeIsHandled = false;

  constructor(options: InlineTextEditorOptions) {
    this.wrapper = options.wrapper;
    this.getSelection = options.getSelection;
    this.commitAnnotation = options.commitAnnotation;
    this.cancelAnnotation = options.cancelAnnotation;
    this.onClose = options.onClose;
    this.rerender = options.rerender;
  }

  spawn(x: number, y: number, initialText?: string, color?: string): void {
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

    const placeholder = t("shotTextPlaceholder");
    const placeholderWidth = estimateTextWidth(placeholder);
    // 最小安全可用宽度：至少容纳占位符单行 + 缓冲
    const minSafeWidth = Math.max(80, placeholderWidth + 8);

    // 靠右边缘避让：若右侧空间不足容纳占位符，向左安全平移
    let spawnX = x;
    if (selection) {
      if (boundsRight - spawnX < minSafeWidth) {
        spawnX = Math.max(selection.x + 4, boundsRight - minSafeWidth);
      }
    } else {
      if (boundsRight - spawnX < minSafeWidth) {
        spawnX = Math.max(4, boundsRight - minSafeWidth);
      }
    }

    const maxWidth = Math.max(
      minSafeWidth,
      Math.min(TEXT_MAX_WIDTH, boundsRight - spawnX - 8)
    );

    // 方案二：原生态流式排版节点（contenteditable div）
    // 彻底摒弃 textarea 替换元素的滚动容器特性，由原生流式排版自然撑开宽度与高度，
    // 物理消除垂直滚动条与第一行被卷上去的断层缺陷。
    const input = document.createElement("div");
    input.className = "inline-text-input";
    input.contentEditable = "true";
    input.setAttribute?.("role", "textbox");
    input.setAttribute?.("aria-multiline", "true");
    input.setAttribute?.("data-placeholder", placeholder);
    input.setAttribute?.("spellcheck", "false");

    // 兼容现有测试与外部属性读取的 value 访问器
    Object.defineProperty(input, "value", {
      get() {
        return (
          this.innerText !== undefined ? this.innerText : this.textContent || ""
        ).replace(/\r\n/g, "\n");
      },
      set(v: string) {
        this.textContent = v;
      },
      configurable: true,
    });

    const textColor = color || TEXT_DEFAULT_COLOR;
    const haloColor = getTextHaloColor(textColor);

    // 视觉参数：无实心背景框，文字双通道外光晕预览，光标处直接即字模
    input.style.cssText = `
      position: absolute;
      left: ${spawnX}px;
      top: ${y}px;
      display: inline-block;
      max-width: ${maxWidth}px;
      min-width: 24px;
      background: transparent;
      color: ${textColor};
      border: none;
      outline: 1px dashed rgba(2, 132, 199, 0.65);
      outline-offset: 2px;
      border-radius: 2px;
      padding: 0;
      margin: 0;
      font-size: ${TEXT_ANNOTATION_FONT_SIZE}px;
      font-weight: ${TEXT_ANNOTATION_FONT_WEIGHT};
      line-height: ${TEXT_LINE_HEIGHT}px;
      font-family: ${TEXT_ANNOTATION_FONT_FAMILY};
      text-shadow: 0 0 3px ${haloColor}, 0 0 1px ${haloColor};
      z-index: 100;
      white-space: pre-wrap;
      word-break: break-word;
      box-sizing: content-box;
      overflow: visible;
      cursor: text;
      user-select: text;
    `;

    // 幂等注入占位符配色：利用 :empty 伪类实现原生占位符，不占真实 DOM 文本节点
    if (!(wrapper as any).__inlineTextStyleInjected) {
      const style = document.createElement("style");
      style.id = "inline-text-input-style";
      style.textContent = `
        .inline-text-input:empty::before,
        .inline-text-input::placeholder {
          content: attr(data-placeholder);
          color: rgba(100, 116, 139, 0.75);
          text-shadow: 0 1px 2px rgba(255, 255, 255, 0.9);
          font-weight: 500;
          pointer-events: none;
        }
      `;
      wrapper.appendChild(style);
      (wrapper as any).__inlineTextStyleInjected = true;
    }

    if (initialText) {
      input.textContent = initialText;
    }

    // 保存当前活动编辑上下文（供 cancelEdit 复用 Esc 语义）
    this.activeInput = input;
    this.activeInitialText = initialText || "";
    this.activeColor = color;
    this.activePosition = { x: spawnX, y };
    this.activeIsHandled = false;

    // 清洗粘贴内容：拦截富文本，确保只插入无格式纯文本
    input.addEventListener("paste", (e) => {
      e.preventDefault();
      const text = e.clipboardData?.getData("text/plain") || "";
      if (typeof document.execCommand === "function") {
        document.execCommand("insertText", false, text);
      } else {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
          const range = sel.getRangeAt(0);
          range.deleteContents();
          range.insertNode(document.createTextNode(text));
          range.collapse(false);
        }
      }
    });

    // 保持 input 监听器以备测试与外部事件监听
    input.addEventListener("input", () => {});

    const commitText = () => {
      if (this.activeIsHandled) return;
      this.activeIsHandled = true;
      const rawText =
        input.innerText !== undefined
          ? input.innerText
          : input.textContent || "";
      const text = rawText.trim();
      if (text) {
        this.commitAnnotation({
          id: `ann_${Date.now()}`,
          type: "text",
          position: { x: this.activePosition.x, y: this.activePosition.y },
          text,
          color: this.activeColor,
        });
      } else if (this.activeInitialText) {
        // 原本有字但清空确认了：重绘 Canvas 清除原文字，并通知组合根恢复状态机
        this.rerender();
        this.onClose();
      } else {
        // 新建文本但未输入内容：直接关闭，通知组合根恢复状态机
        this.onClose();
      }
      this.activeInput = null;
      input.remove();
    };

    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        // 统一的 Esc 取消语义（含还原原文 / 恢复状态机）
        this.cancelEdit();
      }
    });

    input.addEventListener("blur", () => {
      commitText();
    });

    wrapper.appendChild(input);
    setTimeout(() => {
      input.focus();
      if (input.textContent) {
        try {
          const sel = window.getSelection();
          if (sel) {
            const range = document.createRange();
            range.selectNodeContents(input);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
          }
        } catch {
          // 测试 stub 环境容错
        }
      }
    }, 20);
  }

  /**
   * 取消当前文本编辑（Esc 语义）：二次编辑还原原文，新建空输入直接关闭；
   * 无论哪种情况都通过 cancelAnnotation / onClose 通知组合根恢复状态机。
   * 由输入框自身 keydown 与组合根（编辑态 Esc、切换工具）调用。
   */
  cancelEdit(): void {
    const input = this.activeInput;
    if (!input || this.activeIsHandled) return;
    this.activeIsHandled = true;
    if (this.activeInitialText) {
      // 按 Escape 取消时，还原原本的文字批注
      this.cancelAnnotation({
        id: `ann_${Date.now()}`,
        type: "text",
        position: { x: this.activePosition.x, y: this.activePosition.y },
        text: this.activeInitialText,
        color: this.activeColor,
      });
    } else {
      this.onClose();
    }
    this.activeInput = null;
    input.remove();
  }
}
