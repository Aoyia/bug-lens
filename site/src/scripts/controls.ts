import { PROMPTS, type PromptMode } from "../data/prompts";
import type { Locale } from "../data/site";

function getDocumentLocale(): Locale {
  return document.documentElement.lang.toLowerCase().startsWith("zh")
    ? "zh"
    : "en";
}

function isEdgeBrowser(): boolean {
  return /\bEdg\//.test(navigator.userAgent || "");
}

export function initInstallChannels(): void {
  if (!isEdgeBrowser()) return;

  const primaryBtn = document.getElementById(
    "primaryInstallBtn"
  ) as HTMLAnchorElement | null;
  const primaryLabel = document.getElementById("primaryInstallLabel");
  const iconChrome = document.getElementById("installIconChrome");
  const iconEdge = document.getElementById("installIconEdge");
  const altLink = document.getElementById(
    "altStoreLink"
  ) as HTMLAnchorElement | null;

  if (primaryBtn?.dataset.edgeUrl) {
    primaryBtn.href = primaryBtn.dataset.edgeUrl;
  }
  if (primaryLabel && primaryBtn?.dataset.edgeLabel) {
    primaryLabel.textContent = primaryBtn.dataset.edgeLabel;
  }
  iconChrome?.setAttribute("hidden", "");
  iconEdge?.removeAttribute("hidden");

  if (altLink?.dataset.chromeUrl) {
    altLink.href = altLink.dataset.chromeUrl;
  }
  if (altLink?.dataset.chromeLabel) {
    altLink.textContent = altLink.dataset.chromeLabel;
  }
}

function bindTabGroup(
  attrName: string,
  panelAttrName: string | null,
  onSelect?: (target: string) => void
): void {
  const tabs = document.querySelectorAll<HTMLElement>(`[${attrName}]`);
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const target = tab.getAttribute(attrName) || "";
      tabs.forEach((item) => {
        const isSelected = item.getAttribute(attrName) === target;
        item.classList.toggle("active", isSelected);
        item.setAttribute("aria-selected", isSelected ? "true" : "false");
      });

      if (panelAttrName) {
        const panels = document.querySelectorAll<HTMLElement>(
          `[${panelAttrName}]`
        );
        panels.forEach((panel) => {
          panel.hidden = panel.getAttribute(panelAttrName) !== target;
        });
      }

      if (onSelect) onSelect(target);
    });
  });
}

export function initTabs(): void {
  bindTabGroup("data-shot-tab", "data-shot-panel");

  const promptDisplay = document.getElementById("rawPromptDisplay");
  const locale = getDocumentLocale();
  bindTabGroup("data-prompt-mode", null, (mode) => {
    if (!promptDisplay) return;
    const key: PromptMode = mode === "full" ? "full" : "compact";
    const bucket = PROMPTS[key] || PROMPTS.compact;
    promptDisplay.textContent = bucket[locale] || bucket.en;
  });
}

export function initNavigationAndDrawer(): void {
  const menuBtn = document.getElementById("mobileMenuBtn");
  const menuPanel = document.getElementById("mobileNavPanel");
  const drawer = document.getElementById("changelogDrawer");
  const overlay = document.getElementById("changelogDrawerOverlay");
  const drawerCloseBtn = document.getElementById("changelogDrawerClose");

  let lastFocusedEl: HTMLElement | null = null;

  function closeMobileNav(): void {
    if (!menuBtn || !menuPanel) return;
    menuPanel.hidden = true;
    menuBtn.setAttribute("aria-expanded", "false");
  }

  function openChangelogDrawer(): void {
    if (!drawer || !overlay) return;
    lastFocusedEl =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    drawer.classList.add("open");
    overlay.classList.add("open");
    drawer.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    closeMobileNav();

    if (drawerCloseBtn) {
      window.setTimeout(() => {
        drawerCloseBtn.focus();
      }, 60);
    }
  }

  function closeChangelogDrawer(): void {
    if (!drawer || !overlay) return;
    if (!drawer.classList.contains("open")) return;
    drawer.classList.remove("open");
    overlay.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    if (lastFocusedEl && typeof lastFocusedEl.focus === "function") {
      lastFocusedEl.focus();
      lastFocusedEl = null;
    }
  }

  if (menuBtn && menuPanel) {
    menuBtn.addEventListener("click", () => {
      const nextOpen = menuPanel.hidden;
      menuPanel.hidden = !nextOpen;
      menuBtn.setAttribute("aria-expanded", nextOpen ? "true" : "false");
    });

    menuPanel.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", closeMobileNav);
    });
  }

  document.querySelectorAll("[data-open-changelog]").forEach((trigger) => {
    trigger.addEventListener("click", (e) => {
      e.preventDefault();
      openChangelogDrawer();
    });
  });

  overlay?.addEventListener("click", closeChangelogDrawer);
  drawerCloseBtn?.addEventListener("click", closeChangelogDrawer);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeChangelogDrawer();
      closeMobileNav();
    }
  });

  if (window.location.hash === "#changelog") {
    window.setTimeout(openChangelogDrawer, 250);
  }
}
