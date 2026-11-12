export type ToastTone = "normal" | "success" | "error" | "loading";

const KBD_STYLE =
  "display:inline-flex!important;align-items:center!important;justify-content:center!important;padding:0 4px!important;min-width:20px!important;height:16px!important;font-size:10px!important;font-family:inherit!important;font-weight:600!important;color:#4e5969!important;background:#f2f3f5!important;border:1px solid #e5e6eb!important;border-radius:3px!important;vertical-align:baseline!important;margin:0 2px!important;";

export const FLOATING_TOAST_BASE_CSS = `
  position: fixed !important;
  top: 16px !important;
  left: 50% !important;
  transform: translateX(-50%) translateY(-10px) !important;
  z-index: 2147483647 !important;
  background: #ffffff !important;
  -webkit-backdrop-filter: blur(16px) !important;
  backdrop-filter: blur(16px) !important;
  border: 1px solid rgba(0, 0, 0, 0.08) !important;
  color: #1d2129 !important;
  padding: 8px 18px !important;
  border-radius: 8px !important;
  font-size: 13.5px !important;
  font-weight: 500 !important;
  box-shadow: 0 16px 42px -6px rgba(0, 0, 0, 0.18), 0 6px 16px -2px rgba(0, 0, 0, 0.08), 0 0 0 1px rgba(0, 0, 0, 0.04) !important;
  display: flex !important;
  align-items: flex-start !important;
  gap: 10px !important;
  transition: opacity 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1) !important;
  opacity: 0 !important;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
`;

/**
 * 将文本中的快捷键（⌘V / Ctrl+V）替换为内联 <kbd> 样式标签。
 */
export function formatShortcutKbdHtml(text: string): string {
  return text.replace(/(⌘V|Ctrl\+V)/g, `<kbd style="${KBD_STYLE}">$1</kbd>`);
}

/**
 * 构建统一的 Toast 内部 HTML（含状态图标、单/双行标题描述拆分、可选操作按钮）。
 */
export function buildToastInnerHtml(
  message: string,
  tone: ToastTone = "normal",
  actionHtml = ""
): string {
  const isDualLine = message.includes("\n");
  let contentHtml = "";

  if (isDualLine) {
    const [title, ...rest] = message.split("\n");
    const descHtml = formatShortcutKbdHtml(rest.join("\n"));
    contentHtml = `
      <div style="display:flex!important;flex-direction:column!important;gap:2px!important;align-items:flex-start!important;text-align:left!important;">
        <div style="font-size:13.5px!important;font-weight:600!important;color:#1d2129!important;line-height:1.4!important;">${title}</div>
        <div style="font-size:12px!important;font-weight:400!important;color:#86909c!important;line-height:1.4!important;">${descHtml}${actionHtml}</div>
      </div>
    `;
  } else {
    contentHtml = `<span style="line-height:1.4!important;">${message}${actionHtml}</span>`;
  }

  let iconHtml = "";
  if (tone === "loading") {
    iconHtml = `<span style="display:inline-block!important;width:13px!important;height:13px!important;border:2px solid rgba(0,122,255,0.25)!important;border-top-color:#007aff!important;border-radius:50%!important;animation:wbr-screenshot-spin 0.8s linear infinite!important;margin-right:2px!important;flex-shrink:0!important;align-self:${isDualLine ? "flex-start" : "center"};margin-top:${isDualLine ? "3px" : "0"};"></span>`;
  } else {
    const icon = tone === "error" ? "!" : "✓";
    const iconColor = tone === "error" ? "#d5484c" : "#00b42a";
    iconHtml = `<span style="color:${iconColor};font-size:16px;font-weight:700;line-height:1;margin-top:${isDualLine ? "2px" : "0"};align-self:${isDualLine ? "flex-start" : "center"};">${icon}</span>`;
  }

  return `${iconHtml} ${contentHtml}`;
}

export function animateToastIn(toast: HTMLElement): void {
  const rAF =
    typeof requestAnimationFrame === "function"
      ? (fn: FrameRequestCallback) => requestAnimationFrame(fn)
      : (fn: FrameRequestCallback) => setTimeout(fn, 0);
  rAF(() => {
    toast.style.opacity = "1";
    toast.style.transform = "translateX(-50%) translateY(0)";
  });
}

export function animateToastOutAndRemove(toast: HTMLElement): void {
  toast.style.opacity = "0";
  toast.style.transform = "translateX(-50%) translateY(-10px)";
  setTimeout(() => toast.remove(), 200);
}
