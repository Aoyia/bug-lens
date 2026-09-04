import { message } from "../../../shared/protocol";

/**
 * 子 iframe 轻量级活跃事件上报器：
 *
 * 仅在 child iframe (window.top !== window) 且录制处于活跃期时启动；
 * 监听 pointerdown, keydown, input, scroll 用户交互事件（passive & capture），
 * 经 1500ms 节流后向 background 发送 content/activity-ping，
 * background 负责路由转发至 top frame，重置 InactivityMonitor 计时器，
 * 防止用户在子 iframe 操作时主页面误判闲置暂停。
 */
export class IframeActivityReporter {
  private started = false;
  private lastReportedTime = -Infinity;
  private readonly THROTTLE_MS = 1500;
  private readonly events = [
    "pointerdown",
    "keydown",
    "input",
    "scroll",
    "wheel",
  ];

  constructor(
    private readonly sendMessage: (msg: unknown) => Promise<unknown> = (msg) =>
      chrome.runtime.sendMessage(msg)
  ) {}

  start(): void {
    if (this.started) return;
    if (typeof window === "undefined" || window.top === window) return;

    this.started = true;
    for (const evt of this.events) {
      window.addEventListener(evt, this.handleEvent, {
        capture: true,
        passive: true,
      });
    }
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    if (typeof window !== "undefined") {
      for (const evt of this.events) {
        window.removeEventListener(evt, this.handleEvent, true);
      }
    }
  }

  private handleEvent = (): void => {
    const now = Date.now();
    if (now - this.lastReportedTime < this.THROTTLE_MS) return;
    this.lastReportedTime = now;
    void this.sendMessage(
      message(
        "content/activity-ping",
        { timestamp: now },
        undefined,
        "background"
      )
    ).catch(() => undefined);
  };
}
