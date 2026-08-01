import type { CDPSession } from "@playwright/test";

type TargetInfo = {
  targetId: string;
  type: string;
  url: string;
};

type CdpMessage = { id?: number; result?: unknown; error?: { message?: string } };

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function poll<T>(read: () => Promise<T>, accept: (value: T) => boolean, timeoutMs: number, label: string): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last!: T;
  while (Date.now() < deadline) {
    last = await read();
    if (accept(last)) return last;
    await delay(50);
  }
  throw new Error(`${label}: ${JSON.stringify(last)}`);
}

export class CdpPopup {
  private nextMessageId = 0;
  private readonly pending = new Map<number, { resolve: (message: CdpMessage) => void; reject: (error: unknown) => void }>();
  private readonly onMessage = (event: { sessionId?: string; message?: string }) => {
    if (event.sessionId !== this.sessionId || !event.message) return;
    let message: CdpMessage;
    try {
      message = JSON.parse(event.message) as CdpMessage;
    } catch {
      return;
    }
    if (!message.id) return;
    const waiter = this.pending.get(message.id);
    if (!waiter) return;
    this.pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message || "Popup CDP command failed"));
    else waiter.resolve(message);
  };

  constructor(
    private readonly browserCdp: CDPSession,
    private readonly sessionId: string,
    readonly url: string
  ) {
    this.browserCdp.on("Target.receivedMessageFromTarget", this.onMessage);
  }

  private async send<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = ++this.nextMessageId;
    const message = await new Promise<CdpMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`ACTION_POPUP_CDP_TIMEOUT: ${method}`));
      }, 5_000);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); }
      });
      void this.browserCdp.send("Target.sendMessageToTarget", {
        sessionId: this.sessionId,
        message: JSON.stringify({ id, method, params })
      }).catch((error) => {
        this.pending.delete(id);
        reject(error);
      });
    });
    return (message.result ?? {}) as T;
  }

  async waitForSelector(selector: string, timeoutMs = 5_000): Promise<void> {
    await poll(
      () => this.evaluate<boolean>(`Boolean(document.querySelector(${JSON.stringify(selector)}))`),
      Boolean,
      timeoutMs,
      `ACTION_POPUP_SELECTOR_TIMEOUT: ${selector}`
    );
  }

  async isVisible(selector: string): Promise<boolean> {
    return this.evaluate<boolean>(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!(element instanceof HTMLElement)) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    })()`);
  }

  async text(selector: string): Promise<string> {
    return this.evaluate<string>(`document.querySelector(${JSON.stringify(selector)})?.textContent?.trim() || ""`);
  }

  async click(selector: string): Promise<void> {
    const box = await this.evaluate<{ x: number; y: number } | null>(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!(element instanceof HTMLElement)) return null;
      const rect = element.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    if (!box) throw new Error(`ACTION_POPUP_SELECTOR_MISSING: ${selector}`);
    await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", clickCount: 1 });
    await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x, y: box.y, button: "left", clickCount: 1 });
  }

  async evaluate<T>(expression: string): Promise<T> {
    const result = await this.send<{ result?: { value?: T; unserializableValue?: string } }>("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    const remote = result.result;
    if (remote && "value" in remote) return remote.value as T;
    if (remote?.unserializableValue !== undefined) return JSON.parse(remote.unserializableValue) as T;
    return undefined as T;
  }

  async dispose(): Promise<void> {
    this.browserCdp.off("Target.receivedMessageFromTarget", this.onMessage);
    for (const waiter of this.pending.values()) waiter.reject(new Error("Popup 已释放"));
    this.pending.clear();
    await Promise.race([
      this.browserCdp.send("Target.detachFromTarget", { sessionId: this.sessionId }).catch(() => undefined),
      delay(2_000)
    ]);
  }
}

export async function attachToPopupTarget(browserCdp: CDPSession, popupUrl: string, timeoutMs = 5_000): Promise<CdpPopup> {
  const target = await poll(
    async () => {
      const result = await browserCdp.send("Target.getTargets") as { targetInfos: TargetInfo[] };
      return result.targetInfos.find((entry) => entry.url === popupUrl && ["page", "other"].includes(entry.type));
    },
    (value): value is TargetInfo => Boolean(value),
    timeoutMs,
    `ACTION_POPUP_TARGET_TIMEOUT: ${popupUrl}`
  );
  if (!target) throw new Error(`ACTION_POPUP_TARGET_TIMEOUT: ${popupUrl}`);
  const attached = await browserCdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: false }) as { sessionId: string };
  const popup = new CdpPopup(browserCdp, attached.sessionId, target.url);
  await poll(
    () => popup.evaluate<string>("document.readyState"),
    (state) => state === "interactive" || state === "complete",
    timeoutMs,
    "ACTION_POPUP_LOAD_TIMEOUT"
  );
  return popup;
}
