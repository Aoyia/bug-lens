import { t } from "../shared/i18n.ts";
import {
  ANNOTATION_TOOLBAR_CSS,
  ANNOTATION_TOOLBAR_ICONS,
} from "../shared/ui/annotation-toolbar.ts";

/**
 * 截图 Overlay 的 Shadow DOM 静态 UI 模板（CSS + HTML + SVG 图标）。
 * 与 ScreenshotOverlay 类解耦：无状态、无副作用，仅依赖 i18n 文案。
 */
export function createOverlayMarkup(): string {
  return `
      <style>
        .overlay-wrapper {
          position: absolute;
          inset: 0;
          background: transparent;
          overflow: hidden;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }
        .selection-box {
          position: absolute;
          border: 2px solid #007aff;
          cursor: crosshair;
          pointer-events: auto;
        }
        /* 8点 Resize 手柄 */
        .handle {
          position: absolute;
          width: 8px;
          height: 8px;
          background: #ffffff;
          border: 1.5px solid #007aff;
          border-radius: 50%;
          box-sizing: border-box;
          z-index: 12;
        }
        .handle.nw { top: -4px; left: -4px; cursor: nwse-resize; }
        .handle.n  { top: -4px; left: calc(50% - 4px); cursor: ns-resize; }
        .handle.ne { top: -4px; right: -4px; cursor: nesw-resize; }
        .handle.e  { top: calc(50% - 4px); right: -4px; cursor: ew-resize; }
        .handle.se { bottom: -4px; right: -4px; cursor: nwse-resize; }
        .handle.s  { bottom: -4px; left: calc(50% - 4px); cursor: ns-resize; }
        .handle.sw { bottom: -4px; left: -4px; cursor: nesw-resize; }
        .handle.w  { top: calc(50% - 4px); left: -4px; cursor: ew-resize; }

        /* 即时 Toast 提示 */
        .toast-box {
          position: fixed;
          top: 40%;
          left: 50%;
          transform: translate(-50%, -50%);
          background: rgba(15, 23, 42, 0.92);
          color: #38bdf8;
          border: 1px solid #0284c7;
          padding: 12px 24px;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 600;
          box-shadow: 0 20px 30px rgba(0,0,0,0.5);
          pointer-events: none;
          z-index: 9999;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .snap-box {
          position: absolute;
          border: 2px dashed #10b981;
          background: rgba(16, 185, 129, 0.1);
          pointer-events: none;
          transition: all 0.08s ease;
          z-index: 5;
        }
        .magnifier-box {
          position: absolute;
          width: 130px;
          background: #0f172a;
          border: 2px solid #38bdf8;
          border-radius: 8px;
          box-shadow: 0 10px 25px rgba(0,0,0,0.5);
          pointer-events: none;
          overflow: hidden;
          z-index: 20;
          display: flex;
          flex-direction: column;
          align-items: center;
        }
        .magnifier-canvas {
          width: 130px;
          height: 100px;
          background: #000;
        }
        .magnifier-info {
          width: 100%;
          background: #1e293b;
          color: #f8fafc;
          font-size: 11px;
          padding: 4px 6px;
          box-sizing: border-box;
          text-align: center;
          line-height: 1.4;
          font-family: monospace;
        }
        .size-badge {
          position: absolute;
          top: -26px;
          left: 0;
          background: rgba(35, 35, 35, 0.95);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          border: 1px solid rgba(255, 255, 255, 0.08);
          color: #ffffff;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          font-size: 11px;
          font-weight: 500;
          padding: 2px 6px;
          border-radius: 3px;
          white-space: nowrap;
          pointer-events: none;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
          transition: all 0.1s ease;
        }
        ${ANNOTATION_TOOLBAR_CSS}
        .canvas-layer {
          position: absolute;
          inset: 0;
          pointer-events: none;
        }
      </style>
      <canvas class="canvas-layer"></canvas>
      <div class="snap-box" style="display: none;"></div>
      <div class="magnifier-box" style="display: none;">
        <canvas class="magnifier-canvas" width="130" height="100"></canvas>
        <div class="magnifier-info">
          <div class="mag-color">#FFFFFF</div>
          <div class="mag-pos">X: 0, Y: 0</div>
          <div class="mag-tag" style="color: #38bdf8; font-weight: bold;"></div>
        </div>
      </div>
      <div class="selection-box" style="display: none;">
        <div class="size-badge">0 x 0</div>
        <div class="handle nw" data-handle="nw"></div>
        <div class="handle n" data-handle="n"></div>
        <div class="handle ne" data-handle="ne"></div>
        <div class="handle e" data-handle="e"></div>
        <div class="handle se" data-handle="se"></div>
        <div class="handle s" data-handle="s"></div>
        <div class="handle sw" data-handle="sw"></div>
        <div class="handle w" data-handle="w"></div>
        <div class="toolbar">
          <button data-tool="select" class="select-btn active" title="${t("shotSelect")}">
            ${ANNOTATION_TOOLBAR_ICONS.select}
          </button>
          <button data-tool="rect" title="${t("shotRect")}">
            ${ANNOTATION_TOOLBAR_ICONS.rect}
          </button>
          <button data-tool="arrow" title="${t("shotArrow")}">
            ${ANNOTATION_TOOLBAR_ICONS.arrow}
          </button>
          <button data-tool="privacy" title="${t("shotPrivacy")}">
            ${ANNOTATION_TOOLBAR_ICONS.privacy}
          </button>
          <button data-tool="text" title="${t("shotText")}">
            ${ANNOTATION_TOOLBAR_ICONS.text}
          </button>
          <button data-tool="style-adjust" class="active" title="${t("shotStyleAdjust")}">
            ${ANNOTATION_TOOLBAR_ICONS.styleAdjust}
          </button>
          <button data-tool="pruning-toggle" title="${t("shotDisablePruning")}">
            ${ANNOTATION_TOOLBAR_ICONS.pruningToggle}
          </button>
          <button data-action="undo" class="undo-btn" title="${t("shotUndo")}">
            ${ANNOTATION_TOOLBAR_ICONS.undo}
          </button>
          <button data-action="clear" class="clear-btn" title="${t("shotClear")}">
            ${ANNOTATION_TOOLBAR_ICONS.clear}
          </button>
          <div class="divider"></div>
          <button data-action="cancel" class="cancel-btn" title="${t("shotCancel")}">
            ${ANNOTATION_TOOLBAR_ICONS.cancel}
          </button>
          <button data-action="confirm" class="confirm-btn" title="${t("shotConfirm")}">
            ${ANNOTATION_TOOLBAR_ICONS.confirm}
          </button>
        </div>
      </div>
    `;
}
