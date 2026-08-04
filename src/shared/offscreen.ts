let ensureLock: Promise<void> | undefined;

export async function ensureOffscreenDocument(
  reasons: chrome.offscreen.Reason[] = ["BLOBS" as chrome.offscreen.Reason]
): Promise<void> {
  if (ensureLock) return ensureLock;
  ensureLock = (async () => {
    try {
      const contexts = await (
        chrome.runtime.getContexts as unknown as (
          filter: unknown
        ) => Promise<chrome.runtime.ExtensionContext[]>
      )({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
      if (contexts.length) return;
      await chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons,
        justification:
          "Record the selected tab, render issue scene screenshots, and export silent ZIP archives locally.",
      });
    } finally {
      ensureLock = undefined;
    }
  })();
  return ensureLock;
}
