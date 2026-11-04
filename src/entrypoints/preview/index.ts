import { db } from "../../storage/db";
import {
  buildAiPrompt,
  buildTicketTemplate,
  buildTicketBundle,
} from "../../preview/evidence-package";
import { EvidenceReportView } from "../../preview/evidence-report-view";
import { PreviewAiHandoff } from "../../preview/preview-ai-handoff";
import { PreviewExportController } from "../../preview/preview-export-controller";
import { PreviewSessionRuntime } from "../../preview/preview-session-runtime";
import { generatePlaywrightScript } from "../../preview/playwright-generator";
import { highlightJs } from "../../preview/rendering";
import {
  copyTextToClipboard,
  copyRichTextToClipboard,
  copyDataUrlImageToClipboard,
} from "../../preview/clipboard";
import { applyPrivacyBadge } from "../../preview/privacy-badge";
import { bindPlaywrightModalClose } from "../../preview/playwright-modal";
import { applyI18n, getLocale, initI18nPreference, t } from "../../shared/i18n";
import "../../shared/components/truncated-text";

void (async () => {
  await initI18nPreference();
  applyI18n();
  document.documentElement.lang = getLocale();
})();

const $ = <T extends HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
const params = new URLSearchParams(location.search);
const sessionId = params.get("sessionId") ?? undefined;
const autoExport = params.get("autoExport") === "1";
const silentMode = params.get("silent") === "1";
const runtime = new PreviewSessionRuntime(db);

const reportView = new EvidenceReportView(document, {
  mode: "editable",
  getSnapshot: () => runtime.getReportSnapshot(),
  renameSession: (title) => runtime.renameSession(title),
  excludeInteraction: (id) => runtime.excludeInteraction(id),
  excludeIssueScene: (id) => runtime.excludeIssueScene(id),
  excludeDiagnostic: (kind, id) => runtime.excludeDiagnostic(kind, id),
  restore: (kind) => runtime.restore(kind),
});

if (
  typeof chrome !== "undefined" &&
  chrome.storage &&
  chrome.storage.onChanged
) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "sync" && changes["user_language_preference"]) {
      void (async () => {
        await initI18nPreference();
        applyI18n();
        document.documentElement.lang = getLocale();
        reportView.render();
      })();
    }
  });
}

let exportController!: PreviewExportController;
const aiHandoff = new PreviewAiHandoff({
  root: document,
  getArtifact: () => exportController?.currentArtifact,
  getPrompt: (zipPath) => {
    const snapshot = runtime.getPackageSnapshot();
    return snapshot
      ? buildAiPrompt(snapshot, zipPath)
      : t("waitForEvidenceLoad");
  },
  getTicketTemplate: (zipPath) => {
    const snapshot = runtime.getPackageSnapshot();
    return snapshot
      ? buildTicketTemplate(snapshot, zipPath)
      : t("waitForEvidenceLoad");
  },
  getTicketBundle: (zipPath) => {
    const snapshot = runtime.getPackageSnapshot();
    return snapshot
      ? buildTicketBundle(snapshot, zipPath)
      : {
          markdown: t("waitForEvidenceLoad"),
          html: `<p>${t("waitForEvidenceLoad")}</p>`,
        };
  },
  notify: (message) => reportView.notify(message),
});

exportController = new PreviewExportController({
  root: document,
  sessionId,
  storage: db,
  getSnapshot: () => runtime.getPackageSnapshot(),
  getMediaChunkCount: () => runtime.mediaChunks,
  notify: (message) => reportView.notify(message),
  onArtifactChanged: () => aiHandoff.render(),
  beforeExport: () => runtime.waitForSourceMaps(),
  onExportStart: async (mode) => {
    if (mode === "ticket") {
      return await aiHandoff.autoCopyTicketTemplate(true);
    }
    return false;
  },
  onExportComplete: async (mode = "ai") => {
    const copied =
      mode === "ticket"
        ? await aiHandoff.autoCopyTicketTemplate()
        : await aiHandoff.autoCopyPrompt();
    if (silentMode) {
      setTimeout(() => {
        window.close();
      }, 1000);
    }
    return copied;
  },
});

