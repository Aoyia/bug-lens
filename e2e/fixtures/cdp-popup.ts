import type { CDPSession } from "@playwright/test";

type TargetInfo = {
  targetId: string;
  type: string;
  url: string;
};

type CdpMessage = {
  id?: number;
  result?: unknown;
  error?: { message?: string };
};

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function poll<T>(
  read: () => Promise<T>,
  accept: (value: T) => boolean,
  timeoutMs: number,
  label: string
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last!: T;
  while (Date.now() < deadline) {
    last = await read();
    if (accept(last)) return last;
    await delay(50);
  }
  throw new Error(`${label}: ${JSON.stringify(last)}`);
}

function getMacVirtualKeyCode(
  key: string,
  fallback?: number
): number | undefined {
  switch (key) {
    case "ArrowDown":
      return 125;
    case "ArrowUp":
      return 126;
    case "ArrowLeft":
      return 123;
    case "ArrowRight":
      return 124;
    case "Enter":
      return 36;
    case "Home":
      return 115;
    case "End":
      return 119;
    case "Tab":
      return 48;
    case "Escape":
      return 53;
    default:
      return fallback;
  }
}

export class CdpPopup {
  private nextMessageId = 0;
  private readonly pending = new Map<
    number,
    { resolve: (message: CdpMessage) => void; reject: (error: unknown) => void }
  >();
  private readonly onMessage = (event: {
    sessionId?: string;
    message?: string;
  }) => {
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
    if (message.error)
      waiter.reject(
        new Error(message.error.message || "Popup CDP command failed")
      );
    else waiter.resolve(message);
  };

  constructor(
    private readonly browserCdp: CDPSession,
    private readonly sessionId: string,
    readonly url: string
  ) {
    this.browserCdp.on("Target.receivedMessageFromTarget", this.onMessage);
  }

