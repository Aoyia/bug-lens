import { message, type InteractionRecord } from "../../../shared/protocol";
import { describe, isWidgetElement } from "./dom-snapshot";

export type DomObserverDeps = {
  getSession():
    | { nonce: string; sessionId: string; privacyMode: "safe" | "raw" }
    | undefined;
  isIssueActive(): boolean;
  beginIssueSelection(): void;
  removeIssueUi(): void;
  /** 一次用户交互被确认为有效后触发（用于框架状态等周期证据采集）。 */
  onEvidenceTick?: () => void;
};

type InputSession = {
  firstRecord: InteractionRecord;
  latestRecord: InteractionRecord;
  eventCount: number;
  idleTimer: number;
  maxTimer: number;
};

type KeyRepeatSession = {
  firstRecord: InteractionRecord;
  latestRecord: InteractionRecord;
  key: string;
  element: Element;
  repeatCount: number;
  idleTimer: number;
};

export class DomObserver {
  private readonly pending = new Map<string, InteractionRecord>();
  private readonly inputSessions = new Map<Element, InputSession>();
  private keyRepeatSession: KeyRepeatSession | undefined;
  private attached = false;
  private lastScrollX = 0;
  private lastScrollY = 0;
  private scrollSession:
    { firstRecord: InteractionRecord; timer: number } | undefined;
  private lastConfirmedClick:
    | {
        id: string;
        element: Element;
        clientX: number;
        clientY: number;
        createdAt: number;
      }
    | undefined;

  // Store bound handlers for removal
  private readonly handlePointerdown: (event: PointerEvent) => void;
  private readonly handleClick: (event: MouseEvent) => void;
  private readonly handleInput: (event: Event) => void;
  private readonly handleChange: (event: Event) => void;
  private readonly handleSubmit: (event: SubmitEvent) => void;
  private readonly handleKeydownAltS: (event: KeyboardEvent) => void;
  private readonly handleKeydownAction: (event: KeyboardEvent) => void;
  private readonly handleKeyup: (event: KeyboardEvent) => void;
  private readonly handleScroll: (event: Event) => void;
  private readonly handleContextmenu: (event: MouseEvent) => void;
  private readonly handleDblclick: (event: MouseEvent) => void;

  constructor(private readonly deps: DomObserverDeps) {
    this.handlePointerdown = this.onPointerdown.bind(this);
    this.handleClick = this.onClick.bind(this);
    this.handleInput = this.onInput.bind(this);
    this.handleChange = this.onChange.bind(this);
    this.handleSubmit = this.onSubmit.bind(this);
    this.handleKeydownAltS = this.onKeydownAltS.bind(this);
    this.handleKeydownAction = this.onKeydownAction.bind(this);
    this.handleKeyup = this.onKeyup.bind(this);
    this.handleScroll = this.onScroll.bind(this);
    this.handleContextmenu = this.onContextmenu.bind(this);
    this.handleDblclick = this.onDblclick.bind(this);
  }

  attach(): void {
    if (this.attached) return;
    this.attached = true;
    document.addEventListener("pointerdown", this.handlePointerdown, {
      capture: true,
      passive: false,
    });
    document.addEventListener("click", this.handleClick, {
      capture: true,
      passive: true,
    });
    document.addEventListener("input", this.handleInput, {
      capture: true,
      passive: true,
    });
    document.addEventListener("change", this.handleChange, {
      capture: true,
      passive: true,
    });
    document.addEventListener("submit", this.handleSubmit as EventListener, {
      capture: true,
      passive: true,
    });
    document.addEventListener("keydown", this.handleKeydownAltS, {
      capture: true,
    });
    document.addEventListener("keydown", this.handleKeydownAction, {
      capture: true,
      passive: true,
    });
    document.addEventListener("keyup", this.handleKeyup, {
      capture: true,
      passive: true,
    });
    document.addEventListener("scroll", this.handleScroll, {
      capture: true,
      passive: true,
    });
    document.addEventListener("contextmenu", this.handleContextmenu, {
      capture: true,
      passive: true,
    });
    document.addEventListener("dblclick", this.handleDblclick, {
      capture: true,
      passive: true,
    });
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    document.removeEventListener("pointerdown", this.handlePointerdown, true);
    document.removeEventListener("click", this.handleClick, true);
    document.removeEventListener("input", this.handleInput, true);
    document.removeEventListener("change", this.handleChange, true);
    document.removeEventListener(
      "submit",
      this.handleSubmit as EventListener,
      true
    );
    document.removeEventListener("keydown", this.handleKeydownAltS, true);
    document.removeEventListener("keydown", this.handleKeydownAction, true);
    document.removeEventListener("keyup", this.handleKeyup, true);
    document.removeEventListener("scroll", this.handleScroll, true);
    document.removeEventListener("contextmenu", this.handleContextmenu, true);
    document.removeEventListener("dblclick", this.handleDblclick, true);
  }

