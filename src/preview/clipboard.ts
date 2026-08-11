export async function copyTextToClipboard(
  value: string,
  root: Document = document
): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }
  } catch {
    // 本地文件报告可能拿不到 Clipboard API 权限，需降级处理。
  }

  const textarea = root.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  root.body.appendChild(textarea);
  textarea.select();
  const copied = root.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("浏览器未授予剪贴板权限");
}
