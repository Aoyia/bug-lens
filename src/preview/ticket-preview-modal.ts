import {
  copyDataUrlImageToClipboard,
  copyRichTextToClipboard,
} from "../shared/clipboard.ts";
import {
  buildTicketBundle,
  type EvidencePackageSnapshot,
} from "./evidence-package.ts";
import { bindPlaywrightModalClose } from "./playwright-modal.ts";
import { t } from "../shared/i18n.ts";

export interface TicketPreviewModalDeps {
  root?: Document;
  getPackageSnapshot: () => EvidencePackageSnapshot | undefined;
  getArtifactFilename: () => string | undefined;
  notify: (message: string) => void;
  openImageViewer: (
    interactionId: string,
    fallback: { title: string; dataUrl: string }
  ) => void;
  exportTicketZip: () => void;
}

/**
 * 绑定工单草稿图文预览弹窗（富文本/纯文本切换、高度过渡动画、步骤截图复制与大图查看、一键复制与导出）。
 */
export function bindTicketPreviewModal(deps: TicketPreviewModalDeps): void {
  const root = deps.root ?? document;
  const ticketModal = root.getElementById("ticket-modal") as HTMLElement | null;
  if (!ticketModal) return;

  const previewTicketBtn = root.getElementById(
    "preview-ticket-btn"
  ) as HTMLButtonElement | null;
  const ticketClose = root.getElementById(
    "ticket-modal-close"
  ) as HTMLButtonElement | null;
  const ticketCloseBtn = root.getElementById(
    "ticket-modal-close-btn"
  ) as HTMLButtonElement | null;
  const ticketTabRich = root.getElementById(
    "ticket-tab-rich"
  ) as HTMLButtonElement | null;
  const ticketTabPlain = root.getElementById(
    "ticket-tab-plain"
  ) as HTMLButtonElement | null;
  const ticketRichView = root.getElementById(
    "ticket-rich-view"
  ) as HTMLElement | null;
  const ticketPlainView = root.getElementById(
    "ticket-plain-view"
  ) as HTMLElement | null;
  const ticketSummary = root.getElementById(
    "ticket-modal-summary"
  ) as HTMLElement | null;
  const ticketModalCopyBtn = root.getElementById(
    "ticket-modal-copy-btn"
  ) as HTMLButtonElement | null;
  const ticketModalCreateBtn = root.getElementById(
    "ticket-modal-create-btn"
  ) as HTMLButtonElement | null;

  let currentTicketBundle: { markdown: string; html: string } | undefined;
  let activeHeightTransitionTimeout: number | undefined;

  function clearTicketHeightTransition(): void {
    if (activeHeightTransitionTimeout !== undefined) {
      window.clearTimeout(activeHeightTransitionTimeout);
      activeHeightTransitionTimeout = undefined;
    }
    const contentEl = ticketModal!.querySelector<HTMLElement>(
      ".ticket-modal-content"
    );
    const bodyEl =
      ticketModal!.querySelector<HTMLElement>(".ticket-modal-body");
    if (contentEl) {
      contentEl.style.height = "";
      contentEl.style.transition = "";
    }
    if (bodyEl) {
      bodyEl.style.overflowY = "";
    }
  }

  function openTicketPreview(): void {
    const snapshot = deps.getPackageSnapshot();
    if (!snapshot) {
      deps.notify(t("waitForEvidenceLoad"));
      return;
    }
    const filename = deps.getArtifactFilename();
    const bundle = buildTicketBundle(snapshot, filename);
    currentTicketBundle = bundle;

    const stepCount = snapshot.interactions?.length ?? 0;
    const imageCount = snapshot.interactionAssets?.length ?? 0;
    if (ticketSummary) {
      ticketSummary.textContent = t("ticketStepsSummary", [
        String(stepCount),
        String(imageCount),
      ]);
    }

    if (ticketRichView) {
      ticketRichView.innerHTML = bundle.html;
      ticketRichView
        .querySelectorAll<HTMLImageElement>("img")
        .forEach((img) => {
          const interactionId = img.getAttribute("data-interaction-id") || "";

          // 包装容器以支持悬停复制按钮
          const wrapper = root.createElement("div");
          wrapper.className = "ticket-image-wrapper";
          img.parentNode?.insertBefore(wrapper, img);
          wrapper.appendChild(img);

          // 创建悬停快捷复制按钮
          const copyBtn = root.createElement("button");
          copyBtn.type = "button";
          copyBtn.className = "ticket-image-copy-btn";
          copyBtn.setAttribute("title", t("copyImage"));
          copyBtn.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>
        <span>${t("copyImage")}</span>
      `;

          copyBtn.addEventListener("click", async (event) => {
            event.stopPropagation();
            event.preventDefault();
            try {
              await copyDataUrlImageToClipboard(img.src);
              deps.notify(t("stepImageCopied"));
              const textSpan = copyBtn.querySelector("span");
              if (textSpan) {
                const originalText = textSpan.textContent;
                textSpan.textContent = t("copiedTitle");
                copyBtn.classList.add("copied");
                window.setTimeout(() => {
                  textSpan.textContent = originalText;
                  copyBtn.classList.remove("copied");
                }, 1500);
              }
            } catch (error) {
              deps.notify(t("copyFailed", String(error)));
            }
          });

          wrapper.appendChild(copyBtn);

          // 点击图片主体：唤起大图查看器
          img.addEventListener("click", () => {
            deps.openImageViewer(interactionId, {
              title: img.alt || t("screenshotModalAlt"),
              dataUrl: img.src,
            });
          });
        });
    }
    if (ticketPlainView) ticketPlainView.textContent = bundle.markdown;

    clearTicketHeightTransition();
    ticketTabRich?.classList.add("active");
    ticketTabPlain?.classList.remove("active");
    if (ticketRichView) {
      ticketRichView.hidden = false;
      ticketRichView.classList.remove("ticket-view-fade-in");
    }
    if (ticketPlainView) {
      ticketPlainView.hidden = true;
      ticketPlainView.classList.remove("ticket-view-fade-in");
    }

    ticketModal!.hidden = false;
    const aiDrawer = root.getElementById("ai-drawer");
    if (aiDrawer) aiDrawer.hidden = true;
  }

  previewTicketBtn?.addEventListener("click", openTicketPreview);

  function switchTicketTab(mode: "rich" | "plain"): void {
    if (
      !ticketTabRich ||
      !ticketTabPlain ||
      !ticketRichView ||
      !ticketPlainView
    )
      return;
    const isRich = mode === "rich";
    const currentIsRich = ticketTabRich.classList.contains("active");
    if (isRich === currentIsRich) return;

    const contentEl = ticketModal!.querySelector<HTMLElement>(
      ".ticket-modal-content"
    );
    const bodyEl =
      ticketModal!.querySelector<HTMLElement>(".ticket-modal-body");

    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

    if (!contentEl || !bodyEl || prefersReducedMotion) {
      ticketTabRich.classList.toggle("active", isRich);
      ticketTabPlain.classList.toggle("active", !isRich);
      ticketRichView.hidden = !isRich;
      ticketPlainView.hidden = isRich;
      return;
    }

    if (activeHeightTransitionTimeout !== undefined) {
      window.clearTimeout(activeHeightTransitionTimeout);
      activeHeightTransitionTimeout = undefined;
    }

    const startHeight = contentEl.getBoundingClientRect().height;
    contentEl.style.transition = "";
    contentEl.style.height = "";

    ticketTabRich.classList.toggle("active", isRich);
    ticketTabPlain.classList.toggle("active", !isRich);
    ticketRichView.hidden = !isRich;
    ticketPlainView.hidden = isRich;

    const activeView = isRich ? ticketRichView : ticketPlainView;
    activeView.classList.remove("ticket-view-fade-in");
    void activeView.offsetWidth;
    activeView.classList.add("ticket-view-fade-in");

    const naturalHeight = contentEl.getBoundingClientRect().height;
    const maxHeight = window.innerHeight * 0.85;
    const targetHeight = Math.min(naturalHeight, maxHeight);

    if (Math.abs(startHeight - targetHeight) < 2) {
      contentEl.style.height = "";
      return;
    }

    contentEl.style.height = `${startHeight}px`;
    bodyEl.style.overflowY = "hidden";
    void contentEl.offsetHeight;

    contentEl.style.transition = "height 260ms cubic-bezier(0.16, 1, 0.3, 1)";
    contentEl.style.height = `${targetHeight}px`;

    const onTransitionEnd = () => {
      if (activeHeightTransitionTimeout !== undefined) {
        window.clearTimeout(activeHeightTransitionTimeout);
        activeHeightTransitionTimeout = undefined;
      }
      contentEl.style.height = "";
      contentEl.style.transition = "";
      bodyEl.style.overflowY = "";
      contentEl.removeEventListener("transitionend", handleTransitionEnd);
    };

    const handleTransitionEnd = (e: TransitionEvent) => {
      if (e.target === contentEl && e.propertyName === "height") {
        onTransitionEnd();
      }
    };

    contentEl.addEventListener("transitionend", handleTransitionEnd);
    activeHeightTransitionTimeout = window.setTimeout(onTransitionEnd, 280);
  }

  ticketTabRich?.addEventListener("click", () => switchTicketTab("rich"));
  ticketTabPlain?.addEventListener("click", () => switchTicketTab("plain"));

  function closeTicketModal(): void {
    clearTicketHeightTransition();
    ticketModal!.hidden = true;
  }

  ticketClose?.addEventListener("click", closeTicketModal);
  ticketCloseBtn?.addEventListener("click", closeTicketModal);
  ticketModal.addEventListener("click", (e) => {
    if (e.target === ticketModal) closeTicketModal();
  });

  bindPlaywrightModalClose(ticketModal);

  ticketModalCopyBtn?.addEventListener("click", async () => {
    if (!currentTicketBundle) return;
    try {
      await copyRichTextToClipboard(
        { html: currentTicketBundle.html, text: currentTicketBundle.markdown },
        root
      );
      deps.notify(t("ticketTemplateCopied"));
    } catch (error) {
      deps.notify(t("copyFailed", String(error)));
    }
  });

  ticketModalCreateBtn?.addEventListener("click", async () => {
    if (currentTicketBundle) {
      try {
        await copyRichTextToClipboard(
          {
            html: currentTicketBundle.html,
            text: currentTicketBundle.markdown,
          },
          root
        );
      } catch {
        // 忽略
      }
    }
    closeTicketModal();
    deps.exportTicketZip();
  });
}