  clearPending(): void {
    this.pending.clear();
    for (const s of this.inputSessions.values()) {
      window.clearTimeout(s.idleTimer);
      window.clearTimeout(s.maxTimer);
    }
    this.inputSessions.clear();
    if (this.keyRepeatSession) {
      window.clearTimeout(this.keyRepeatSession.idleTimer);
      this.keyRepeatSession = undefined;
    }
    if (this.scrollSession) {
      window.clearTimeout(this.scrollSession.timer);
      this.scrollSession = undefined;
    }
    this.lastConfirmedClick = undefined;
  }

  // ─── Private ───

  private firstElement(path: EventTarget[]): Element | undefined {
    return path.find((item): item is Element => item instanceof Element);
  }

  private send(
    record: InteractionRecord,
    type: "interaction/candidate" | "interaction/confirmed"
  ): void {
    void chrome.runtime.sendMessage(
      message(type, { interaction: record }, record.sessionId)
    );
  }

  private sendConfirmed(record: InteractionRecord): void {
    this.send(record, "interaction/confirmed");
  }

  private actionableKey(event: KeyboardEvent): boolean {
    if (["Meta", "Control", "Alt", "Shift"].includes(event.key)) {
      return false;
    }
    const isShortcut = event.ctrlKey || event.metaKey || event.altKey;
    const isActionKey = ["Enter", "Escape", "Tab"].includes(event.key);
    return isShortcut || isActionKey;
  }

  private onKeydownAction(event: KeyboardEvent): void {
    const session = this.deps.getSession();
    if (
      !session ||
      this.deps.isIssueActive() ||
      !event.isTrusted ||
      !this.actionableKey(event)
    )
      return;

    const isShortcut = event.metaKey || event.ctrlKey || event.altKey;
    const shortcutStr = isShortcut ? this.formatShortcut(event) : undefined;

    const element =
      this.firstElement(event.composedPath()) ??
      (event.target instanceof Element
        ? event.target
        : document.documentElement);
    if (isWidgetElement(element)) return;
    if (this.inputSessions.has(element)) this.flushInputSession(element);

    const record = this.createRecord(event, element, "confirmed", "keydown", {
      key: event.key,
      code: event.code,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      repeat: event.repeat,
      isShortcut: isShortcut || undefined,
      shortcut: shortcutStr,
    });

    if (event.repeat) {
      const s = this.keyRepeatSession;
      if (s && s.key === event.key && s.element === element) {
        window.clearTimeout(s.idleTimer);
        s.latestRecord = record;
        s.repeatCount += 1;
        s.idleTimer = window.setTimeout(
          () => this.flushKeyRepeatSession(),
          500
        );
        return;
      }
      this.flushKeyRepeatSession();
      this.keyRepeatSession = {
        firstRecord: record,
        latestRecord: record,
        key: event.key,
        element,
        repeatCount: 1,
        idleTimer: window.setTimeout(() => this.flushKeyRepeatSession(), 500),
      };
      return;
    }

    this.flushKeyRepeatSession();
    this.sendConfirmed(record);
  }

