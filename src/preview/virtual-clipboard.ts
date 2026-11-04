let virtualClipboardText = "";
let virtualClipboardBlob: Blob | null = null;

export function syncVirtualClipboard(text: string): void {
  virtualClipboardText = text;
  if (typeof globalThis !== "undefined") {
    (globalThis as any).__BUG_LENS_VIRTUAL_CLIPBOARD__ = text;
  }
}

export function syncVirtualBlob(blob: Blob): void {
  virtualClipboardBlob = blob;
}

export function getVirtualClipboardText(): string {
  if (
    typeof globalThis !== "undefined" &&
    (globalThis as any).__BUG_LENS_VIRTUAL_CLIPBOARD__ !== undefined
  ) {
    return String((globalThis as any).__BUG_LENS_VIRTUAL_CLIPBOARD__);
  }
  return virtualClipboardText;
}

export function isE2eAutomationActive(): boolean {
  return typeof navigator !== "undefined" && Boolean(navigator.webdriver);
}

export function installVirtualClipboardHooks(): void {
  if (typeof navigator === "undefined" || !navigator.clipboard) return;
  try {
    const cb = navigator.clipboard as any;
    if (cb.__bugLensVirtualInstalled) return;

    const originalReadText = cb.readText?.bind(cb);
    const originalWriteText = cb.writeText?.bind(cb);
    const originalWrite = cb.write?.bind(cb);

    const safeReadText = async () => {
      if (isE2eAutomationActive()) {
        return getVirtualClipboardText();
      }
      return originalReadText ? await originalReadText() : "";
    };

    const safeWriteText = async (text: string) => {
      if (isE2eAutomationActive()) {
        syncVirtualClipboard(String(text));
        return;
      }
      return originalWriteText ? await originalWriteText(text) : undefined;
    };

    const safeWrite = async (items: ClipboardItem[]) => {
      if (isE2eAutomationActive()) {
        for (const item of items) {
          if (item.types?.includes("text/plain")) {
            const blob = await item.getType("text/plain");
            const text = await blob.text();
            syncVirtualClipboard(text);
            break;
          }
        }
        return;
      }
      return originalWrite ? await originalWrite(items) : undefined;
    };

    try {
      cb.readText = safeReadText;
      cb.writeText = safeWriteText;
      cb.write = safeWrite;
    } catch {
      Object.defineProperty(cb, "readText", {
        value: safeReadText,
        configurable: true,
        writable: true,
      });
      Object.defineProperty(cb, "writeText", {
        value: safeWriteText,
        configurable: true,
        writable: true,
      });
      Object.defineProperty(cb, "write", {
        value: safeWrite,
        configurable: true,
        writable: true,
      });
    }

    cb.__bugLensVirtualInstalled = true;
  } catch {
    // 忽略特定沙箱环境不可配置错误
  }
}
