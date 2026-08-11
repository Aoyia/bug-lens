/**
 * 为 Playwright 脚本弹窗绑定键盘关闭行为。
 *
 * 预览页所有模态对话框均遵循「Escape 关闭」的交互惯例：
 * 图片查看器（image-viewer.ts）与快捷键面板（shortcuts-panel.ts）都已支持，
 * Playwright 弹窗此前只能点击 × / 背景关闭，键盘操作不一致。
 * 此处统一为 Escape 关闭，且仅在弹窗可见时生效，不影响页面其他快捷键。
 */
export function bindPlaywrightModalClose(
  modal: HTMLElement,
  win: Window = window
): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    if (!modal.hidden) {
      modal.hidden = true;
    }
  };
  win.addEventListener("keydown", onKeyDown);
  return () => win.removeEventListener("keydown", onKeyDown);
}