  private createRecord(
    event: Event,
    element: Element,
    status: InteractionRecord["status"],
    kind: InteractionRecord["kind"] = "click",
    metadata?: InteractionRecord["metadata"]
  ): InteractionRecord {
    const session = this.deps.getSession()!;
    const now = Date.now();
    const id = crypto.randomUUID();
    const pointer = event instanceof MouseEvent ? event : undefined;
    const keyboard = event instanceof KeyboardEvent ? event : undefined;
    const rect = element.getBoundingClientRect();
    const clientX = pointer?.clientX ?? Math.max(0, rect.left + rect.width / 2);
    const clientY = pointer?.clientY ?? Math.max(0, rect.top + rect.height / 2);
    const pointerType =
      event instanceof PointerEvent
        ? event.pointerType || "unknown"
        : keyboard
          ? "keyboard"
          : kind === "navigation"
            ? "navigation"
            : "form";
    return {
      id,
      sessionId: session.nonce,
      kind,
      status,
      createdAt: now,
      page: {
        url: location.href,
        title: document.title,
        frameId: window.top === window ? 0 : -1,
      },
      input: {
        pointerType,
        button: pointer?.button ?? 0,
        isTrusted: event.isTrusted,
      },
      coordinates: {
        clientX,
        clientY,
        pageX: pointer?.pageX ?? clientX + window.scrollX,
        pageY: pointer?.pageY ?? clientY + window.scrollY,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        devicePixelRatio: window.devicePixelRatio,
        viewport: { width: window.innerWidth, height: window.innerHeight },
      },
      element: describe(element, session.privacyMode),
      metadata,
      screenshot: { status: "pending" },
    };
  }

  private inputMetadata(
    element: Element,
    session: { privacyMode: "safe" | "raw" },
    event?: InputEvent
  ): InteractionRecord["metadata"] {
    const safeMode = session.privacyMode !== "raw";
    if (element instanceof HTMLInputElement) {
      const password = element.type.toLowerCase() === "password";
      return {
        inputType: event?.inputType || element.type || "text",
        value:
          !safeMode && !password ? element.value.slice(0, 2_048) : undefined,
        valueLength: element.value.length,
        valueRedacted: safeMode || password || undefined,
        checked: ["checkbox", "radio"].includes(element.type.toLowerCase())
          ? element.checked
          : undefined,
      };
    }
    if (element instanceof HTMLTextAreaElement) {
      return {
        inputType: event?.inputType || "textarea",
        value: safeMode ? undefined : element.value.slice(0, 2_048),
        valueLength: element.value.length,
        valueRedacted: safeMode || undefined,
      };
    }
    if (element instanceof HTMLSelectElement) {
      const selected = Array.from(element.selectedOptions);
      const rawValue = selected.map((option) => option.value).join(",");
      return {
        inputType: element.multiple ? "select-multiple" : "select-one",
        value: safeMode ? undefined : rawValue.slice(0, 2_048),
        valueLength: rawValue.length,
        valueRedacted: safeMode || undefined,
        selectedCount: selected.length,
      };
    }
    const text = element.textContent ?? "";
    return {
      inputType: event?.inputType || "contenteditable",
      value: safeMode ? undefined : text.slice(0, 2_048),
      valueLength: text.length,
      valueRedacted: safeMode || undefined,
    };
  }

  // ─── Event Handlers ───

  private onPointerdown(event: PointerEvent): void {
    if (this.deps.isIssueActive()) return;
    const session = this.deps.getSession();
    if (!session || !event.isTrusted) return;
    const element = this.firstElement(event.composedPath());
    if (!element || isWidgetElement(element)) return;
    const record = this.createRecord(event, element, "candidate");
    this.pending.set(record.id, record);
    this.send(record, "interaction/candidate");
    window.setTimeout(() => {
      if (this.pending.get(record.id)?.status === "candidate") {
        this.pending.delete(record.id);
        void chrome.runtime.sendMessage(
          message(
            "interaction/cancelled",
            { interactionId: record.id, interaction: record },
            record.sessionId
          )
        );
      }
    }, 750);
  }

  private onClick(event: MouseEvent): void {
    if (this.deps.isIssueActive()) return;
    const session = this.deps.getSession();
    if (!session || !event.isTrusted) return;
    const element =
      this.firstElement(event.composedPath()) ??
      (event.target instanceof Element ? event.target : undefined);
    if (!element || isWidgetElement(element)) return;
    const nearest = Array.from(this.pending.values()).find(
      (candidate) =>
        Math.abs(candidate.coordinates.clientX - event.clientX) < 3 &&
        Math.abs(candidate.coordinates.clientY - event.clientY) < 3
    );
    const record = nearest
      ? {
          ...nearest,
          status: "confirmed" as const,
          confirmedAt: Date.now(),
          element: describe(element, session.privacyMode),
        }
      : this.createRecord(event, element, "confirmed");
    if (nearest) this.pending.delete(nearest.id);
    this.send(record, "interaction/confirmed");
    this.lastConfirmedClick = {
      id: record.id,
      element,
      clientX: event.clientX,
      clientY: event.clientY,
      createdAt: Date.now(),
    };
    this.deps.onEvidenceTick?.();
  }