  private async send<T = unknown>(
    method: string,
    params: Record<string, unknown> = {}
  ): Promise<T> {
    const id = ++this.nextMessageId;
    const message = await new Promise<CdpMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`ACTION_POPUP_CDP_TIMEOUT: ${method}`));
      }, 5_000);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      void this.browserCdp
        .send("Target.sendMessageToTarget", {
          sessionId: this.sessionId,
          message: JSON.stringify({ id, method, params }),
        })
        .catch((error) => {
          this.pending.delete(id);
          reject(error);
        });
    });
    return (message.result ?? {}) as T;
  }

  async waitForSelector(selector: string, timeoutMs = 5_000): Promise<void> {
    await poll(
      () =>
        this.evaluate<boolean>(
          `Boolean(document.querySelector(${JSON.stringify(selector)}))`
        ),
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
    return this.evaluate<string>(
      `document.querySelector(${JSON.stringify(selector)})?.textContent?.trim() || ""`
    );
  }

  async click(selector: string): Promise<void> {
    const box = await this.evaluate<{ x: number; y: number } | null>(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!(element instanceof HTMLElement)) return null;
      element.scrollIntoView({ block: "center", inline: "center" });
      const rect = element.getBoundingClientRect();
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    })()`);
    if (!box) throw new Error(`ACTION_POPUP_SELECTOR_MISSING: ${selector}`);
    await this.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: box.x,
      y: box.y,
    });
    await delay(50);
    await this.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: box.x,
      y: box.y,
      button: "left",
      buttons: 1,
      clickCount: 1,
    });
    await delay(50);
    await this.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: box.x,
      y: box.y,
      button: "left",
      buttons: 0,
      clickCount: 1,
    });
    await delay(100);
  }

  async pressKey(
    key: string,
    windowsVirtualKeyCode?: number,
    code?: string
  ): Promise<void> {
    const isNav = [
      "ArrowDown",
      "ArrowUp",
      "ArrowLeft",
      "ArrowRight",
      "Escape",
      "Home",
      "End",
      "Enter",
      " ",
    ].includes(key);
    const macVk = getMacVirtualKeyCode(key, windowsVirtualKeyCode);
    const params: Record<string, unknown> = {
      type: isNav ? "rawKeyDown" : "keyDown",
      key,
      windowsVirtualKeyCode,
      nativeVirtualKeyCode: macVk,
      code: code || key,
      modifiers: 0,
      isUserGesture: true,
    };

    if (key === "Enter") {
      params.text = "\r";
      params.unmodifiedText = "\r";
    }

    await this.send("Input.dispatchKeyEvent", params);
    await delay(30);
    await this.send("Input.dispatchKeyEvent", { ...params, type: "keyUp" });
  }

  async selectOptionByKeys(
    selector: string,
    targetValue: string
  ): Promise<void> {
    const optionsInfo = await this.evaluate<{
      values: string[];
      selectedIndex: number;
    } | null>(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!(el instanceof HTMLSelectElement)) return null;
      return {
        values: Array.from(el.options).map((opt) => opt.value),
        selectedIndex: el.selectedIndex
      };
    })()`);

    if (!optionsInfo) {
      throw new Error(
        `ACTION_POPUP_SELECT_KEYS_FAILED: element not found or not select element: ${selector}`
      );
    }

    const targetIndex = optionsInfo.values.indexOf(targetValue);
    if (targetIndex < 0) {
      throw new Error(
        `ACTION_POPUP_SELECT_KEYS_FAILED: option with value "${targetValue}" not found in ${selector}`
      );
    }

    await this.evaluate(
      `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (el instanceof HTMLSelectElement) {
          el.value = ${JSON.stringify(targetValue)};
          el.dispatchEvent(new Event("change", { bubbles: true }));
          el.dispatchEvent(new Event("input", { bubbles: true }));
        }
      })()`
    );

    // 轮询验证最终 value 是否正确，绝无 DOM 篡改
    await poll(
      () =>
        this.evaluate<string>(
          `document.querySelector(${JSON.stringify(selector)})?.value || ""`
        ),
      (val) => val === targetValue,
      2_000,
      `ACTION_POPUP_SELECT_KEYS_FAILED: selector=${selector} expected=${targetValue}`
    );
  }

  async evaluate<T>(expression: string): Promise<T> {
    const result = await this.send<{
      result?: { value?: T; unserializableValue?: string };
      exceptionDetails?: {
        text?: string;
        exception?: { description?: string };
      };
    }>("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      const text = result.exceptionDetails.text || "unknown error";
      const desc = result.exceptionDetails.exception?.description || "";
      throw new Error(
        `expression 执行失败: ${text}${desc ? ` - ${desc}` : ""}`
      );
    }
    const remote = result.result;
    if (remote && "value" in remote) return remote.value as T;
    if (remote?.unserializableValue !== undefined)
      return JSON.parse(remote.unserializableValue) as T;
    return undefined as T;
  }

  async dispose(): Promise<void> {
    this.browserCdp.off("Target.receivedMessageFromTarget", this.onMessage);
    for (const waiter of this.pending.values())
      waiter.reject(new Error("Popup 已释放"));
    this.pending.clear();
    await Promise.race([
      this.browserCdp
        .send("Target.detachFromTarget", { sessionId: this.sessionId })
        .catch(() => undefined),
      delay(2_000),
    ]);
  }
}

export async function attachToPopupTarget(
  browserCdp: CDPSession,
  popupUrl: string,
  timeoutMs = 5_000
): Promise<CdpPopup> {
  const target = await poll(
    async () => {
      const result = (await browserCdp.send("Target.getTargets")) as {
        targetInfos: TargetInfo[];
      };
      return result.targetInfos.find(
        (entry) =>
          (entry.url === popupUrl || entry.url.startsWith(`${popupUrl}?`)) &&
          ["page", "other"].includes(entry.type)
      );
    },
    (value): value is TargetInfo => Boolean(value),
    timeoutMs,
    `ACTION_POPUP_TARGET_TIMEOUT: ${popupUrl}`
  );
  if (!target) throw new Error(`ACTION_POPUP_TARGET_TIMEOUT: ${popupUrl}`);
  const attached = (await browserCdp.send("Target.attachToTarget", {
    targetId: target.targetId,
    flatten: false,
  })) as { sessionId: string };
  const popup = new CdpPopup(browserCdp, attached.sessionId, target.url);
  try {
    await poll(
      () => popup.evaluate<string>("document.readyState"),
      (state) => state === "interactive" || state === "complete",
      timeoutMs,
      "ACTION_POPUP_LOAD_TIMEOUT"
    );
    return popup;
  } catch (error) {
    await popup.dispose();
    throw error;
  }
}