// Playwright 脚本生成
const playwrightModal = document.getElementById(
  "playwright-modal"
) as HTMLElement;
const playwrightOutput = document.getElementById(
  "playwright-script-output"
) as HTMLElement;
const playwrightBtn = document.getElementById(
  "export-playwright"
) as HTMLButtonElement;
const playwrightClose = document.getElementById(
  "playwright-modal-close"
) as HTMLButtonElement;
const playwrightCloseBtn = document.getElementById(
  "playwright-modal-close-btn"
) as HTMLButtonElement;
const playwrightCopy = document.getElementById(
  "playwright-copy"
) as HTMLButtonElement;

function generatePlaywright(): void {
  const snapshot = runtime.getReportSnapshot();
  if (!snapshot) {
    reportView.notify(t("waitForEvidenceLoad"));
    return;
  }
  const script = generatePlaywrightScript({
    session: snapshot.session,
    interactions: snapshot.interactions.included,
    consoleEntries: snapshot.consoleEntries.included,
    networkEntries: snapshot.networkEntries.included,
  });
  playwrightOutput.innerHTML = highlightJs(script);
  playwrightModal.hidden = false;
  const aiDrawer = document.getElementById("ai-drawer");
  if (aiDrawer) aiDrawer.hidden = true;
}

playwrightBtn.addEventListener("click", generatePlaywright);

playwrightClose.addEventListener("click", () => {
  playwrightModal.hidden = true;
});
playwrightCloseBtn.addEventListener("click", () => {
  playwrightModal.hidden = true;
});
playwrightModal.addEventListener("click", (e) => {
  if (e.target === playwrightModal) {
    playwrightModal.hidden = true;
  }
});

// 与其他模态框（图片查看器、快捷键面板）保持一致：Escape 关闭 Playwright 弹窗
bindPlaywrightModalClose(playwrightModal);

playwrightCopy.addEventListener("click", async () => {
  const text = playwrightOutput.textContent;
  if (text) {
    try {
      await copyTextToClipboard(text, document);
      reportView.notify(t("playwrightScriptCopied"));
    } catch (error) {
      reportView.notify(t("copyFailed", String(error)));
    }
  }
});

// 工单草稿图文预览弹窗
const ticketModal = document.getElementById("ticket-modal") as HTMLElement;
const previewTicketBtn = document.getElementById(
  "preview-ticket-btn"
) as HTMLButtonElement | null;
const drawerPreviewTicketBtn = document.getElementById(
  "drawer-preview-ticket"
) as HTMLButtonElement | null;
const ticketClose = document.getElementById(
  "ticket-modal-close"
) as HTMLButtonElement;
const ticketCloseBtn = document.getElementById(
  "ticket-modal-close-btn"
) as HTMLButtonElement;
const ticketTabRich = document.getElementById(
  "ticket-tab-rich"
) as HTMLButtonElement;
const ticketTabPlain = document.getElementById(
  "ticket-tab-plain"
) as HTMLButtonElement;
const ticketRichView = document.getElementById(
  "ticket-rich-view"
) as HTMLElement;
const ticketPlainView = document.getElementById(
  "ticket-plain-view"
) as HTMLElement;
const ticketSummary = document.getElementById(
  "ticket-modal-summary"
) as HTMLElement;
const ticketModalCopyBtn = document.getElementById(
  "ticket-modal-copy-btn"
) as HTMLButtonElement;
const ticketModalCreateBtn = document.getElementById(
  "ticket-modal-create-btn"
) as HTMLButtonElement;

let currentTicketBundle: { markdown: string; html: string } | undefined;

