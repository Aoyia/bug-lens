/**
 * 弹窗内「自定义确认对话框」的键盘与焦点行为。
 *
 * 背景（第一性原理）：
 * - 模态一致性：全应用覆盖层/弹层均遵循「Escape 取消当前层」惯例
 *   （问题编辑器、Playwright 弹窗、图片查看器、快捷键面板、选择浮层），
 *   弹窗内的破坏性确认框是唯一例外；且扩展 popup 中未拦截的 Escape 会落到
 *   浏览器默认行为——直接关闭整个 popup，把「取消对话框」误判为「关闭弹窗」。
 * - 焦点管理：对话框打开后焦点应移入对话框并落在安全默认操作（取消），
 *   关闭后归还给触发元素，避免键盘焦点悬停在已消失的对话框或遮罩下的按钮上。
 */
export interface ConfirmDialogDismissOptions {
  /** 触发打开对话框的元素；关闭后焦点归还给它（脚本触发等场景可为空） */
  trigger?: HTMLElement | null;
  /** 取消按钮；打开时获得焦点（安全默认操作，回车即取消） */
  cancelButton?: HTMLElement | null;
  /** Escape 按下时的取消回调 */
  onCancel: () => void;
  /** 注入 window 便于单测 */
  win?: Window;
}

export function bindConfirmDialogDismiss({
  trigger,
  cancelButton,
  onCancel,
  win = window,
}: ConfirmDialogDismissOptions): () => void {
  // 打开时把焦点移到安全默认操作（取消），键盘用户立即可见、回车即取消
  cancelButton?.focus();

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    // 阻止默认行为与传播，避免弹窗壳层/浏览器把 Escape 当作「关闭整个 popup」
    event.preventDefault();
    event.stopPropagation();
    onCancel();
  };
  win.addEventListener("keydown", onKeyDown);

  return () => {
    win.removeEventListener("keydown", onKeyDown);
    trigger?.focus();
  };
}
