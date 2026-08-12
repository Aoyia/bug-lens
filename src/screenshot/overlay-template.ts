import { t } from "../shared/i18n.ts";

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
        .toolbar {
          position: absolute;
          display: flex;
          align-items: center;
          gap: 2px;
          background: rgba(35, 35, 35, 0.95);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          padding: 4px 6px;
          border-radius: 6px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
          user-select: none;
          z-index: 10;
        }
        .toolbar .divider {
          width: 1px;
          height: 14px;
          background: rgba(255, 255, 255, 0.12);
          margin: 0 4px;
        }
        .toolbar button {
          background: transparent;
          border: none;
          color: #d8d8d8;
          width: 28px;
          height: 28px;
          border-radius: 4px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.12s ease;
          outline: none;
          padding: 0;
        }
        .toolbar button:hover {
          background: rgba(255, 255, 255, 0.12);
          color: #ffffff;
        }
        .toolbar button.active {
          background: rgba(250, 82, 82, 0.2);
          color: #FA5252;
        }
        .toolbar button.cancel-btn:hover {
          background: rgba(239, 68, 68, 0.25);
          color: #ef4444;
        }
        .toolbar button.confirm-btn {
          background: #07c160;
          color: #ffffff;
          width: 32px;
          height: 28px;
          border-radius: 4px;
          box-shadow: 0 2px 6px rgba(7, 193, 96, 0.3);
        }
        .toolbar button.confirm-btn:hover {
          background: #06ad56;
        }
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
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/><path d="M13 13l6 6"/></svg>
          </button>
          <button data-tool="rect" title="${t("shotRect")}">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
          </button>
          <button data-tool="arrow" title="${t("shotArrow")}">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="5" y1="19" x2="19" y2="5"/><polyline points="12 5 19 5 19 12"/></svg>
          </button>
          <button data-tool="privacy" title="${t("shotPrivacy")}">
            <svg width="15" height="15" viewBox="0 0 1024 1024" fill="currentColor">
              <path d="M7.13007408 512v252.43496297h252.43496295V512H7.13007408z m252.43496295 504.86992592H512v-252.43496295H259.56503703v252.43496295z m757.30488889 0v-252.43496295h-252.43496295v252.43496295h252.43496295zM7.13007408 7.13007408v252.43496295h252.43496295V7.13007408H7.13007408zM512 512v252.43496297h252.43496297V512H512z m0-252.43496297H259.56503703V512H512V259.56503703z m252.43496297-252.43496295H512v252.43496295h252.43496297V7.13007408zM1016.86992592 512V259.56503703h-252.43496295V512h252.43496295z"></path>
            </svg>
          </button>
          <button data-tool="text" title="${t("shotText")}">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="4 7 4 4 20 4 20 7"/>
              <line x1="12" y1="4" x2="12" y2="20"/>
              <line x1="9" y1="20" x2="15" y2="20"/>
            </svg>
          </button>
          <button data-tool="style-adjust" class="active" title="${t("shotStyleAdjust")}">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/>
            </svg>
          </button>
          <button data-tool="pruning-toggle" title="${t("shotDisablePruning")}">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="12 2 2 7 12 12 22 7 12 2"/>
              <polyline points="2 17 12 22 22 17"/>
              <polyline points="2 12 12 17 22 12"/>
            </svg>
          </button>
          <button data-action="undo" class="undo-btn" title="${t("shotUndo")}">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 7v6h6"></path>
              <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"></path>
            </svg>
          </button>
          <button data-action="clear" class="clear-btn" title="${t("shotClear")}">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
          <div class="divider"></div>
          <button data-action="cancel" class="cancel-btn" title="${t("shotCancel")}">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
          <button data-action="confirm" class="confirm-btn" title="${t("shotConfirm")}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
          </button>
        </div>
      </div>
    `;
}
