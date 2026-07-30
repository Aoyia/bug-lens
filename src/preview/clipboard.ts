export async function copyTextToClipboard(value: string, root: Document = document): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }
  } catch {
    // Local file reports may not receive the Clipboard API permission.
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
