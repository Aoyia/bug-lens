const copyTimers = new WeakMap<HTMLButtonElement, number>();

export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fallback below for restricted contexts or non-HTTPS previews
    }
  }

  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.top = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(ta);
  return ok;
}

export function initCopyButtons(): void {
  const buttons = document.querySelectorAll<HTMLButtonElement>(".js-copy-btn");

  buttons.forEach((btn) => {
    if (btn.dataset.copyBound === "1") return;
    btn.dataset.copyBound = "1";

    btn.addEventListener("click", () => {
      const sourceSelector = btn.dataset.copySource;
      let text = btn.dataset.copyText || "";
      if (sourceSelector) {
        const sourceEl = document.querySelector(sourceSelector);
        text = sourceEl?.textContent || "";
      }

      const labelEl = btn.querySelector<HTMLElement>(".copy-btn-label");
      const defaultLabel =
        btn.dataset.copyLabel ||
        labelEl?.textContent ||
        btn.getAttribute("aria-label") ||
        "Copy";
      const copiedLabel = btn.dataset.copiedLabel || "Copied";
      const failedLabel = btn.dataset.copyFailedLabel || "";
      const resetDelay = Number.parseInt(btn.dataset.copyTimeout || "1800", 10);

      void copyText(text).then((ok) => {
        if (!ok && !failedLabel) return;

        const nextText = ok ? copiedLabel : failedLabel;
        if (labelEl) {
          labelEl.textContent = nextText;
        }
        btn.setAttribute("aria-label", nextText);
        btn.setAttribute("title", nextText);
        btn.classList.toggle("copied", ok);

        const prevTimer = copyTimers.get(btn);
        if (prevTimer !== undefined) {
          window.clearTimeout(prevTimer);
        }

        const nextTimer = window.setTimeout(
          () => {
            if (labelEl) {
              labelEl.textContent = defaultLabel;
            }
            btn.setAttribute("aria-label", defaultLabel);
            btn.setAttribute("title", defaultLabel);
            btn.classList.remove("copied");
            copyTimers.delete(btn);
          },
          Number.isFinite(resetDelay) ? resetDelay : 1800
        );
        copyTimers.set(btn, nextTimer);
      });
    });
  });
}
