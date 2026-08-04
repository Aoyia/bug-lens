export type InactivityCallbacks = {
  onPause(): void;
  onResume(): void;
  isBlocked(): boolean;
};

export class InactivityMonitor {
  private readonly TIMEOUT_MS = 60_000;
  private lastActivityTime = Date.now();
  private _isIdlePaused = false;
  private checkInterval: number | undefined;
  private listenersAttached = false;
  private accumulatedPausedMs = 0;
  private pauseStartMs: number | undefined;
  private readonly events = [
    "pointermove",
    "pointerdown",
    "keydown",
    "scroll",
    "wheel",
    "touchstart",
  ];

  constructor(private readonly callbacks: InactivityCallbacks) {}

  private isManualPaused = false;

  get isIdlePaused(): boolean {
    return this._isIdlePaused || this.isManualPaused;
  }

  getPausedDurationMs(): number {
    let currentPause = 0;
    if (this._isIdlePaused && this.pauseStartMs !== undefined) {
      currentPause = Date.now() - this.pauseStartMs;
    }
    return this.accumulatedPausedMs + currentPause;
  }

  start(): void {
    this.stop();
    this.lastActivityTime = Date.now();
    this._isIdlePaused = false;
    this.accumulatedPausedMs = 0;
    this.pauseStartMs = undefined;

    if (!this.listenersAttached) {
      this.events.forEach((type) => {
        window.addEventListener(type, this.handleActivity, {
          capture: true,
          passive: true,
        });
      });
      this.listenersAttached = true;
    }

    this.checkInterval = window.setInterval(() => {
      if (this.callbacks.isBlocked()) return;
      if (
        !this._isIdlePaused &&
        Date.now() - this.lastActivityTime >= this.TIMEOUT_MS
      ) {
        this._isIdlePaused = true;
        this.pauseStartMs = Date.now();
        this.callbacks.onPause();
      }
    }, 2_000);
  }

  toggleManualPause(): boolean {
    if (this.isManualPaused) {
      this.isManualPaused = false;
      this._isIdlePaused = false;
      if (this.pauseStartMs !== undefined) {
        this.accumulatedPausedMs += Date.now() - this.pauseStartMs;
        this.pauseStartMs = undefined;
      }
      this.callbacks.onResume();
      return false;
    } else {
      this.isManualPaused = true;
      this._isIdlePaused = false;
      this.pauseStartMs = Date.now();
      this.callbacks.onPause();
      return true;
    }
  }

  /**
   * 显式恢复录制：无论当前处于闲置自动暂停还是手动暂停，都回到录制状态。
   * 用于「继续」按钮，避免与 handleActivity 的自动恢复产生竞态
   * （用户点「继续」时若因鼠标移动已自动恢复，取反逻辑会误判为再次暂停）。
   */
  resume(): void {
    this.isManualPaused = false;
    this._isIdlePaused = false;
    if (this.pauseStartMs !== undefined) {
      this.accumulatedPausedMs += Date.now() - this.pauseStartMs;
      this.pauseStartMs = undefined;
    }
    this.callbacks.onResume();
  }

  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = undefined;
    }
    if (this.listenersAttached) {
      this.events.forEach((type) => {
        window.removeEventListener(type, this.handleActivity, true);
      });
      this.listenersAttached = false;
    }
    this._isIdlePaused = false;
    this.isManualPaused = false;
    this.accumulatedPausedMs = 0;
    this.pauseStartMs = undefined;
  }

  private handleActivity = (): void => {
    if (this.isManualPaused) return;
    // 闲置自动暂停后不因鼠标移动自动恢复，必须由用户点击「继续」显式恢复，
    // 避免「鼠标移动恢复录制 → 点击继续被取反为再次暂停」的竞态。
    this.lastActivityTime = Date.now();
  };
}
