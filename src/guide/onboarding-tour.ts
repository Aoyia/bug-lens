import { t } from "../shared/i18n.ts";

export async function tryShowOnboardingGuide(
  widgetContainer: HTMLElement
): Promise<void> {
  try {
    // 自动化测试检测：当在 WebDriver (Playwright / Puppeteer / Selenium) 驱动的环境下运行，自动跳过新手引导
    if (typeof navigator !== "undefined" && navigator.webdriver) return;

    if (typeof chrome === "undefined" || !chrome.storage?.local) return;
    const storage = (await chrome.storage.local
      .get(["hasCompletedGuide", "skipOnboardingGuide"])
      .catch(() => ({}))) as {
      hasCompletedGuide?: boolean;
      skipOnboardingGuide?: boolean;
    };
    if (storage?.hasCompletedGuide || storage?.skipOnboardingGuide) return;

    if (!widgetContainer || !widgetContainer.isConnected) return;

    const existing = document.getElementById("__wbr_guide_overlay__");
    if (existing) existing.remove();

    const guideOverlay = document.createElement("div");
    guideOverlay.id = "__wbr_guide_overlay__";
    guideOverlay.setAttribute("data-wbr-ignore", "true");

    Object.assign(guideOverlay.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483647",
      pointerEvents: "auto",
      userSelect: "none",
      fontFamily:
        "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    });

    const shadow = guideOverlay.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = `
      :host { all: initial; }
      .spotlight {
        position: fixed;
        border-radius: 6px;
        box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.65), 0 0 20px rgba(22, 93, 255, 0.85);
        border: 2px solid #165dff;
        pointer-events: none;
        transition: all 0.25s cubic-bezier(0.25, 1, 0.5, 1);
        z-index: 1;
      }
      .popover {
        position: fixed;
        width: 305px;
        padding: 18px;
        background: #ffffff;
        color: #1d2129;
        border-radius: 10px;
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
        z-index: 2;
        transition: all 0.25s cubic-bezier(0.25, 1, 0.5, 1);
        box-sizing: border-box;
      }
      .popover::after {
        content: "";
        position: absolute;
        width: 0;
        height: 0;
        border-style: solid;
      }
      .popover.arrow-right::after {
        right: -8px;
        top: var(--arrow-top, 50%);
        transform: translateY(-50%);
        border-width: 7px 0 7px 8px;
        border-color: transparent transparent transparent #ffffff;
      }
      .popover.arrow-bottom::after {
        bottom: -8px;
        right: var(--arrow-right, 30px);
        border-width: 8px 7px 0 7px;
        border-color: #ffffff transparent transparent transparent;
      }
      .popover.arrow-top::after {
        top: -8px;
        right: var(--arrow-right, 30px);
        border-width: 0 7px 8px 7px;
        border-color: transparent transparent #ffffff transparent;
      }
      .popover.position-center::after {
        display: none;
      }
      .popover-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 8px;
      }
      .popover-title {
        font-size: 15px;
        font-weight: 700;
        color: #1d2129;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .popover-step {
        font-size: 12px;
        color: #86909c;
        font-weight: 600;
        background: #f2f3f5;
        padding: 2px 8px;
        border-radius: 10px;
      }
      .popover-body {
        font-size: 13.5px;
        line-height: 1.65;
        color: #4e5969;
        margin-bottom: 16px;
      }
      .popover-actions {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .btn-skip {
        background: transparent;
        border: none;
        color: #86909c;
        font-size: 13px;
        cursor: pointer;
        padding: 4px 6px;
      }
      .btn-skip:hover { color: #1d2129; }
      .btn-next {
        background: #165dff;
        border: none;
        color: #ffffff;
        font-size: 13px;
        font-weight: 600;
        padding: 7px 18px;
        border-radius: 6px;
        cursor: pointer;
        transition: background 0.15s ease;
      }
      .btn-next:hover { background: #4080ff; }
    `;

    const spotlight = document.createElement("div");
    spotlight.className = "spotlight";

    const popover = document.createElement("div");
    popover.className = "popover";

    shadow.append(style, spotlight, popover);
    document.documentElement.appendChild(guideOverlay);

    const steps: Array<{
      targetSelector: string;
      title: string;
      desc: string;
      position?: "center" | "extension-icon";
    }> = [
      {
        targetSelector: "#__wbr_issue_btn__",
        title: t("guideStep1Title"),
        desc: t("guideStep1Desc"),
      },
      {
        targetSelector: "#__wbr_timer_display__",
        title: t("guideStep2Title"),
        desc: t("guideStep2Desc"),
      },
      {
        targetSelector: "",
        title: t("guideStep3Title"),
        desc: t("guideStep3Desc"),
        position: "extension-icon",
      },
    ];

    let activeResizeListener: (() => void) | undefined;
    let activeResizeObserver: ResizeObserver | undefined;

    const finishGuide = async () => {
      if (activeResizeListener) {
        window.removeEventListener("resize", activeResizeListener);
        window.removeEventListener("scroll", activeResizeListener);
        activeResizeListener = undefined;
      }
      if (activeResizeObserver) {
        activeResizeObserver.disconnect();
        activeResizeObserver = undefined;
      }
      guideOverlay.remove();
      await chrome.storage.local
        .set({ hasCompletedGuide: true })
        .catch(() => undefined);
    };

    let currentStepIndex = 0;

    const getTargetElement = (selector: string): HTMLElement | null => {
      if (!selector || !widgetContainer) return null;
      if (widgetContainer.matches(selector)) return widgetContainer;
      return widgetContainer.querySelector<HTMLElement>(selector);
    };

    const updatePosition = () => {
      const step = steps[currentStepIndex];
      if (!step) return;

      if (step.position === "extension-icon") {
        const popoverWidth = 305;
        const iconSize = 36;
        const iconTop = 8;
        const iconRight = 48;
        const iconLeft = window.innerWidth - iconRight - iconSize;

        Object.assign(spotlight.style, {
          left: `${iconLeft}px`,
          top: `${iconTop}px`,
          width: `${iconSize}px`,
          height: `${iconSize}px`,
          borderRadius: "50%",
          boxShadow:
            "0 0 0 9999px rgba(0, 0, 0, 0.65), 0 0 20px rgba(22, 93, 255, 0.9)",
          border: "2px solid #165dff",
        });

        popover.className = "popover arrow-top";
        const popoverLeft = window.innerWidth - popoverWidth - 16;
        const popoverTop = iconTop + iconSize + 14;

        const targetCenterX = iconLeft + iconSize / 2;
        const arrowRight = Math.max(
          16,
          Math.min(
            popoverWidth - 24,
            popoverLeft + popoverWidth - targetCenterX
          )
        );
        popover.style.setProperty("--arrow-right", `${arrowRight}px`);

        Object.assign(popover.style, {
          left: `${popoverLeft}px`,
          top: `${popoverTop}px`,
          transform: "none",
        });
        return;
      }

      if (step.position === "center") {
        popover.className = "popover position-center";
        Object.assign(popover.style, {
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
        });

        const popoverWidth = 305;
        const popoverHeight = popover.offsetHeight || 140;
        const centerX = (window.innerWidth - popoverWidth) / 2;
        const centerY = (window.innerHeight - popoverHeight) / 2;

        Object.assign(spotlight.style, {
          left: `${centerX}px`,
          top: `${centerY}px`,
          width: `${popoverWidth}px`,
          height: `${popoverHeight}px`,
          borderRadius: "10px",
          boxShadow:
            "0 0 0 9999px rgba(0, 0, 0, 0.65), 0 0 24px rgba(22, 93, 255, 0.9)",
          border: "2px solid #165dff",
        });
        return;
      }

      const targetEl = getTargetElement(step.targetSelector);
      if (!targetEl) return;

      const rect = targetEl.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      const pad = 6;
      Object.assign(spotlight.style, {
        left: `${Math.max(0, rect.left - pad)}px`,
        top: `${Math.max(0, rect.top - pad)}px`,
        width: `${rect.width + pad * 2}px`,
        height: `${rect.height + pad * 2}px`,
        borderRadius: "6px",
        boxShadow:
          "0 0 0 9999px rgba(0, 0, 0, 0.65), 0 0 20px rgba(22, 93, 255, 0.85)",
        border: "2px solid #165dff",
      });

      const popoverWidth = 305;
      const popoverHeight = popover.offsetHeight || 140;

      let popoverLeft = rect.left - popoverWidth - 14;
      let popoverTop = rect.top + rect.height / 2 - popoverHeight / 2;
      let arrowClass = "arrow-right";

      // If left side has enough space
      if (popoverLeft >= 16) {
        // Enforce at least 24px safety margin from bottom of viewport
        const maxTop = window.innerHeight - popoverHeight - 24;
        if (popoverTop > maxTop) {
          popoverTop = Math.max(16, maxTop);
        }
        if (popoverTop < 16) popoverTop = 16;

        const targetCenterY = rect.top + rect.height / 2;
        const arrowTop = Math.max(
          18,
          Math.min(popoverHeight - 18, targetCenterY - popoverTop)
        );
        popover.style.setProperty("--arrow-top", `${arrowTop}px`);
      } else {
        // Fallback to top of element
        popoverLeft = Math.max(
          16,
          Math.min(
            window.innerWidth - popoverWidth - 16,
            rect.left + rect.width / 2 - popoverWidth / 2
          )
        );
        popoverTop = Math.max(
          16,
          Math.min(
            window.innerHeight - popoverHeight - 24,
            rect.top - popoverHeight - 14
          )
        );
        arrowClass = "arrow-bottom";

        const targetCenterX = rect.left + rect.width / 2;
        const arrowRight = Math.max(
          16,
          Math.min(
            popoverWidth - 24,
            popoverLeft + popoverWidth - targetCenterX
          )
        );
        popover.style.setProperty("--arrow-right", `${arrowRight}px`);
      }

      popover.className = `popover ${arrowClass}`;
      Object.assign(popover.style, {
        left: `${popoverLeft}px`,
        top: `${popoverTop}px`,
        transform: "none",
      });
    };

    const renderStep = (index: number) => {
      currentStepIndex = index;
      const step = steps[index];
      const targetEl = getTargetElement(step.targetSelector);
      if (!step.position && !targetEl) {
        if (index < steps.length - 1) renderStep(index + 1);
        else void finishGuide();
        return;
      }

      const isLast = index === steps.length - 1;
      popover.innerHTML = `
        <div class="popover-header">
          <span class="popover-title">${step.title}</span>
          <span class="popover-step">${index + 1}/${steps.length}</span>
        </div>
        <div class="popover-body">${step.desc}</div>
        <div class="popover-actions">
          <button class="btn-skip">${t("guideSkip")}</button>
          <button class="btn-next">${isLast ? t("guideGotIt") : t("guideNext")}</button>
        </div>
      `;

      updatePosition();

      popover
        .querySelector(".btn-skip")
        ?.addEventListener("click", () => void finishGuide());
      popover.querySelector(".btn-next")?.addEventListener("click", () => {
        if (isLast) void finishGuide();
        else renderStep(index + 1);
      });
    };

    activeResizeListener = () => updatePosition();
    window.addEventListener("resize", activeResizeListener, { passive: true });
    window.addEventListener("scroll", activeResizeListener, { passive: true });
    if (typeof ResizeObserver !== "undefined") {
      activeResizeObserver = new ResizeObserver(() => updatePosition());
      activeResizeObserver.observe(document.body);
      if (widgetContainer) activeResizeObserver.observe(widgetContainer);
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        renderStep(0);
      });
    });
  } catch {
    // Graceful fallback: non-intrusive
  }
}
