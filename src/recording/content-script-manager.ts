import { message } from "../shared/protocol.ts";

const SCRIPT_ID = "web-bug-recorder-content";

export class ContentScriptManager {
  private registered = false;

  async activate(tabId: number): Promise<void> {
    await this.ensureRegistered();
    await chrome.scripting
      .executeScript({
        target: { tabId, allFrames: true },
        files: ["content.js"],
      })
      .catch(() => undefined);
  }

  async restore(tabId: number): Promise<void> {
    // A navigation destroys the document and every content-script instance in
    // it, even when the dynamic registration itself is still present. Always
    // execute the script for the current document as a deterministic fallback
    // (the script is idempotent and performs a content/hello handshake).
    await this.ensureRegistered();
    await chrome.scripting
      .executeScript({
        target: { tabId, allFrames: true },
        files: ["content.js"],
      })
      .catch(() => undefined);
  }

  async remove(tabId?: number): Promise<void> {
    if (typeof tabId === "number") {
      await chrome.tabs
        .sendMessage(tabId, message("content/reset", {}))
        .catch(() => undefined);
    }
    const registrations = await chrome.scripting
      .getRegisteredContentScripts({ ids: [SCRIPT_ID] })
      .catch(() => []);
    if (this.registered || registrations.length) {
      await chrome.scripting
        .unregisterContentScripts({ ids: [SCRIPT_ID] })
        .catch(() => undefined);
    }
    this.registered = false;
  }

  private async ensureRegistered(): Promise<void> {
    if (!this.registered) {
      try {
        await chrome.scripting.registerContentScripts([
          {
            id: SCRIPT_ID,
            js: ["content.js"],
            matches: ["http://*/*", "https://*/*"],
            allFrames: true,
            runAt: "document_start",
            persistAcrossSessions: false,
          },
        ]);
      } catch (error) {
        if (!String(error).includes("already exists")) this.registered = false;
      }
      if (!this.registered) {
        const registrations = await chrome.scripting
          .getRegisteredContentScripts({ ids: [SCRIPT_ID] })
          .catch(() => []);
        this.registered = registrations.length > 0;
      }
    }
  }
}