  private flushInputSession(element: Element): void {
    const s = this.inputSessions.get(element);
    if (!s) return;
    window.clearTimeout(s.idleTimer);
    window.clearTimeout(s.maxTimer);
    this.inputSessions.delete(element);
    const merged: InteractionRecord = {
      ...s.latestRecord,
      createdAt: s.firstRecord.createdAt,
      metadata: {
        ...s.latestRecord.metadata,
        inputEventCount: s.eventCount > 1 ? s.eventCount : undefined,
      },
    };
    this.sendConfirmed(merged);
  }

  private onInput(event: Event): void {
    const session = this.deps.getSession();
    if (!session || this.deps.isIssueActive() || !event.isTrusted) return;
    const element =
      this.firstElement(event.composedPath()) ??
      (event.target instanceof Element ? event.target : undefined);
    if (!element || isWidgetElement(element)) return;
    const record = this.createRecord(
      event,
      element,
      "confirmed",
      "input",
      this.inputMetadata(
        element,
        session,
        event instanceof InputEvent ? event : undefined
      )
    );
    const existing = this.inputSessions.get(element);
    if (existing) {
      window.clearTimeout(existing.idleTimer);
      existing.latestRecord = record;
      existing.eventCount += 1;
      existing.idleTimer = window.setTimeout(
        () => this.flushInputSession(element),
        1500
      );
    } else {
      const idleTimer = window.setTimeout(
        () => this.flushInputSession(element),
        1500
      );
      const maxTimer = window.setTimeout(
        () => this.flushInputSession(element),
        10_000
      );
      this.inputSessions.set(element, {
        firstRecord: record,
        latestRecord: record,
        eventCount: 1,
        idleTimer,
        maxTimer,
      });
      element.addEventListener(
        "blur",
        () => {
          const active = this.inputSessions.get(element);
          if (active) {
            window.clearTimeout(active.idleTimer);
            active.idleTimer = window.setTimeout(
              () => this.flushInputSession(element),
              300
            );
          }
        },
        { once: true }
      );
    }
  }

  private onChange(event: Event): void {
    const session = this.deps.getSession();
    if (!session || this.deps.isIssueActive() || !event.isTrusted) return;
    const element =
      this.firstElement(event.composedPath()) ??
      (event.target instanceof Element ? event.target : undefined);
    if (!element || isWidgetElement(element)) return;

    if (element instanceof HTMLInputElement && element.type === "file") {
      this.onFileUpload(event, element, session);
      return;
    }

    const existing = this.inputSessions.get(element);
    if (existing) {
      const meta = this.inputMetadata(element, session);
      existing.latestRecord = {
        ...existing.latestRecord,
        metadata: {
          ...meta,
          inputEventCount:
            existing.eventCount > 1 ? existing.eventCount : undefined,
        },
      };
      this.flushInputSession(element);
    } else {
      this.sendConfirmed(
        this.createRecord(
          event,
          element,
          "confirmed",
          "change",
          this.inputMetadata(element, session)
        )
      );
    }
  }

  private onSubmit(event: SubmitEvent): void {
    const session = this.deps.getSession();
    if (!session || this.deps.isIssueActive() || !event.isTrusted) return;
    const form =
      event.target instanceof HTMLFormElement ? event.target : undefined;
    if (!form || isWidgetElement(form)) return;
    this.sendConfirmed(
      this.createRecord(event, form, "confirmed", "submit", {
        formMethod: form.method.toUpperCase(),
        formAction: form.action,
      })
    );
  }

  private onScroll(event: Event): void {
    const session = this.deps.getSession();
    if (!session || this.deps.isIssueActive()) return;
    const target = event.target instanceof Element ? event.target : undefined;
    if (target && isWidgetElement(target)) return;
    const prevX = this.lastScrollX;
    const prevY = this.lastScrollY;
    const dx = Math.abs(window.scrollX - prevX);
    const dy = Math.abs(window.scrollY - prevY);
    this.lastScrollX = window.scrollX;
    this.lastScrollY = window.scrollY;
    if (dx < 50 && dy < 50) return;

    const direction =
      dy > dx
        ? window.scrollY > prevY
          ? "down"
          : "up"
        : window.scrollX > prevX
          ? "right"
          : "left";

    const record = this.createRecord(
      event,
      document.documentElement,
      "confirmed",
      "scroll",
      {
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        scrollDeltaX: dx,
        scrollDeltaY: dy,
        scrollDirection: direction,
      }
    );

    if (this.scrollSession) {
      window.clearTimeout(this.scrollSession.timer);
      this.scrollSession.firstRecord = record;
    } else {
      this.scrollSession = { firstRecord: record, timer: 0 };
    }
    this.scrollSession.timer = window.setTimeout(() => {
      if (this.scrollSession) {
        this.sendConfirmed(this.scrollSession.firstRecord);
        this.scrollSession = undefined;
      }
    }, 300);
  }

