import { db } from "../../storage/db";
import { buildAiPrompt } from "../../preview/evidence-package";
import { EvidenceReportView } from "../../preview/evidence-report-view";
import { PreviewAiHandoff } from "../../preview/preview-ai-handoff";
import { PreviewExportController } from "../../preview/preview-export-controller";
import { PreviewSessionRuntime } from "../../preview/preview-session-runtime";
import { generatePlaywrightScript } from "../../preview/playwright-generator";
import { highlightJs } from "../../preview/rendering";
import { copyTextToClipboard } from "../../preview/clipboard";
import { applyPrivacyBadge } from "../../preview/privacy-badge";
import { applyI18n } from "../../shared/i18n";
import "../../shared/components/truncated-text";

applyI18n();

const $ = <T extends HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
const params = new URLSearchParams(location.search);
const sessionId = params.get("sessionId") || undefined;
const autoExport = params.get("autoExport") === "1";
const silentMode = params.get("silent") === "1";
const runtime = new PreviewSessionRuntime(db);

const reportView = new EvidenceReportView(document, {
  mode: "editable",
  getSnapshot: () => runtime.getReportSnapshot(),
  excludeInteraction: (id) => runtime.excludeInteraction(id),
  excludeIssueScene: (id) => runtime.excludeIssueScene(id),
  excludeDiagnostic: (kind, id) => runtime.excludeDiagnostic(kind, id),
  restore: (kind) => runtime.restore(kind),
});

let exportController!: PreviewExportController;
const aiHandoff = new PreviewAiHandoff({
  root: document,
  getArtifact: () => exportController?.currentArtifact,
  getPrompt: (zipPath) => {
    const snapshot = runtime.getPackageSnapshot();
    return snapshot
      ? buildAiPrompt(snapshot, zipPath)
      : "请先等待证据预览加载完成。";
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
  onExportComplete: async () => {
    const copied = await aiHandoff.autoCopyPrompt();
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
    reportView.notify("请先等待证据预览加载完成");
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

playwrightCopy.addEventListener("click", async () => {
  const text = playwrightOutput.textContent;
  if (text) {
    try {
      await copyTextToClipboard(text, document);
      reportView.notify("Playwright 脚本已复制");
    } catch (error) {
      reportView.notify(`复制失败：${String(error)}`);
    }
  }
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
        empty.textContent =
          "录像文件无法解码。若它来自修复前的录制，请重新录制一小段。";
      },
      { once: true }
    );
    bindSingleSeekbarPlayer();
    return;
  }
  empty.hidden = false;
  empty.textContent = result.error
    ? `录像加载失败：${result.error}`
    : runtime.mediaChunks
      ? "录像文件无法读取；交互和调试证据仍可查看。"
      : "没有可播放的媒体分片；交互和调试证据仍可查看。";
}

async function load(): Promise<void> {
  if (!sessionId) {
    $("#meta").textContent = "缺少会话 ID";
    return;
  }
  await runtime.load(sessionId);
  if (!runtime.currentSession) {
    $("#meta").textContent = "找不到会话";
    return;
  }
  applyPrivacyBadge(document, runtime.currentSession);
  await exportController.load();
  if (runtime.mediaChunks) {
    $("#video-empty").textContent =
      `正在加载录像（${runtime.mediaChunks} 个分片）…`;
    await loadMediaPreview();
  } else {
    await loadMediaPreview();
  }
  window.addEventListener("beforeunload", () => runtime.dispose(), {
    once: true,
  });
  aiHandoff.render();
  reportView.render();
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
  $("#meta").textContent = `预览加载失败：${String(error)}`;
  reportView.notify(`预览加载失败：${String(error)}`);
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
        segment.title = `截图批注 #${index + 1} (${startSec.toFixed(1)}s - ${endSec.toFixed(1)}s)`;
        seekbarTrack.appendChild(segment);
      }
    }
    segmentsRendered = true;
  };

  video.addEventListener("loadedmetadata", renderYellowSegments);
  video.addEventListener("durationchange", renderYellowSegments);

  const checkAutoSkip = (currentTime: number) => {
    if (!checkbox || !checkbox.checked || video.paused || video.seeking) return;
    const snapshot = runtime.getReportSnapshot();
    if (!snapshot) return;
    const startedAt = snapshot.session.timeline.startedAtEpochMs;
    if (!startedAt) return;

    const scenes = snapshot.issueScenes?.included ?? [];
    for (const item of scenes) {
      const scene = "scene" in item ? item.scene : item;
      const startMs =
        scene.selectionStartedAtEpochMs ?? scene.observedAtEpochMs;
      const endMs = scene.committedAtEpochMs;
      if (!startMs || !endMs || endMs <= startMs) continue;

      const startSec = Math.max(0, (startMs - startedAt) / 1000);
      const endSec = (endMs - startedAt) / 1000;

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

  const applyRenderUI = (time: number, duration: number, percent: number) => {
    if (timeText) {
      timeText.textContent = `${formatTime(time)} / ${formatTime(duration)}`;
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
      showHud("播放");
    } else {
      video.pause();
      showHud("暂停");
    }
  };

  video.addEventListener("click", () => {
    videoContainer?.focus();
    togglePlay();
  });

  video.addEventListener("dblclick", () => {
    if (!document.fullscreenElement) {
      void videoContainer?.requestFullscreen().catch(() => undefined);
      showHud("全屏");
    } else {
      void document.exitFullscreen().catch(() => undefined);
      showHud("退出全屏");
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
      isFullscreen ? "退出全屏 (Esc)" : "全屏 (双击视频)"
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
