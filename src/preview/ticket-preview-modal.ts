import {
  copyDataUrlImageToClipboard,
  copyRichTextToClipboard,
} from "../shared/clipboard.ts";
import {
  buildTicketBundle,
  type EvidencePackageSnapshot,
} from "./evidence-package.ts";
import { t } from "../shared/i18n.ts";

/**
 * 工单草稿的结构化裁剪能力（数据同源）：所有删改都回写到会话选择集，
 * 弹窗只是 buildTicketBundle 纯函数渲染结果的可交互投影，自身不持有文档状态。
 */
export interface TicketCurationDeps {
  excludeInteractions(ids: string[]): Promise<void>;
  excludeScreenshot(interactionId: string): Promise<void>;
  excludeScreenshots?(ids: string[]): Promise<void>;
  excludeDiagnostic(kind: "console" | "network", id: string): Promise<void>;
  setStepDescription(
    interactionId: string,
    desc: string | undefined
  ): Promise<void>;
  setTicketNarrative(
    patch: { actual?: string; expected?: string },
    defaults?: { actual?: string; expected?: string }
  ): Promise<void>;
  restoreSteps(): Promise<void>;
  undo(): Promise<boolean>;
  redo(): Promise<boolean>;
  resetAll(): Promise<void>;
  canUndo(): boolean;
  canRedo(): boolean;
  hasAnyCuration(): boolean;
}

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
  curation?: TicketCurationDeps;
}

const COPY_ICON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;

const EDIT_ICON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>`;

const TRASH_ICON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;

const UNDO_ICON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"></path><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"></path></svg>`;

const REDO_ICON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 7v6h-6"></path><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7"></path></svg>`;

const RESET_ICON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>`;

const CHECK_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

const CANCEL_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;

const isMacPlatform = (): boolean =>
  typeof navigator !== "undefined" &&
  /mac/i.test(navigator.platform || navigator.userAgent || "");

/**
 * 绑定工单草稿图文预览弹窗（富文本/纯文本切换、高度过渡动画、步骤截图复制与大图查看、
 * 模块级删除、零换行槽位内联编辑、撤回/重做/重置、一键复制与导出）。返回解绑函数。
 */
