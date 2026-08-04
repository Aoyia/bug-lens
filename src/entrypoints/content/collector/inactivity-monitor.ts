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

  get isIdlePaused(): boolean {
    return this._isIdlePaused;
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
    this.accumulatedPausedMs = 0;
    this.pauseStartMs = undefined;
  }

  private handleActivity = (): void => {
    if (this._isIdlePaused) {
      this._isIdlePaused = false;
      if (this.pauseStartMs !== undefined) {
        this.accumulatedPausedMs += Date.now() - this.pauseStartMs;
        this.pauseStartMs = undefined;
      }
      this.callbacks.onResume();
    }
    this.lastActivityTime = Date.now();
  };
}
