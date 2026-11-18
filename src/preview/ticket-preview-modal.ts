import {
  copyDataUrlImageToClipboard,
  copyRichTextToClipboard,
} from "../shared/clipboard.ts";
import {
  buildTicketHtml,
  buildTicketTemplate,
  uint8ArrayToBase64,
  type EvidencePackageSnapshot,
} from "./evidence-package.ts";
import {
  buildCustomerNoteFile,
  buildCustomerNoteFilename,
  buildTicketDraft,
  buildTicketQuestions,
  detectCustomerNoteLeaks,
  renderTicketMarkdown,
  renderTicketQuestionsSection,
  type TicketAudience,
  type TicketQuestion,
  type TicketQuestionId,
  type TicketQuestionOverrides,
} from "./ticket-compose.ts";
import type { TicketDraft } from "../shared/protocol.ts";
import { bindPlaywrightModalClose } from "./playwright-modal.ts";
import { isEn, t } from "../shared/i18n.ts";

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
  /** 持久化工单五问草稿；缺省时静默跳过（兼容旧装配） */
  saveTicketDraft?: (
    sceneId: string,
    draft: TicketDraft
  ) => void | Promise<void>;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 极简 Markdown → HTML（仅覆盖工单五问用到的标题/段落/列表/图片），
 * 用于客户版富文本预览，避免引入第三方 Markdown 依赖。
 */
function markdownToHtml(markdown: string): string {
  const lines = markdown.split("\n");
  const html: string[] = [];
  let listOpen = false;

  const closeList = () => {
    if (listOpen) {
      html.push("</ul>");
      listOpen = false;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      closeList();
      continue;
    }
    const image = /^!\[(.*?)\]\((.*?)\)$/.exec(line.trim());
    if (image) {
      closeList();
      html.push(
        `<p><img src="${escapeHtml(image[2])}" alt="${escapeHtml(image[1])}" /></p>`
      );
      continue;
    }
    if (line.startsWith("### ")) {
      closeList();
      html.push(`<h3>${escapeHtml(line.slice(4))}</h3>`);
      continue;
    }
    if (line.startsWith("## ")) {
      closeList();
      html.push(`<h3>${escapeHtml(line.slice(3))}</h3>`);
      continue;
    }
    if (line.startsWith("# ")) {
      closeList();
      html.push(`<h2>${escapeHtml(line.slice(2))}</h2>`);
      continue;
    }
    if (line.startsWith("- ")) {
      if (!listOpen) {
        html.push("<ul>");
        listOpen = true;
      }
      html.push(`<li>${escapeHtml(line.slice(2))}</li>`);
      continue;
    }
    closeList();
    html.push(`<p>${escapeHtml(line)}</p>`);
  }
  closeList();
  return html.join("\n");
}