  private onContextmenu(event: MouseEvent): void {
    const session = this.deps.getSession();
    if (!session || this.deps.isIssueActive() || !event.isTrusted) return;
    const element = this.firstElement(event.composedPath());
    if (!element || isWidgetElement(element)) return;
    this.sendConfirmed(
      this.createRecord(event, element, "confirmed", "contextmenu")
    );
  }

  private onDblclick(event: MouseEvent): void {
    const session = this.deps.getSession();
    if (!session || this.deps.isIssueActive() || !event.isTrusted) return;
    const element = this.firstElement(event.composedPath());
    if (!element || isWidgetElement(element)) return;

    const last = this.lastConfirmedClick;
    if (
      last &&
      last.element === element &&
      Math.abs(last.clientX - event.clientX) < 3 &&
      Math.abs(last.clientY - event.clientY) < 3 &&
      Date.now() - last.createdAt < 100
    ) {
      void chrome.runtime.sendMessage(
        message(
          "interaction/upgrade",
          {
            interactionId: last.id,
            kind: "dblclick",
          },
          session.sessionId
        )
      );
      this.lastConfirmedClick = undefined;
      return;
    }

    this.sendConfirmed(
      this.createRecord(event, element, "confirmed", "dblclick")
    );
  }

  private onFileUpload(
    event: Event,
    input: HTMLInputElement,
    session: { nonce: string; sessionId: string; privacyMode: "safe" | "raw" }
  ): void {
    const files = input.files;
    if (!files || files.length === 0) return;
    const safeMode = session.privacyMode !== "raw";
    this.sendConfirmed(
      this.createRecord(event, input, "confirmed", "file", {
        fileCount: files.length,
        fileNames: safeMode ? undefined : Array.from(files).map((f) => f.name),
        fileTypes: Array.from(files).map((f) => f.type),
        fileSizes: safeMode ? undefined : Array.from(files).map((f) => f.size),
        fileAccept: input.accept || undefined,
      })
    );
  }

  private onKeydownAltS(event: KeyboardEvent): void {
    const session = this.deps.getSession();
    if (!session || !event.isTrusted) return;
    const isAltS =
      event.altKey &&
      (event.key.toLowerCase() === "s" || event.code === "KeyS");
    if (isAltS) {
      event.preventDefault();
      event.stopPropagation();
      if (this.deps.isIssueActive()) {
        this.deps.removeIssueUi();
      } else {
        this.deps.beginIssueSelection();
      }
    }
  }

  private flushKeyRepeatSession(): void {
    const s = this.keyRepeatSession;
    if (!s) return;
    window.clearTimeout(s.idleTimer);
    this.keyRepeatSession = undefined;
    const merged: InteractionRecord = {
      ...s.latestRecord,
      createdAt: s.firstRecord.createdAt,
      metadata: {
        ...s.latestRecord.metadata,
        repeatCount: s.repeatCount,
      },
    };
    this.sendConfirmed(merged);
  }

  private formatShortcut(event: KeyboardEvent): string | undefined {
    const parts: string[] = [];
    if (event.metaKey) parts.push("Cmd");
    if (event.ctrlKey) parts.push("Ctrl");
    if (event.altKey) parts.push("Alt");
    if (event.shiftKey) parts.push("Shift");
    if (!["Meta", "Control", "Alt", "Shift"].includes(event.key)) {
      parts.push(event.key.length === 1 ? event.key.toUpperCase() : event.key);
    }
    return parts.length > 1 ? parts.join("+") : undefined;
  }

  private onKeyup(event: KeyboardEvent): void {
    if (this.keyRepeatSession?.key === event.key) this.flushKeyRepeatSession();
  }
}