function openTicketPreview(): void {
  const snapshot = runtime.getPackageSnapshot();
  if (!snapshot) {
    reportView.notify(t("waitForEvidenceLoad"));
    return;
  }
  const filename = exportController?.currentArtifact?.filename;
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
    ticketRichView.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
      img.addEventListener("click", async () => {
        try {
          await copyDataUrlImageToClipboard(img.src);
          reportView.notify(t("stepImageCopied"));
        } catch (error) {
          reportView.notify(t("copyFailed", String(error)));
        }
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

  ticketModal.hidden = false;
  const aiDrawer = document.getElementById("ai-drawer");
  if (aiDrawer) aiDrawer.hidden = true;
}

previewTicketBtn?.addEventListener("click", openTicketPreview);
drawerPreviewTicketBtn?.addEventListener("click", openTicketPreview);

let activeHeightTransitionTimeout: number | undefined;

function clearTicketHeightTransition(): void {
  if (activeHeightTransitionTimeout !== undefined) {
    window.clearTimeout(activeHeightTransitionTimeout);
    activeHeightTransitionTimeout = undefined;
  }
  const contentEl = ticketModal.querySelector<HTMLElement>(
    ".ticket-modal-content"
  );
  const bodyEl = ticketModal.querySelector<HTMLElement>(".ticket-modal-body");
  if (contentEl) {
    contentEl.style.height = "";
    contentEl.style.transition = "";
  }
  if (bodyEl) {
    bodyEl.style.overflowY = "";
  }
}

function switchTicketTab(mode: "rich" | "plain"): void {
  const isRich = mode === "rich";
  const currentIsRich = ticketTabRich.classList.contains("active");
  if (isRich === currentIsRich) return;

  const contentEl = ticketModal.querySelector<HTMLElement>(
    ".ticket-modal-content"
  );
  const bodyEl = ticketModal.querySelector<HTMLElement>(".ticket-modal-body");

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
  ticketModal.hidden = true;
}

ticketClose?.addEventListener("click", closeTicketModal);
ticketCloseBtn?.addEventListener("click", closeTicketModal);
ticketModal?.addEventListener("click", (e) => {
  if (e.target === ticketModal) closeTicketModal();
});

bindPlaywrightModalClose(ticketModal);

ticketModalCopyBtn?.addEventListener("click", async () => {
  if (!currentTicketBundle) return;
  try {
    await copyRichTextToClipboard(
      { html: currentTicketBundle.html, text: currentTicketBundle.markdown },
      document
    );
    reportView.notify(t("ticketTemplateCopied"));
  } catch (error) {
    reportView.notify(t("copyFailed", String(error)));
  }
});

ticketModalCreateBtn?.addEventListener("click", async () => {
  if (currentTicketBundle) {
    try {
      await copyRichTextToClipboard(
        { html: currentTicketBundle.html, text: currentTicketBundle.markdown },
        document
      );
    } catch {
      // 忽略
    }
  }
  closeTicketModal();
  void exportController?.export("ticket", { skipClipboard: true });
});

async function loadMediaPreview(): Promise<void> {
  const result = await runtime.loadMediaPreview();
  const video = $("#video") as HTMLVideoElement;
  const empty = $("#video-empty");
  if (result.source) {
    video.src = result.source;
    video.hidden = false;
    empty.hidden = true;
    video.addEventListener(
      "error",
      () => {
        video.hidden = true;
        empty.hidden = false;
        empty.textContent = t("videoDecodeFailedHint");
      },
      { once: true }
    );
    bindSingleSeekbarPlayer();
    return;
  }
  empty.hidden = false;
  empty.textContent = result.error
    ? t("videoLoadFailed", String(result.error))
    : runtime.mediaChunks
      ? t("videoUnreadable")
      : t("noMediaChunks");
}

async function load(): Promise<void> {
  if (!sessionId) {
    $("#meta").textContent = t("missingSessionId");
    return;
  }
  await Promise.all([runtime.load(sessionId), exportController.load()]);
  if (!runtime.currentSession) {
    $("#meta").textContent = t("sessionNotFound");
    return;
  }
  applyPrivacyBadge(document, runtime.currentSession);
  window.addEventListener("beforeunload", () => runtime.dispose(), {
    once: true,
  });
  aiHandoff.render();
  reportView.render();

  if (runtime.mediaChunks) {
    $("#video-empty").textContent = t(
      "loadingVideoChunks",
      String(runtime.mediaChunks)
    );
  }
  void loadMediaPreview().then(() => {
    if (runtime.getReportSnapshot()?.hasMedia) {
      reportView.render(["steps"]);
    }
  });

  void runtime.waitForSourceMaps().then((changed) => {
    if (changed) {
      aiHandoff.render();
      reportView.render(["console", "network", "stream"]);
    }
  });

  if (autoExport) {
    if (exportController.currentArtifact?.state !== "complete") {
      void exportController.export();
    }
    const cleanUrl = new URL(location.href);
    cleanUrl.searchParams.delete("autoExport");
    history.replaceState(null, "", cleanUrl.toString());
  }
}

void load().catch((error) => {
  const messageText = t("previewLoadFailed", String(error));
  $("#meta").textContent = messageText;
  reportView.notify(messageText);
});

function formatTime(seconds: number): string {
  if (!seconds || !isFinite(seconds) || seconds < 0) return "00:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function bindSingleSeekbarPlayer(): void {
  const video = $("#video") as HTMLVideoElement;
  const controls = $("#zen-player-controls") as HTMLDivElement | null;
  const playBtn = $("#play-pause-btn") as HTMLButtonElement | null;
  const playIcon = $("#play-icon") as HTMLElement | null;
  const pauseIcon = $("#pause-icon") as HTMLElement | null;
  const timeText = $("#video-time-text") as HTMLDivElement | null;
  const checkbox = $("#skip-annotation-checkbox") as HTMLInputElement | null;
  const seekbarContainer = $("#zen-seekbar-container") as HTMLDivElement | null;
  const seekbarTrack = $("#seekbar-track") as HTMLDivElement | null;
  const seekbarFill = $("#seekbar-fill") as HTMLDivElement | null;
  const seekbarThumb = $("#seekbar-thumb") as HTMLDivElement | null;

  if (!video || !controls) return;

  if (checkbox) {
    const savedState = localStorage.getItem("bug_lens_skip_annotation");
    if (savedState !== null) checkbox.checked = savedState === "true";
    checkbox.addEventListener("change", () => {
      localStorage.setItem(
        "bug_lens_skip_annotation",
        String(checkbox.checked)
      );
    });
  }

  controls.hidden = false;

  let animFrameId: number | undefined;
  let lastVideoTime = 0;
  let lastWallTime = 0;
  let renderedPercent = 0;

  const updatePlayState = () => {
    if (video.paused) {
      playIcon?.removeAttribute("hidden");
      pauseIcon?.setAttribute("hidden", "");
      seekbarThumb?.classList.remove("is-playing");
      stopRenderLoop();
    } else {
      playIcon?.setAttribute("hidden", "");
      pauseIcon?.removeAttribute("hidden");
      seekbarThumb?.classList.add("is-playing");
      startRenderLoop();
    }
  };

  playBtn?.addEventListener("click", () => {
    if (video.paused) {
      void video.play();
    } else {
      video.pause();
    }
  });

  let segmentsRendered = false;
  let lastScenesRef: unknown;
  let cachedSkipIntervals: Array<{ startSec: number; endSec: number }> = [];

  const getSkipIntervals = () => {
    const snapshot = runtime.getReportSnapshot();
    if (!snapshot) return [];
    const scenes = snapshot.issueScenes?.included ?? [];
    if (scenes === lastScenesRef) {
      return cachedSkipIntervals;
    }
    lastScenesRef = scenes;
    const startedAt = snapshot.session.timeline.startedAtEpochMs;
    if (!startedAt) {
      cachedSkipIntervals = [];
      return cachedSkipIntervals;
    }
    const intervals: Array<{ startSec: number; endSec: number }> = [];
    for (const item of scenes) {
      const scene = "scene" in item ? item.scene : item;
      const startMs =
        scene.selectionStartedAtEpochMs ?? scene.observedAtEpochMs;
      const endMs = scene.committedAtEpochMs;
      if (!startMs || !endMs || endMs <= startMs) continue;
      intervals.push({
        startSec: Math.max(0, (startMs - startedAt) / 1000),
        endSec: (endMs - startedAt) / 1000,
      });
    }
    cachedSkipIntervals = intervals;
    return cachedSkipIntervals;
  };

  const renderYellowSegments = () => {
    if (
      segmentsRendered ||
      !video.duration ||
      !isFinite(video.duration) ||
      !seekbarTrack
    )
      return;
    const snapshot = runtime.getReportSnapshot();
    if (!snapshot) return;
    const startedAt = snapshot.session.timeline.startedAtEpochMs;
    if (!startedAt) return;

    const durationSec = video.duration;
    const scenes = snapshot.issueScenes?.included ?? [];

    seekbarTrack
      .querySelectorAll(".seekbar-yellow-segment")
      .forEach((el) => el.remove());

    for (let index = 0; index < scenes.length; index += 1) {
      const item = scenes[index];
      const scene = "scene" in item ? item.scene : item;
      const startMs =
        scene.selectionStartedAtEpochMs ?? scene.observedAtEpochMs;
      const endMs = scene.committedAtEpochMs;
      if (!startMs || !endMs || endMs <= startMs) continue;

      const startSec = Math.max(0, (startMs - startedAt) / 1000);
      const endSec = Math.min(durationSec, (endMs - startedAt) / 1000);
      if (endSec > startSec) {
        const leftPercent = (startSec / durationSec) * 100;
        const widthPercent = Math.max(
          0.5,
          ((endSec - startSec) / durationSec) * 100
        );

        const segment = document.createElement("div");
        segment.className = "seekbar-yellow-segment";
        segment.style.left = `${leftPercent}%`;
        segment.style.width = `${widthPercent}%`;
        segment.title = t("seekbarSegmentTitle", [
          String(index + 1),
          startSec.toFixed(1),
          endSec.toFixed(1),
        ]);
        seekbarTrack.appendChild(segment);
      }
    }
    segmentsRendered = true;
  };

  video.addEventListener("loadedmetadata", renderYellowSegments);
  video.addEventListener("durationchange", renderYellowSegments);

  const checkAutoSkip = (currentTime: number) => {
    if (!checkbox || !checkbox.checked || video.paused || video.seeking) return;
    const intervals = getSkipIntervals();
    for (let i = 0; i < intervals.length; i += 1) {
      const { startSec, endSec } = intervals[i]!;
      if (currentTime >= startSec && currentTime < endSec - 0.1) {
        video.currentTime = endSec;
        syncTimeAnchor();
        break;
      }
    }
  };

  const syncTimeAnchor = () => {
    lastVideoTime = video.currentTime || 0;
    lastWallTime = performance.now();
  };

  let lastRenderedTimeText = "";

  const applyRenderUI = (time: number, duration: number, percent: number) => {
    if (timeText) {
      const nextTimeText = `${formatTime(time)} / ${formatTime(duration)}`;
      if (nextTimeText !== lastRenderedTimeText) {
        lastRenderedTimeText = nextTimeText;
        timeText.textContent = nextTimeText;
      }
    }
    if (duration > 0) {
      if (seekbarFill) seekbarFill.style.width = `${percent}%`;
      if (seekbarThumb) seekbarThumb.style.left = `${percent}%`;
    }
  };

  let isDragging = false;
  let wasPausedBeforeDrag = true;

  const renderLoop = () => {
    if (
      isDragging ||
      video.paused ||
      video.seeking ||
      !video.duration ||
      !isFinite(video.duration)
    ) {
      animFrameId = undefined;
      return;
    }

    renderYellowSegments();

    const duration = video.duration;
    const now = performance.now();
    const elapsedSec =
      ((now - lastWallTime) / 1000) * (video.playbackRate || 1);
    const estimatedTime = Math.min(
      duration,
      Math.max(0, lastVideoTime + elapsedSec)
    );
    const targetPercent = (estimatedTime / duration) * 100;

    renderedPercent =
      renderedPercent + 0.25 * (targetPercent - renderedPercent);

    applyRenderUI(estimatedTime, duration, renderedPercent);
    checkAutoSkip(estimatedTime);

    animFrameId = requestAnimationFrame(renderLoop);
  };

  const startRenderLoop = () => {
    syncTimeAnchor();
    if (!animFrameId && !isDragging) {
      animFrameId = requestAnimationFrame(renderLoop);
    }
  };

  const stopRenderLoop = () => {
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = undefined;
    }
    const duration = video.duration || 0;
    const current = video.currentTime || 0;
    const percent = duration > 0 ? (current / duration) * 100 : 0;
    renderedPercent = percent;
    applyRenderUI(current, duration, percent);
  };

  video.addEventListener("play", updatePlayState);
  video.addEventListener("pause", updatePlayState);
  video.addEventListener("seeking", () => {
    syncTimeAnchor();
    if (!isDragging) stopRenderLoop();
  });
  video.addEventListener("seeked", () => {
    syncTimeAnchor();
    if (!video.paused && !isDragging) startRenderLoop();
    else stopRenderLoop();
  });
  video.addEventListener("timeupdate", () => {
    syncTimeAnchor();
    if (video.paused && !isDragging) {
      stopRenderLoop();
    }
  });

  updatePlayState();

  const updateDragSeek = (e: MouseEvent) => {
    if (!video.duration || !isFinite(video.duration) || !seekbarContainer)
      return;
    const rect = seekbarContainer.getBoundingClientRect();
    const clickX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const ratio = rect.width > 0 ? clickX / rect.width : 0;
    const seekTime = ratio * video.duration;
    const percent = ratio * 100;

    renderedPercent = percent;
    applyRenderUI(seekTime, video.duration, percent);
    video.currentTime = seekTime;
    syncTimeAnchor();
  };

  const onPointerMove = (e: MouseEvent) => {
    if (!isDragging) return;
    e.preventDefault();
    updateDragSeek(e);
  };

  const onPointerUp = () => {
    if (!isDragging) return;
    isDragging = false;
    seekbarThumb?.classList.remove("is-dragging");
    seekbarContainer?.classList.remove("is-dragging");
    window.removeEventListener("mousemove", onPointerMove);
    window.removeEventListener("mouseup", onPointerUp);
    syncTimeAnchor();
    if (!wasPausedBeforeDrag) {
      void video.play();
    }
  };

  if (seekbarContainer) {
    seekbarContainer.addEventListener("mousedown", (e) => {
      if (!video.duration || !isFinite(video.duration)) return;
      isDragging = true;
      wasPausedBeforeDrag = video.paused;
      seekbarThumb?.classList.add("is-dragging");
      seekbarContainer.classList.add("is-dragging");
      video.pause();
      updateDragSeek(e);
      window.addEventListener("mousemove", onPointerMove);
      window.addEventListener("mouseup", onPointerUp);
    });
  }

  // 视频播放器键盘快捷键控制与 HUD 提示系统
  const videoContainer = video.closest(
    ".zen-video-container"
  ) as HTMLElement | null;
  if (videoContainer && !videoContainer.hasAttribute("tabindex")) {
    videoContainer.setAttribute("tabindex", "0");
  }

  let hudTimer: ReturnType<typeof setTimeout> | undefined;
  let hudEl = videoContainer?.querySelector<HTMLElement>(".zen-video-hud");
  if (!hudEl && videoContainer) {
    hudEl = document.createElement("div");
    hudEl.className = "zen-video-hud";
    videoContainer.appendChild(hudEl);
  }

  const showHud = (text: string) => {
    if (!hudEl) return;
    hudEl.textContent = text;
    hudEl.classList.add("is-visible");
    if (hudTimer) clearTimeout(hudTimer);
    hudTimer = setTimeout(() => {
      hudEl?.classList.remove("is-visible");
    }, 800);
  };

  const togglePlay = () => {
    if (video.paused) {
      void video.play();
      showHud(t("hudPlay"));
    } else {
      video.pause();
      showHud(t("hudPause"));
    }
  };

  video.addEventListener("click", () => {
    videoContainer?.focus();
    togglePlay();
  });

  video.addEventListener("dblclick", () => {
    if (!document.fullscreenElement) {
      void videoContainer?.requestFullscreen().catch(() => undefined);
      showHud(t("hudFullscreen"));
    } else {
      void document.exitFullscreen().catch(() => undefined);
      showHud(t("hudExitFullscreen"));
    }
  });

  // 全屏按钮
  const fullscreenBtn = document.getElementById(
    "fullscreen-btn"
  ) as HTMLButtonElement | null;
  const fullscreenIcon = document.getElementById(
    "fullscreen-icon"
  ) as HTMLElement | null;
  const fullscreenExitIcon = document.getElementById(
    "fullscreen-exit-icon"
  ) as HTMLElement | null;

  const updateFullscreenUI = () => {
    const isFullscreen = !!document.fullscreenElement;
    if (fullscreenIcon) fullscreenIcon.hidden = isFullscreen;
    if (fullscreenExitIcon) fullscreenExitIcon.hidden = !isFullscreen;
    fullscreenBtn?.classList.toggle("active", isFullscreen);
    fullscreenBtn?.setAttribute(
      "title",
      isFullscreen ? t("exitFullscreenEsc") : t("enterFullscreenDblclick")
    );
  };

  fullscreenBtn?.addEventListener("click", () => {
    if (!document.fullscreenElement) {
      void videoContainer?.requestFullscreen().catch(() => undefined);
    } else {
      void document.exitFullscreen().catch(() => undefined);
    }
  });

  document.addEventListener("fullscreenchange", updateFullscreenUI);

  window.addEventListener("keydown", (e: KeyboardEvent) => {
    const active = document.activeElement as HTMLElement | null;
    // 屏蔽在输入框、文本域或富文本编辑区打字时的快捷键
    if (
      active &&
      (active.tagName === "INPUT" ||
        active.tagName === "TEXTAREA" ||
        active.tagName === "SELECT" ||
        active.isContentEditable)
    ) {
      return;
    }

    const isVideoFocused = !!(
      videoContainer &&
      (videoContainer === active || videoContainer.contains(active))
    );
    if (!isVideoFocused) return;

    const code = e.code;
    if (code === "Space") {
      e.preventDefault();
      togglePlay();
    } else if (code === "ArrowLeft" || code === "ArrowRight") {
      e.preventDefault();
      const delta = e.shiftKey ? 1 : 5;
      const step = code === "ArrowLeft" ? -delta : delta;
      const target = Math.max(
        0,
        Math.min(video.duration || 0, (video.currentTime || 0) + step)
      );
      video.currentTime = target;
      syncTimeAnchor();
      showHud(step > 0 ? `» +${delta}s` : `« -${delta}s`);
    }
  });
}

import { bindShortcutsPanel } from "../../preview/shortcuts-panel.ts";

bindShortcutsPanel();