/**
 * 绑定工单草稿图文预览弹窗（五问编辑、研发/客户双受众、富文本/纯文本切换、
 * 步骤截图复制与大图查看、一键复制与导出）。
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
  const audienceInternalBtn = root.getElementById(
    "ticket-audience-internal"
  ) as HTMLButtonElement | null;
  const audienceCustomerBtn = root.getElementById(
    "ticket-audience-customer"
  ) as HTMLButtonElement | null;
  const questionsEditor = root.getElementById(
    "ticket-questions-editor"
  ) as HTMLElement | null;
  const customerConfirmHint = root.getElementById(
    "ticket-customer-confirm"
  ) as HTMLElement | null;
  const exportCustomerNoteBtn = root.getElementById(
    "ticket-export-customer-note"
  ) as HTMLButtonElement | null;
  const customerLeakWarning = root.getElementById(
    "ticket-customer-leak-warning"
  ) as HTMLElement | null;

  let currentTicketBundle: { markdown: string; html: string } | undefined;
  let activeHeightTransitionTimeout: number | undefined;
  let currentSnapshot: EvidencePackageSnapshot | undefined;
  let currentFilename: string | undefined;
  let currentQuestions: TicketQuestion[] = [];
  let questionOverrides: TicketQuestionOverrides = {};
  let ticketDraftSaveTimer: number | undefined;
  const TICKET_DRAFT_SAVE_DELAY_MS = 400;
  let activeAudience: TicketAudience = "internal";

  const en = () => isEn();

  function getScene() {
    return currentSnapshot?.issueScenes?.[0];
  }

  /** 客户版说明文件名只取会话/场景短标识，避免页面标题、客户名进入文件名。 */
  function customerNoteIdentifier(): string | undefined {
    return currentSnapshot?.session?.id ?? getScene()?.id;
  }

  /** 导出前的可疑残留提示：只提示，不阻断导出。 */
  function renderLeakWarning(text?: string): void {
    if (!customerLeakWarning) return;
    const leaks = text ? detectCustomerNoteLeaks(text) : [];
    if (leaks.length === 0) {
      customerLeakWarning.textContent = "";
      customerLeakWarning.hidden = true;
      return;
    }
    customerLeakWarning.textContent = t(
      "customerNoteLeakWarning",
      leaks.join(en() ? ", " : "、")
    );
    customerLeakWarning.hidden = false;
  }

  /** 复用证据包既有下载通道：blob URL + chrome.downloads（无扩展 API 时退回 <a download>）。 */
  async function downloadMarkdownFile(
    filename: string,
    content: string
  ): Promise<void> {
    const blob = new Blob([content], {
      type: "text/markdown;charset=utf-8",
    });
    if (
      typeof URL === "undefined" ||
      typeof URL.createObjectURL !== "function"
    ) {
      throw new Error("download unsupported");
    }
    const blobUrl = URL.createObjectURL(blob);
    try {
      if (typeof chrome !== "undefined" && chrome.downloads?.download) {
        await chrome.downloads.download({
          url: blobUrl,
          filename,
          saveAs: true,
        });
      } else {
        const anchor = root.createElement("a");
        anchor.href = blobUrl;
        anchor.download = filename;
        root.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      }
    } finally {
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
    }
  }

  async function exportCustomerNote(): Promise<void> {
    if (!currentSnapshot) {
      deps.notify(t("waitForEvidenceLoad"));
      return;
    }
    if (activeAudience !== "customer") setAudience("customer");
    const scene = getScene();
    const questions = buildTicketQuestions(scene, questionOverrides);
    const content = buildCustomerNoteFile(questions, scene);
    renderLeakWarning(content);
    const leaks = detectCustomerNoteLeaks(content);
    if (leaks.length > 0) {
      deps.notify(t("customerNoteLeakWarning", leaks.join(en() ? ", " : "、")));
    }
    const filename = buildCustomerNoteFilename(customerNoteIdentifier());
    try {
      await downloadMarkdownFile(filename, content);
      deps.notify(t("customerNoteExported", filename));
    } catch (error) {
      deps.notify(t("customerNoteExportFailed", String(error)));
    }
  }

  /** 立即把当前五问编辑落库（关闭弹窗/导出前兜底）。 */
  function flushTicketDraft(): void {
    if (ticketDraftSaveTimer !== undefined) {
      window.clearTimeout(ticketDraftSaveTimer);
      ticketDraftSaveTimer = undefined;
    }
    const scene = getScene();
    if (!scene || !deps.saveTicketDraft) return;
    void deps.saveTicketDraft(scene.id, buildTicketDraft(questionOverrides));
  }

  /** 编辑即存：防抖 400ms，避免逐字符写 IndexedDB。 */
  function scheduleTicketDraftSave(): void {
    if (!deps.saveTicketDraft) return;
    if (ticketDraftSaveTimer !== undefined) {
      window.clearTimeout(ticketDraftSaveTimer);
    }
    ticketDraftSaveTimer = window.setTimeout(() => {
      ticketDraftSaveTimer = undefined;
      flushTicketDraft();
    }, TICKET_DRAFT_SAVE_DELAY_MS);
  }

  function getAnnotatedDataUrl(): string | undefined {
    const scene = getScene();
    if (!scene) return undefined;
    const asset = currentSnapshot?.issueAssets?.find(
      (item) => item.sceneId === scene.id && item.kind === "issue-annotated"
    );
    if (!asset || asset.bytes.byteLength === 0) return undefined;
    return `data:${asset.mimeType};base64,${uint8ArrayToBase64(asset.bytes)}`;
  }

  function questionSourceLabel(question: TicketQuestion): string {
    if (question.source === "auto") return en() ? "Auto draft" : "自动草稿";
    if (question.source === "derived") return en() ? "Derived" : "工具推导";
    return en() ? "Human input" : "人工填写";
  }

  function renderQuestionEditor(): void {
    if (!questionsEditor) return;
    questionsEditor.innerHTML = "";
    const fields: Array<{
      id: TicketQuestionId;
      multiline: boolean;
      rows: number;
    }> = [
      { id: "symptom", multiline: true, rows: 2 },
      { id: "impact", multiline: true, rows: 2 },
      { id: "isBug", multiline: false, rows: 1 },
      { id: "workaround", multiline: true, rows: 2 },
      { id: "eta", multiline: false, rows: 1 },
    ];

    for (const field of fields) {
      const question = currentQuestions.find((item) => item.id === field.id);
      if (!question) continue;

      const wrapper = root.createElement("div");
      wrapper.className = "ticket-question-field";

      const label = root.createElement("label");
      label.className = "ticket-question-label";
      label.textContent = `${question.order}. ${question.title}`;
      const badge = root.createElement("span");
      badge.className = "ticket-question-source";
      badge.textContent = questionSourceLabel(question);
      label.appendChild(badge);

      const input = field.multiline
        ? root.createElement("textarea")
        : root.createElement("input");
      if (input instanceof HTMLTextAreaElement) {
        input.rows = field.rows;
      }
      input.className = "ticket-question-input";
      input.value = question.value;
      input.placeholder = question.placeholder;
      if (field.id === "eta") {
        input.placeholder = "<待研发确认>";
      }
      input.addEventListener("input", () => {
        questionOverrides[field.id] = input.value;
        renderPreview();
        scheduleTicketDraftSave();
      });

      wrapper.appendChild(label);
      wrapper.appendChild(input);

      if (question.reason) {
        const hint = root.createElement("div");
        hint.className = "ticket-question-hint";
        hint.textContent = `${en() ? "Basis" : "依据"}：${question.reason}`;
        wrapper.appendChild(hint);
      }

      questionsEditor.appendChild(wrapper);
    }
  }

  function enhanceTicketImages(): void {
    if (!ticketRichView) return;
    ticketRichView.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
      const interactionId = img.getAttribute("data-interaction-id") || "";
      if (img.parentElement?.classList.contains("ticket-image-wrapper")) return;

      const wrapper = root.createElement("div");
      wrapper.className = "ticket-image-wrapper";
      img.parentNode?.insertBefore(wrapper, img);
      wrapper.appendChild(img);

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

      img.addEventListener("click", () => {
        deps.openImageViewer(interactionId, {
          title: img.alt || t("screenshotModalAlt"),
          dataUrl: img.src,
        });
      });
    });
  }

  function renderPreview(): void {
    if (!currentSnapshot) return;
    const scene = getScene();
    currentQuestions = buildTicketQuestions(scene, questionOverrides);

    let markdown: string;
    let html: string;
    if (activeAudience === "internal") {
      markdown = buildTicketTemplate(
        currentSnapshot,
        currentFilename,
        questionOverrides
      );
      html = `${markdownToHtml(
        renderTicketQuestionsSection(currentQuestions, "internal")
      )}\n${buildTicketHtml(currentSnapshot, currentFilename)}`;
    } else {
      markdown = renderTicketMarkdown(currentQuestions, scene, "customer");
      html = markdownToHtml(markdown);
      const annotatedDataUrl = getAnnotatedDataUrl();
      if (annotatedDataUrl) {
        html = html.replace(
          'src="screenshot-annotated"',
          `src="${annotatedDataUrl}"`
        );
      } else {
        html = html.replace(/<p><img[^>]*screenshot-annotated[^>]*><\/p>/g, "");
      }
    }

    currentTicketBundle = { markdown, html };
    if (ticketPlainView) ticketPlainView.textContent = markdown;
    if (ticketRichView) {
      ticketRichView.innerHTML = html;
      enhanceTicketImages();
    }
    renderLeakWarning(
      activeAudience === "customer" ? currentTicketBundle.markdown : undefined
    );
  }

  function setAudience(audience: TicketAudience): void {
    activeAudience = audience;
    audienceInternalBtn?.classList.toggle("active", audience === "internal");
    audienceCustomerBtn?.classList.toggle("active", audience === "customer");
    if (exportCustomerNoteBtn) {
      exportCustomerNoteBtn.disabled = audience !== "customer";
    }
    if (customerConfirmHint) {
      customerConfirmHint.hidden = audience !== "customer";
    }
    renderPreview();
  }

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
    // 上一次打开若有未落盘的防抖任务，先用旧场景兜底保存
    flushTicketDraft();
    const snapshot = deps.getPackageSnapshot();
    if (!snapshot) {
      deps.notify(t("waitForEvidenceLoad"));
      return;
    }
    currentSnapshot = snapshot;
    currentFilename = deps.getArtifactFilename();
    questionOverrides = {};
    activeAudience = "internal";
    audienceInternalBtn?.classList.add("active");
    audienceCustomerBtn?.classList.remove("active");
    if (exportCustomerNoteBtn) exportCustomerNoteBtn.disabled = true;
    if (customerConfirmHint) customerConfirmHint.hidden = true;

    const stepCount = snapshot.interactions?.length ?? 0;
    const imageCount = snapshot.interactionAssets?.length ?? 0;
    if (ticketSummary) {
      ticketSummary.textContent = t("ticketStepsSummary", [
        String(stepCount),
        String(imageCount),
      ]);
    }

    renderPreview();
    renderQuestionEditor();

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
  audienceInternalBtn?.addEventListener("click", () => setAudience("internal"));
  audienceCustomerBtn?.addEventListener("click", () => setAudience("customer"));
  exportCustomerNoteBtn?.addEventListener("click", () => {
    void exportCustomerNote();
  });

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
    flushTicketDraft();
    clearTicketHeightTransition();
    ticketModal!.hidden = true;
  }

  ticketClose?.addEventListener("click", closeTicketModal);
  ticketCloseBtn?.addEventListener("click", closeTicketModal);
  ticketModal.addEventListener("click", (e) => {
    if (e.target === ticketModal) closeTicketModal();
  });

  bindPlaywrightModalClose(ticketModal);

  // 页面被关闭/刷新时，防抖中的编辑也不丢
  window.addEventListener("beforeunload", () => flushTicketDraft());

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
