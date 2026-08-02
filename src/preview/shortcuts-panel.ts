// =====================================================
// 快捷键速查面板 Keyboard Shortcuts Panel
// =====================================================
export function bindShortcutsPanel(doc: Document = document, win: Window = window): void {
  const backdrop = doc.querySelector<HTMLElement>("#shortcuts-backdrop");
  const closeBtn = doc.querySelector<HTMLButtonElement>("#shortcuts-close-btn");
  if (!backdrop) return;

  const open = () => {
    backdrop.hidden = false;
    closeBtn?.focus();
  };

  const close = () => {
    backdrop.hidden = true;
  };

  // ? 键打开（屏蔽输入框场景）
  win.addEventListener("keydown", (e: Event) => {
    const keyEvent = e as KeyboardEvent;
    const active = doc.activeElement as HTMLElement | null;
    if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable)) return;
    if (keyEvent.key === "?") {
      keyEvent.preventDefault();
      backdrop.hidden ? open() : close();
      return;
    }
    if (keyEvent.key === "Escape" && !backdrop.hidden) {
      keyEvent.stopPropagation();
      close();
    }
  });

  // 点击背景关闭
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });

  closeBtn?.addEventListener("click", close);
}
