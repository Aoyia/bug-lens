import { t } from "./i18n.ts";

// 并发去重锁：同一时刻只允许一次 offscreen 文档创建流程
let ensureLock: Promise<void> | undefined;

export async function ensureOffscreenDocument(
  reasons: chrome.offscreen.Reason[] = ["BLOBS" as chrome.offscreen.Reason]
): Promise<void> {
  // 已有创建流程进行中则直接复用，避免重复创建
  if (ensureLock) return ensureLock;
  ensureLock = (async () => {
    try {
      const contexts = await (
        chrome.runtime.getContexts as unknown as (
          filter: unknown
        ) => Promise<chrome.runtime.ExtensionContext[]>
      )({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
      // 文档已存在则跳过创建
      if (contexts.length) return;
      await chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons,
        justification: t("offscreenJustification"),
      });
    } finally {
      // 无论成败都释放锁，允许后续重新创建
      ensureLock = undefined;
    }
  })();
  return ensureLock;
}