export function bindTicketPreviewModal(
  deps: TicketPreviewModalDeps
): () => void {
  const root = deps.root ?? document;
  const ticketModal = root.getElementById("ticket-modal") as HTMLElement | null;
  if (!ticketModal) return () => {};
  const curation = deps.curation;

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
  let flushActiveEditor: (() => Promise<void>) | null = null;
  let actionQueue: Promise<void> = Promise.resolve();
  let isBusyExporting = false;
  let pendingHighlightKey: string | null = null;
  const cleanups: Array<() => void> = [];

  function on<T extends EventTarget>(
    el: T | null | undefined,
    type: string,
    handler: EventListener
  ): void {
    if (!el) return;
    el.addEventListener(type, handler);
    cleanups.push(() => el.removeEventListener(type, handler));
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

  // ---------- 通用 DOM 辅助 ----------

  function makeButton(
    className: string,
    label: string,
    title: string,
    onClick: () => void
  ): HTMLButtonElement {
    const btn = root.createElement("button");
    btn.type = "button";
    btn.className = className;
    btn.textContent = label;
    btn.setAttribute("title", title);
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      event.preventDefault();
      onClick();
    });
    return btn;
  }

  function makeIconButton(
    className: string,
    iconSvg: string,
    label: string,
    title: string,
    onClick: () => void
  ): HTMLButtonElement {
    const btn = root.createElement("button");
    btn.type = "button";
    btn.className = className;
    btn.setAttribute("title", title);
    btn.setAttribute("aria-label", title);
    btn.innerHTML = iconSvg;
    if (label) {
      const span = root.createElement("span");
      span.textContent = label;
      btn.appendChild(span);
    }
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      event.preventDefault();
      onClick();
    });
    return btn;
  }

  /** 串行执行一次数据变更并在弹窗仍打开时就地重绘（保持滚动位置）。 */
  function runAction(action: () => Promise<unknown>): Promise<void> {
    const next = actionQueue.then(async () => {
      try {
        await action();
        if (!ticketModal!.hidden) {
          renderTicketContent(true);
        }
      } catch (error) {
        deps.notify(t("ticketCurationFailed", String(error)));
      }
    });
    actionQueue = next;
    return next;
  }

  /** 提交任何活跃内联编辑并等待在途写入落盘，再同步刷新纯净剪贴板产物。 */
  async function flushAndSyncBundle(): Promise<void> {
    if (flushActiveEditor) {
      await flushActiveEditor();
    }
    await actionQueue;
    if (!curation) return;
    const snapshot = deps.getPackageSnapshot();
    if (!snapshot) return;
    const bundle = buildTicketBundle(snapshot, deps.getArtifactFilename());
    currentTicketBundle = bundle;
    if (ticketPlainView) ticketPlainView.textContent = bundle.markdown;
  }

  function mountEditor(
    target: HTMLElement,
    options: {
      multiline: boolean;
      initial: string;
      placeholder?: string;
      hostEl?: HTMLElement | null;
      saveKey?: string;
      onSave: (value: string) => Promise<unknown>;
    }
  ): void {
    flushActiveEditor?.();

    const editorWrap = root.createElement("span");
    editorWrap.className = options.multiline
      ? "ticket-inline-editor is-multiline"
      : "ticket-inline-editor";

    const input = root.createElement(
      options.multiline ? "textarea" : "input"
    ) as HTMLInputElement | HTMLTextAreaElement;
    input.className = "ticket-inline-input";
    input.value = options.initial;
    if (options.placeholder) input.placeholder = options.placeholder;
    if (options.multiline) (input as HTMLTextAreaElement).rows = 2;
    else (input as HTMLInputElement).type = "text";

    const editorActions = root.createElement("span");
    editorActions.className = "ticket-inline-editor-actions";

    let settled = false;
    const finish = (save: boolean): Promise<void> => {
      if (settled) return Promise.resolve();
      settled = true;
      flushActiveEditor = null;
      options.hostEl?.classList.remove("is-editing");
      const value = input.value.trim();
      if (!save || value === options.initial.trim()) {
        editorWrap.replaceWith(target);
        return Promise.resolve();
      }
      if (options.saveKey) pendingHighlightKey = options.saveKey;
      return runAction(() => options.onSave(value));
    };
    flushActiveEditor = () => finish(true);

    const confirmBtn = makeIconButton(
      "ticket-inline-action ticket-inline-confirm",
      CHECK_ICON,
      "",
      "Enter",
      () => finish(true)
    );
    const cancelBtn = makeIconButton(
      "ticket-inline-action ticket-inline-cancel",
      CANCEL_ICON,
      "",
      "Esc",
      () => finish(false)
    );
    // 阻止按钮按下时抢先触发输入框 blur 导致竞态
    confirmBtn.addEventListener("mousedown", (e) => e.preventDefault());
    cancelBtn.addEventListener("mousedown", (e) => e.preventDefault());
    editorActions.appendChild(confirmBtn);
    editorActions.appendChild(cancelBtn);

    editorWrap.appendChild(input);
    editorWrap.appendChild(editorActions);

    input.addEventListener("keydown", (rawEvent: Event) => {
      const event = rawEvent as KeyboardEvent;
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finish(false);
      } else if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        finish(true);
      }
    });
    input.addEventListener("blur", () => finish(true));

    options.hostEl?.classList.add("is-editing");
    target.replaceWith(editorWrap);
    input.focus();
    input.select();
  }

  // ---------- 渲染后增强：截图 ----------

  function enhanceImages(): void {
    ticketRichView?.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
      const interactionId = img.getAttribute("data-interaction-id") || "";

      // 包装容器以支持悬停工具栏（移除此图 + 复制图片）
      const wrapper = root.createElement("div");
      wrapper.className = "ticket-image-wrapper";
      img.parentNode?.insertBefore(wrapper, img);
      wrapper.appendChild(img);

      const actionsBar = root.createElement("div");
      actionsBar.className = "ticket-image-actions";

      if (curation && interactionId) {
        const stepBlock = img.closest<HTMLElement>(
          '[data-ticket-block="step"]'
        );
        const stepIds = (stepBlock?.dataset.stepIds ?? "")
          .split(",")
          .filter(Boolean);
        const targetIds = stepIds.length > 0 ? stepIds : [interactionId];
        actionsBar.appendChild(
          makeIconButton(
            "ticket-image-remove-btn",
            TRASH_ICON,
            t("ticketRemoveImage"),
            t("ticketRemoveImage"),
            () =>
              runAction(() =>
                curation.excludeScreenshots
                  ? curation.excludeScreenshots(targetIds)
                  : curation.excludeScreenshot(interactionId)
              )
          )
        );
      }

      const copyBtn = root.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "ticket-image-copy-btn";
      copyBtn.setAttribute("title", t("copyImage"));
      copyBtn.setAttribute("aria-label", t("copyImage"));
      copyBtn.innerHTML = `${COPY_ICON}<span>${t("copyShort")}</span>`;

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

      actionsBar.appendChild(copyBtn);
      wrapper.appendChild(actionsBar);

      // 点击图片主体：唤起大图查看器
      img.addEventListener("click", () => {
        deps.openImageViewer(interactionId, {
          title: img.alt || t("screenshotModalAlt"),
          dataUrl: img.src,
        });
      });
    });
  }

  // ---------- 渲染后增强：槽位编辑 / 模块删除 ----------

  function isSlotCustom(slot: HTMLElement): boolean {
    return (
      slot.closest<HTMLElement>("[data-custom]")?.dataset.custom === "true"
    );
  }

  function saveSlot(
    meta: {
      kind: string;
      stepId: string;
      defaultDesc: string;
      defaultText?: string;
    },
    value: string | undefined
  ): Promise<unknown> {
    if (meta.kind === "step-desc") {
      const next =
        value === undefined || value === meta.defaultDesc ? undefined : value;
      return curation!.setStepDescription(meta.stepId, next);
    }
    if (meta.kind === "narrative-actual") {
      return curation!.setTicketNarrative(
        { actual: value || undefined },
        meta.defaultText !== undefined
          ? { actual: meta.defaultText }
          : undefined
      );
    }
    return curation!.setTicketNarrative(
      { expected: value },
      meta.defaultText !== undefined
        ? { expected: meta.defaultText }
        : undefined
    );
  }

  function readSlotMeta(slot: HTMLElement) {
    const block = slot.closest<HTMLElement>('[data-ticket-block="step"]');
    const host = slot.closest<HTMLElement>("p");
    const kind = slot.dataset.ticketSlot ?? "";
    const stepId = block?.dataset.interactionId ?? "";
    return {
      kind,
      stepId,
      defaultDesc: block?.dataset.defaultDesc ?? "",
      defaultText: host?.dataset.defaultText,
      hostEl: block ?? host,
      saveKey: kind === "step-desc" ? `step:${stepId}` : kind,
    };
  }

  function startSlotEdit(slot: HTMLElement): void {
    const meta = readSlotMeta(slot);
    const isNarrative = meta.kind !== "step-desc";
    const isPlaceholder = slot.dataset.placeholder === "true";
    mountEditor(slot, {
      multiline: isNarrative,
      initial: isPlaceholder ? "" : (slot.textContent ?? ""),
      placeholder: isPlaceholder ? (slot.textContent ?? "") : undefined,
      hostEl: meta.hostEl,
      saveKey: meta.saveKey,
      onSave: (value) => saveSlot(meta, value),
    });
  }

  function enhanceSlots(): void {
    const highlightKey = pendingHighlightKey;
    pendingHighlightKey = null;

    ticketRichView
      ?.querySelectorAll<HTMLElement>("[data-ticket-slot]")
      .forEach((slot) => {
        const meta = readSlotMeta(slot);
        if (
          meta.kind === "narrative-actual" ||
          meta.kind === "narrative-expected"
        ) {
          slot.closest<HTMLElement>("p")?.classList.add("ticket-narrative-row");
        }
        slot.classList.add("ticket-slot-editable");
        slot.setAttribute("title", t("ticketInlineEditHint"));
        slot.addEventListener("click", () => startSlotEdit(slot));

        if (highlightKey && highlightKey === meta.saveKey) {
          slot.classList.add("ticket-slot-just-saved");
        }

        if (isSlotCustom(slot)) {
          slot.after(
            makeIconButton(
              "ticket-slot-reset-btn",
              RESET_ICON,
              "",
              t("ticketRestoreDefault"),
              () => runAction(() => saveSlot(meta, undefined))
            )
          );
        }
      });
  }

  function enhanceBlocks(): void {
    ticketRichView
      ?.querySelectorAll<HTMLElement>("[data-ticket-block]")
      .forEach((block) => {
        const kind = block.dataset.ticketBlock;
        block.classList.add("ticket-curation-block");
        const actions = root.createElement("div");
        actions.className = "ticket-block-actions";

        if (kind === "step") {
          actions.appendChild(
            makeIconButton(
              "ticket-block-btn",
              EDIT_ICON,
              "",
              t("ticketEditStep"),
              () => {
                const slot = block.querySelector<HTMLElement>(
                  '[data-ticket-slot="step-desc"]'
                );
                if (slot) startSlotEdit(slot);
              }
            )
          );
          const divider = root.createElement("span");
          divider.className = "ticket-block-divider";
          actions.appendChild(divider);
          actions.appendChild(
            makeIconButton(
              "ticket-block-btn danger",
              TRASH_ICON,
              "",
              t("ticketDeleteStep"),
              () => {
                const ids = (block.dataset.stepIds ?? "")
                  .split(",")
                  .filter(Boolean);
                runAction(() => curation!.excludeInteractions(ids));
              }
            )
          );
        } else if (kind === "network" || kind === "console") {
          actions.appendChild(
            makeIconButton(
              "ticket-block-btn danger",
              TRASH_ICON,
              "",
              t("ticketRemoveItem"),
              () =>
                runAction(() =>
                  curation!.excludeDiagnostic(kind, block.dataset.entryId ?? "")
                )
            )
          );
        }
        block.appendChild(actions);
      });
  }

  /** 步骤被删空：依据 excluded.interaction 给出恢复入口（刷新页面后依然可用）。 */
  function enhanceEmptySteps(snapshot: EvidencePackageSnapshot): void {
    const empty = ticketRichView?.querySelector<HTMLElement>(
      '[data-ticket-empty="steps"]'
    );
    if (!empty || !curation) return;
    if ((snapshot.excluded?.interaction ?? 0) <= 0 && !curation.canUndo()) {
      return;
    }
    empty.textContent = `${t("ticketAllStepsHidden")} `;
    if (curation.canUndo()) {
      empty.appendChild(
        makeButton("ticket-inline-link", t("ticketUndo"), t("ticketUndo"), () =>
          runAction(() => curation.undo())
        )
      );
    }
    if ((snapshot.excluded?.interaction ?? 0) > 0) {
      empty.appendChild(
        makeButton(
          "ticket-inline-link",
          t("ticketRestoreAllSteps"),
          t("ticketRestoreAllSteps"),
          () => runAction(() => curation.restoreSteps())
        )
      );
    }
  }

  /** 预期表现为空时，常驻虚位槽供补填；若原本有默认预期被清空，附带还原按钮。 */
  function enhanceAddExpected(): void {
    const actualSlot = ticketRichView?.querySelector<HTMLElement>(
      '[data-ticket-slot="narrative-actual"]'
    );
    if (
      !actualSlot ||
      ticketRichView?.querySelector('[data-ticket-slot="narrative-expected"]')
    )
      return;
    const host = actualSlot.closest<HTMLElement>("p");
    if (!host) return;
    const row = root.createElement("div");
    row.className = "ticket-add-expected-row";
    const addBtn = makeButton(
      "ticket-add-expected-btn",
      t("ticketAddExpected"),
      t("ticketAddExpected"),
      () =>
        mountEditor(addBtn, {
          multiline: true,
          initial: "",
          placeholder: t("ticketAddExpected"),
          saveKey: "narrative-expected",
          onSave: (value) =>
            curation!.setTicketNarrative(
              { expected: value },
              host.dataset.baseExpected !== undefined
                ? { expected: host.dataset.baseExpected }
                : { expected: "" }
            ),
        })
    );
    row.appendChild(addBtn);
    if (host.dataset.expectedCleared === "true") {
      row.appendChild(
        makeIconButton(
          "ticket-slot-reset-btn",
          RESET_ICON,
          t("ticketRestoreExpected"),
          t("ticketRestoreExpected"),
          () =>
            runAction(() =>
              curation!.setTicketNarrative({ expected: undefined })
            )
        )
      );
    }
    host.after(row);
  }

  // ---------- 渲染入口 ----------

  function renderFooter(): void {
    if (!ticketSummary || !ticketRichView) return;
    const stepCount = ticketRichView.querySelectorAll(
      '[data-ticket-block="step"]'
    ).length;
    const imageCount = ticketRichView.querySelectorAll(
      "img[data-interaction-id]"
    ).length;
    ticketSummary.textContent = t("ticketStepsSummary", [
      String(stepCount),
      String(imageCount),
    ]);
    if (!curation) return;

    const showUndo = curation.canUndo();
    const showRedo = curation.canRedo();
    const showReset = curation.hasAnyCuration();
    if (!showUndo && !showRedo && !showReset) return;

    const mac = isMacPlatform();
    const divider = root.createElement("span");
    divider.className = "ticket-footer-divider";
    ticketSummary.appendChild(divider);

    const group = root.createElement("span");
    group.className = "ticket-curation-controls";
    if (showUndo) {
      group.appendChild(
        makeIconButton(
          "ticket-curation-btn",
          UNDO_ICON,
          "",
          `${t("ticketUndo")} (${mac ? "⌘Z" : "Ctrl+Z"})`,
          () => runAction(() => curation.undo())
        )
      );
    }
    if (showRedo) {
      group.appendChild(
        makeIconButton(
          "ticket-curation-btn",
          REDO_ICON,
          "",
          `${t("ticketRedo")} (${mac ? "⇧⌘Z" : "Ctrl+Y"})`,
          () => runAction(() => curation.redo())
        )
      );
    }
    if (showReset) {
      group.appendChild(
        makeIconButton(
          "ticket-curation-btn",
          RESET_ICON,
          "",
          t("ticketResetDraft"),
          () => runAction(() => curation.resetAll())
        )
      );
    }
    ticketSummary.appendChild(group);
  }

  function renderTicketContent(preserveScroll: boolean): boolean {
    const snapshot = deps.getPackageSnapshot();
    if (!snapshot) {
      deps.notify(t("waitForEvidenceLoad"));
      return false;
    }
    flushActiveEditor = null;
    const bodyEl =
      ticketModal!.querySelector<HTMLElement>(".ticket-modal-body");
    const scrollTop = preserveScroll && bodyEl ? bodyEl.scrollTop : 0;

    // currentTicketBundle 始终是未注入任何交互控件的纯净内容，供复制/导出使用
    const bundle = buildTicketBundle(snapshot, deps.getArtifactFilename());
    currentTicketBundle = bundle;

    if (ticketPlainView) ticketPlainView.textContent = bundle.markdown;
    if (ticketRichView) {
      ticketRichView.innerHTML = bundle.html;
      enhanceImages();
      if (curation) {
        enhanceSlots();
        enhanceBlocks();
        enhanceEmptySteps(snapshot);
        enhanceAddExpected();
      }
    }
    renderFooter();
    if (bodyEl) bodyEl.scrollTop = scrollTop;
    return true;
  }

  function openTicketPreview(): void {
    pendingHighlightKey = null;
    if (!renderTicketContent(false)) return;

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

  on(previewTicketBtn, "click", openTicketPreview);

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
    if (!isRich) {
      void flushAndSyncBundle();
    }

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

  on(ticketTabRich, "click", () => switchTicketTab("rich"));
  on(ticketTabPlain, "click", () => switchTicketTab("plain"));

  function closeTicketModal(): void {
    flushActiveEditor = null;
    pendingHighlightKey = null;
    clearTicketHeightTransition();
    ticketModal!.hidden = true;
  }

  on(ticketClose, "click", closeTicketModal);
  on(ticketCloseBtn, "click", closeTicketModal);
  on(ticketModal, "click", (e) => {
    if (e.target === ticketModal) closeTicketModal();
  });

  const onRootKeyDown = (rawEvent: Event) => {
    if (ticketModal.hidden) return;
    // 大图查看器打开时让位于查看器，避免 Escape 连环关闭工单或在后台误撤回
    const imageModal = root.getElementById("image-modal");
    if (imageModal && !imageModal.hidden) return;

    const event = rawEvent as KeyboardEvent;
    const target = event.target as HTMLElement | null;
    const isTyping = Boolean(
      target &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable)
    );
    if (event.key === "Escape") {
      if (!isTyping) closeTicketModal();
      return;
    }
    if (!curation || isTyping) return;
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === "z" && !event.shiftKey) {
      event.preventDefault();
      runAction(() => curation.undo());
    } else if ((key === "z" && event.shiftKey) || key === "y") {
      event.preventDefault();
      runAction(() => curation.redo());
    }
  };
  on(root, "keydown", onRootKeyDown);

  on(ticketModalCopyBtn, "click", async () => {
    if (isBusyExporting) return;
    isBusyExporting = true;
    try {
      await flushAndSyncBundle();
      if (!currentTicketBundle) return;
      await copyRichTextToClipboard(
        { html: currentTicketBundle.html, text: currentTicketBundle.markdown },
        root
      );
      deps.notify(t("ticketTemplateCopied"));
    } catch (error) {
      deps.notify(t("copyFailed", String(error)));
    } finally {
      isBusyExporting = false;
    }
  });

  on(ticketModalCreateBtn, "click", async () => {
    if (isBusyExporting) return;
    isBusyExporting = true;
    try {
      await flushAndSyncBundle();
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
    } finally {
      isBusyExporting = false;
    }
  });

  return () => {
    clearTicketHeightTransition();
    for (const fn of cleanups) fn();
  };
}
