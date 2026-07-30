/**
 * Chrome/Edge Extension i18n helper utility
 */

export function t(key: string, substitutions?: string | string[]): string {
  try {
    if (typeof chrome !== "undefined" && chrome.i18n && typeof chrome.i18n.getMessage === "function") {
      const message = chrome.i18n.getMessage(key, substitutions);
      if (message) return message;
    }
  } catch {
    // Fallback if chrome.i18n is unavailable in non-extension contexts
  }
  return key;
}

export function applyI18n(container: HTMLElement | Document = document): void {
  // Translate text content
  const elements = container.querySelectorAll<HTMLElement>("[data-i18n]");
  elements.forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (key) {
      const translated = t(key);
      if (translated && translated !== key) {
        el.textContent = translated;
      }
    }
  });

  // Translate placeholders
  const placeholderElements = container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-i18n-ph]");
  placeholderElements.forEach((el) => {
    const key = el.getAttribute("data-i18n-ph");
    if (key) {
      const translated = t(key);
      if (translated && translated !== key) {
        el.placeholder = translated;
      }
    }
  });

  // Translate title attributes
  const titleElements = container.querySelectorAll<HTMLElement>("[data-i18n-title]");
  titleElements.forEach((el) => {
    const key = el.getAttribute("data-i18n-title");
    if (key) {
      const translated = t(key);
      if (translated && translated !== key) {
        el.title = translated;
      }
    }
  });
}
