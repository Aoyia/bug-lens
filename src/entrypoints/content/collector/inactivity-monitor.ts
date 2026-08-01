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
  private readonly events = ["pointermove", "pointerdown", "keydown", "scroll", "wheel", "touchstart"];

  constructor(private readonly callbacks: InactivityCallbacks) {}

  get isIdlePaused(): boolean { return this._isIdlePaused; }

  start(): void {
    this.stop();
    this.lastActivityTime = Date.now();
    this._isIdlePaused = false;

    if (!this.listenersAttached) {
      this.events.forEach((type) => {
        window.addEventListener(type, this.handleActivity, { capture: true, passive: true });
      });
      this.listenersAttached = true;
    }

    this.checkInterval = window.setInterval(() => {
      if (this.callbacks.isBlocked()) return;
      if (!this._isIdlePaused && Date.now() - this.lastActivityTime >= this.TIMEOUT_MS) {
        this._isIdlePaused = true;
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
  }

  private handleActivity = (): void => {
    if (this._isIdlePaused) {
      this._isIdlePaused = false;
      this.callbacks.onResume();
    }
    this.lastActivityTime = Date.now();
  };
}
