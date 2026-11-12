import { copyTextToClipboard } from "../shared/clipboard.ts";
import type { EvidenceReportSnapshot } from "./evidence-report-view.ts";
import { generatePlaywrightScript } from "./playwright-generator.ts";
import { highlightJs } from "./rendering.ts";
import { t } from "../shared/i18n.ts";

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

export interface PlaywrightScriptModalDeps {
  root?: Document;
  getReportSnapshot: () => EvidenceReportSnapshot | undefined;
  notify: (message: string) => void;
}

/**
 * 绑定预览页 Playwright 复现脚本弹窗的生成、语法高亮展示、复制与关闭控制。
 */
export function bindPlaywrightScriptModal(
  deps: PlaywrightScriptModalDeps
): void {
  const root = deps.root ?? document;
  const playwrightModal = root.getElementById(
    "playwright-modal"
  ) as HTMLElement | null;
  const playwrightOutput = root.getElementById(
    "playwright-script-output"
  ) as HTMLElement | null;
  const playwrightBtn = root.getElementById(
    "export-playwright"
  ) as HTMLButtonElement | null;
  const playwrightClose = root.getElementById(
    "playwright-modal-close"
  ) as HTMLButtonElement | null;
  const playwrightCloseBtn = root.getElementById(
    "playwright-modal-close-btn"
  ) as HTMLButtonElement | null;
  const playwrightCopy = root.getElementById(
    "playwright-copy"
  ) as HTMLButtonElement | null;

  if (!playwrightModal || !playwrightOutput) return;

  function generatePlaywright(): void {
    const snapshot = deps.getReportSnapshot();
    if (!snapshot) {
      deps.notify(t("waitForEvidenceLoad"));
      return;
    }
    const script = generatePlaywrightScript({
      session: snapshot.session,
      interactions: snapshot.interactions.included,
      consoleEntries: snapshot.consoleEntries.included,
      networkEntries: snapshot.networkEntries.included,
    });
    playwrightOutput!.innerHTML = highlightJs(script);
    playwrightModal!.hidden = false;
    const aiDrawer = root.getElementById("ai-drawer");
    if (aiDrawer) aiDrawer.hidden = true;
  }

  playwrightBtn?.addEventListener("click", generatePlaywright);

  playwrightClose?.addEventListener("click", () => {
    playwrightModal.hidden = true;
  });
  playwrightCloseBtn?.addEventListener("click", () => {
    playwrightModal.hidden = true;
  });
  playwrightModal.addEventListener("click", (e) => {
    if (e.target === playwrightModal) {
      playwrightModal.hidden = true;
    }
  });

  bindPlaywrightModalClose(playwrightModal);

  playwrightCopy?.addEventListener("click", async () => {
    const text = playwrightOutput.textContent;
    if (text) {
      try {
        await copyTextToClipboard(text, root);
        deps.notify(t("playwrightScriptCopied"));
      } catch (error) {
        deps.notify(t("copyFailed", String(error)));
      }
    }
  });
}
