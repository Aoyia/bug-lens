import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { RecordingWidget } from "../src/entrypoints/content/collector/recording-widget.ts";
import { t } from "../src/shared/i18n.ts";

const WIDGET_SOURCE = resolve(
  process.cwd(),
  "src/entrypoints/content/collector/recording-widget.ts"
);

function loadDict(locale: "zh_CN" | "en") {
  return JSON.parse(
    readFileSync(
      resolve(process.cwd(), `src/_locales/${locale}/messages.json`),
      "utf8"
    )
  ) as Record<string, { message: string }>;
}

describe("RecordingWidget - Drag and Auto-Collapse", () => {
  let widget: RecordingWidget;
  const storageMap = new Map<string, string>();
  let mockRootElement: any;

  const callbacks = {
    onStop: () => {},
    onMarkIssue: () => {},
    getStartedAtEpochMs: () => Date.now(),
    isIdlePaused: () => false,
  };

  beforeEach(() => {
    storageMap.clear();

    const sessionStorageMock = {
      getItem(key: string) {
        return storageMap.get(key) || null;
      },
      setItem(key: string, val: string) {
        storageMap.set(key, String(val));
      },
      removeItem(key: string) {
        storageMap.delete(key);
      },
      clear() {
        storageMap.clear();
      },
    };

    const listenersMap = new Map<any, Record<string, Function[]>>();

    const addListener = (target: any, type: string, fn: Function) => {
      let map = listenersMap.get(target);
      if (!map) {
        map = {};
        listenersMap.set(target, map);
      }
      if (!map[type]) map[type] = [];
      map[type].push(fn);
    };

    const removeListener = (target: any, type: string, fn: Function) => {
      const map = listenersMap.get(target);
      if (map && map[type]) {
        map[type] = map[type].filter((f) => f !== fn);
      }
    };

    const dispatch = (target: any, event: any) => {
      const type = typeof event === "string" ? event : event.type;
      const evt =
        typeof event === "object" && event !== null
          ? {
              stopPropagation: () => {},
              preventDefault: () => {},
              ...event,
            }
          : {
              type,
              stopPropagation: () => {},
              preventDefault: () => {},
            };
      const map = listenersMap.get(target);
      if (map && map[type]) {
        map[type].forEach((fn) => fn(evt));
      }
    };

    const dragHandle = {
      textContent: "⋮⋮",
      capturedPointerIds: [] as number[],
      releasedPointerIds: [] as number[],
      setPointerCapture(pointerId: number) {
        this.capturedPointerIds.push(pointerId);
      },
      releasePointerCapture(pointerId: number) {
        this.releasedPointerIds.push(pointerId);
      },
      addEventListener(type: string, fn: Function) {
        addListener(this, type, fn);
      },
      removeEventListener(type: string, fn: Function) {
        removeListener(this, type, fn);
      },
      dispatchEvent(evt: any) {
        dispatch(this, evt);
      },
    };

    const collapseToggleBtn = {
      id: "__wbr_collapse_toggle_btn__",
      title: "",
      textContent: "▾",
      attributes: {} as Record<string, string>,
      setAttribute(k: string, v: string) {
        this.attributes[k] = v;
      },
      getAttribute(k: string) {
        return this.attributes[k];
      },
      addEventListener(type: string, fn: Function) {
        addListener(this, type, fn);
      },
      removeEventListener(type: string, fn: Function) {
        removeListener(this, type, fn);
      },
      dispatchEvent(evt: any) {
        dispatch(this, evt);
      },
      click() {
        dispatch(this, { type: "click" });
      },
    };

    const bubbleArrow = {
      id: "__wbr_widget_bubble_arrow__",
      style: {
        setProperty(prop: string, val: string) {
          (bubbleArrow.style as any)[prop] = val;
        },
      },
    };

    const stopBtn = {
      title: "",
      addEventListener(type: string, fn: Function) {
        addListener(this, type, fn);
      },
      removeEventListener(type: string, fn: Function) {
        removeListener(this, type, fn);
      },
      dispatchEvent(evt: any) {
        dispatch(this, evt);
      },
    };

    const issueBtn = {
      disabled: false,
      title: "",
      textContent: "",
      style: { opacity: "1" },
      addEventListener(type: string, fn: Function) {
        addListener(this, type, fn);
      },
      removeEventListener(type: string, fn: Function) {
        removeListener(this, type, fn);
      },
      dispatchEvent(evt: any) {
        dispatch(this, evt);
      },
    };

    const timerDisplay = {
      textContent: "00:00",
      _innerHTML: "",
      get innerHTML() {
        return this._innerHTML;
      },
      set innerHTML(val: string) {
        this._innerHTML = val;
        this.textContent = val.replace(/<[^>]*>/g, "");
      },
    };

    const recTag = {
      textContent: "REC",
      style: {},
    };

    const classSet = new Set<string>();
    const styleObj: Record<string, string> = {};

    const mobileArrow = {
      textContent: "‹",
      style: {},
    };

    const mobileMenuTimer = {
      textContent: "00:00",
      style: {},
    };

    const mobileHealthMsg = {
      textContent: "",
      title: "",
      style: { display: "none" },
    };

    const mobileIssueLabel = {
      textContent: "标记截图",
    };

    const mobileDockBtn = {
      id: "__wbr_mobile_dock_btn__",
      title: "靠左",
      attributes: { "aria-label": "靠左" } as Record<string, string>,
      _innerHTML: "",
      get innerHTML() {
        return this._innerHTML;
      },
      set innerHTML(val: string) {
        this._innerHTML = val;
        this.textContent = val.replace(/<[^>]*>/g, "");
      },
      textContent: "靠左",
      setAttribute(k: string, v: string) {
        this.attributes[k] = String(v);
        if (k === "title") this.title = String(v);
        if (k === "aria-label") this.attributes["aria-label"] = String(v);
      },
      getAttribute(k: string) {
        return this.attributes[k];
      },
      addEventListener(type: string, fn: Function) {
        addListener(this, type, fn);
      },
      removeEventListener(type: string, fn: Function) {
        removeListener(this, type, fn);
      },
      dispatchEvent(evt: any) {
        dispatch(this, evt);
      },
      click() {
        dispatch(this, { type: "click" });
      },
    };

    const mobileCloseBtn = {
      id: "__wbr_mobile_close_btn__",
      title: "",
      setAttribute(k: string, v: string) {},
      addEventListener(type: string, fn: Function) {
        addListener(this, type, fn);
      },
      removeEventListener(type: string, fn: Function) {
        removeListener(this, type, fn);
      },
      dispatchEvent(evt: any) {
        dispatch(this, evt);
      },
      click() {
        dispatch(this, { type: "click" });
      },
    };

    const mobileIssueBtn = {
      id: "__wbr_mobile_issue_btn__",
      addEventListener(type: string, fn: Function) {
        addListener(this, type, fn);
      },
      removeEventListener(type: string, fn: Function) {
        removeListener(this, type, fn);
      },
      dispatchEvent(evt: any) {
        dispatch(this, evt);
      },
      click() {
        dispatch(this, { type: "click" });
      },
    };

    const mobileTicketBtn = {
      id: "__wbr_mobile_ticket_btn__",
      addEventListener(type: string, fn: Function) {
        addListener(this, type, fn);
      },
      removeEventListener(type: string, fn: Function) {
        removeListener(this, type, fn);
      },
      dispatchEvent(evt: any) {
        dispatch(this, evt);
      },
      click() {
        dispatch(this, { type: "click" });
      },
    };

    const mobileStopBtn = {
      id: "__wbr_mobile_stop_btn__",
      addEventListener(type: string, fn: Function) {
        addListener(this, type, fn);
      },
      removeEventListener(type: string, fn: Function) {
        removeListener(this, type, fn);
      },
      dispatchEvent(evt: any) {
        dispatch(this, evt);
      },
      click() {
        dispatch(this, { type: "click" });
      },
    };

    const mobileDiscardBtn = {
      id: "__wbr_mobile_discard_btn__",
      textContent: "丢弃录制",
      classList: {
        add(cls: string) {},
        remove(cls: string) {},
      },
      style: {
        setProperty(k: string, v: string) {},
        removeProperty(k: string) {},
      },
      addEventListener(type: string, fn: Function) {
        addListener(this, type, fn);
      },
      removeEventListener(type: string, fn: Function) {
        removeListener(this, type, fn);
      },
      dispatchEvent(evt: any) {
        dispatch(this, evt);
      },
      click() {
        dispatch(this, { type: "click" });
      },
    };

    let rootInnerHTML = "";
    mockRootElement = {
      id: "__wbr_recording_widget__",
      get innerHTML() {
        return rootInnerHTML;
      },
      set innerHTML(val: string) {
        rootInnerHTML = val;
      },
      attributes: {} as Record<string, string>,
      dataset: {} as Record<string, string>,
      style: {
        ...styleObj,
        setProperty(prop: string, val: string) {
          styleObj[prop] = val;
          (mockRootElement.style as any)[prop] = val;
        },
        removeProperty(prop: string) {
          delete styleObj[prop];
          (mockRootElement.style as any)[prop] = "";
        },
      },
      classList: {
        add(cls: string) {
          classSet.add(cls);
        },
        remove(cls: string) {
          classSet.delete(cls);
        },
        contains(cls: string) {
          return classSet.has(cls);
        },
      },
      setAttribute(k: string, v: string) {
        this.attributes[k] = String(v);
        if (k === "data-wbr-mobile-mode")
          this.dataset.wbrMobileMode = String(v);
        if (k === "data-wbr-edge") this.dataset.wbrEdge = String(v);
        if (k === "data-wbr-suppressed") this.dataset.wbrSuppressed = String(v);
      },
      removeAttribute(k: string) {
        delete this.attributes[k];
        if (k === "data-wbr-mobile-mode") delete this.dataset.wbrMobileMode;
        if (k === "data-wbr-edge") delete this.dataset.wbrEdge;
        if (k === "data-wbr-suppressed") delete this.dataset.wbrSuppressed;
      },
      getAttribute(k: string) {
        return this.attributes[k];
      },
      getBoundingClientRect() {
        return { left: 100, top: 100, width: 200, height: 40 };
      },
      addEventListener(type: string, fn: Function) {
        addListener(mockRootElement, type, fn);
      },
      removeEventListener(type: string, fn: Function) {
        removeListener(mockRootElement, type, fn);
      },
      dispatchEvent(evt: any) {
        dispatch(mockRootElement, evt);
      },
      querySelector(sel: string) {
        if (sel.includes("drag_handle")) return dragHandle;
        if (sel.includes("stop_btn") && !sel.includes("mobile")) return stopBtn;
        if (sel.includes("issue_btn") && !sel.includes("mobile"))
          return issueBtn;
        if (sel.includes("collapse_toggle_btn")) return collapseToggleBtn;
        if (sel.includes("widget_bubble_arrow")) return bubbleArrow;
        if (sel.includes("timer_display")) return timerDisplay;
        if (sel.includes("rec-tag")) return recTag;
        if (sel.includes("toast_action")) return toastActionBtn;
        if (sel.includes("mobile_arrow")) return mobileArrow;
        if (sel.includes("mobile_menu_timer")) return mobileMenuTimer;
        if (sel.includes("mobile_health_msg")) return mobileHealthMsg;
        if (sel.includes("mobile_issue_label")) return mobileIssueLabel;
        if (sel.includes("mobile_dock_btn")) return mobileDockBtn;
        if (sel.includes("mobile_close_btn")) return mobileCloseBtn;
        if (sel.includes("mobile_issue_btn")) return mobileIssueBtn;
        if (sel.includes("mobile_ticket_btn")) return mobileTicketBtn;
        if (sel.includes("mobile_stop_btn")) return mobileStopBtn;
        if (sel.includes("mobile_discard_btn")) return mobileDiscardBtn;
        return null;
      },
      remove() {},
    };

    const toastActionBtn = {
      id: "__wbr_toast_action__",
      textContent: "预览 ↗",
      style: {
        ...mockRootElement.style,
        color: "#165dff",
        textDecoration: "none",
        cursor: "pointer",
        cssText: "cursor: pointer;",
      },
      addEventListener: mockRootElement.addEventListener,
      removeEventListener: mockRootElement.removeEventListener,
      dispatchEvent: mockRootElement.dispatchEvent,
    };

    const appendedElements: any[] = [];
    const doc = {
      documentElement: {
        clientWidth: 1024,
        clientHeight: 768,
      },
      body: {
        appendChild(child: any) {
          appendedElements.push(child);
        },
      },
      createElement(tag: string) {
        let _innerHTML = "";
        const elStyle: any = {
          cssText: "",
          setProperty(prop: string, val: string) {
            elStyle[prop] = val;
            if (el.id === "__wbr_recording_widget__") {
              mockRootElement.style.setProperty(prop, val);
            }
          },
          removeProperty(prop: string) {
            delete elStyle[prop];
            elStyle[prop] = "";
            if (el.id === "__wbr_recording_widget__") {
              mockRootElement.style.removeProperty(prop);
            }
          },
        };
        const el: any = {
          id: "",
          style: elStyle,
          get innerHTML() {
            return _innerHTML;
          },
          set innerHTML(val: string) {
            _innerHTML = val;
            el.textContent = val.replace(/<[^>]*>/g, "");
            if (el.id === "__wbr_recording_widget__") {
              mockRootElement.innerHTML = val;
            }
          },
          textContent: "",
          attributes: {} as Record<string, string>,
          dataset: {} as Record<string, string>,
          setAttribute(k: string, v: string) {
            this.attributes[k] = String(v);
            if (el.id === "__wbr_recording_widget__") {
              mockRootElement.setAttribute(k, v);
            }
          },
          removeAttribute(k: string) {
            delete this.attributes[k];
            if (el.id === "__wbr_recording_widget__") {
              mockRootElement.removeAttribute(k);
            }
          },
          getAttribute(k: string) {
            return this.attributes[k];
          },
          remove() {
            const idx = appendedElements.indexOf(el);
            if (idx !== -1) appendedElements.splice(idx, 1);
          },
          querySelector(sel: string) {
            if (sel.includes("widget_bubble_arrow")) return bubbleArrow;
            return mockRootElement.querySelector(sel);
          },
          classList: mockRootElement.classList,
          addEventListener: mockRootElement.addEventListener,
          removeEventListener: mockRootElement.removeEventListener,
          dispatchEvent: mockRootElement.dispatchEvent,
          getBoundingClientRect() {
            if (el.id === "__wbr_widget_bubble__") {
              return { left: 0, top: 0, width: 320, height: 88 };
            }
            return mockRootElement.getBoundingClientRect();
          },
        };
        return el;
      },
      querySelector(sel: string) {
        if (sel === "#__wbr_recording_widget__") return mockRootElement;
        const found = appendedElements.find((e) => e.id && `#${e.id}` === sel);
        if (found) return found;
        return mockRootElement.querySelector(sel);
      },
      addEventListener() {},
    };

    const localStorageMock = {
      getItem(key: string) {
        return storageMap.get(key) || null;
      },
      setItem(key: string, val: string) {
        storageMap.set(key, String(val));
      },
      removeItem(key: string) {
        storageMap.delete(key);
      },
      clear() {
        storageMap.clear();
      },
    };

    storageMap.set("__wbr_widget_bubble_seen__", "true");

    let timeoutIdSeq = 1000;
    const pendingTimeouts = new Map<number, Function>();
    let intervalCallback: Function | undefined;
    const mockWindow: any = {
      innerWidth: 1200,
      innerHeight: 800,
      __WEB_BUG_REPORT_I18N__: {
        locale: "zh-CN",
        dict: loadDict("zh_CN"),
      },
      setInterval(fn: Function) {
        intervalCallback = fn;
        return 1;
      },
      clearInterval() {},
      setTimeout(fn: Function, ms: number) {
        if (ms === 1500 || ms === 8000 || ms === 250) {
          const id = ++timeoutIdSeq;
          pendingTimeouts.set(id, fn);
          return id;
        }
        return setTimeout(fn, ms) as any;
      },
      clearTimeout(id: any) {
        pendingTimeouts.delete(id);
        clearTimeout(id);
      },
      addEventListener(type: string, fn: Function) {
        addListener(mockWindow, type, fn);
      },
      removeEventListener(type: string, fn: Function) {
        removeListener(mockWindow, type, fn);
      },
      dispatchEvent(evt: any) {
        dispatch(mockWindow, evt);
      },
      visualViewport: {
        addEventListener(type: string, fn: Function) {
          addListener(mockWindow.visualViewport, type, fn);
        },
        removeEventListener(type: string, fn: Function) {
          removeListener(mockWindow.visualViewport, type, fn);
        },
        dispatchEvent(evt: any) {
          dispatch(mockWindow.visualViewport, evt);
        },
      },
      triggerCollapseTimer() {
        // 触发最近一次仍处于 pending 状态的折叠计时器
        const ids = [...pendingTimeouts.keys()];
        const lastId = ids[ids.length - 1];
        if (lastId !== undefined) {
          const fn = pendingTimeouts.get(lastId)!;
          pendingTimeouts.delete(lastId);
          fn();
        }
      },
      triggerBubbleTimer() {
        const ids = [...pendingTimeouts.keys()];
        for (const id of ids) {
          const fn = pendingTimeouts.get(id);
          if (fn) {
            pendingTimeouts.delete(id);
            fn();
          }
        }
      },
      triggerInterval() {
        if (intervalCallback) intervalCallback();
      },
    };
    mockWindow.top = mockWindow;

    Object.defineProperty(globalThis, "document", {
      value: doc,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "window", {
      value: mockWindow,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "sessionStorage", {
      value: sessionStorageMock,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "localStorage", {
      value: localStorageMock,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    if (widget && widget.container) {
      widget.unmount();
    }
  });

  test("mounts with drag handle and elements rendered", () => {
    widget = new RecordingWidget(callbacks);
    widget.mount();

    assert.equal(widget.container !== undefined, true);
    const dragHandle = mockRootElement.querySelector(".__wbr_drag_handle");
    assert.ok(dragHandle);
    assert.equal(dragHandle.textContent, "⋮⋮");
  });

  test("triggers collapse after 1.5 seconds of inactivity and recovers on mouseenter", () => {
    widget = new RecordingWidget(callbacks);
    widget.mount();

    assert.equal(
      mockRootElement.classList.contains("__wbr_collapsed__"),
      false
    );

    (globalThis.window as any).triggerCollapseTimer();

    assert.equal(
      mockRootElement.classList.contains("__wbr_collapsed__"),
      true,
      "Widget should be collapsed after inactivity timeout"
    );

    mockRootElement.dispatchEvent({ type: "mouseenter" });
    assert.equal(
      mockRootElement.classList.contains("__wbr_collapsed__"),
      false,
      "MouseEnter should expand widget"
    );
  });

  test("stays expanded while mouse hovers and only collapses after mouse leaves", () => {
    widget = new RecordingWidget(callbacks);
    widget.mount();

    // 鼠标悬停：即使折叠计时器到点也不应折叠
    mockRootElement.dispatchEvent({ type: "mouseenter" });
    (globalThis.window as any).triggerCollapseTimer();
    assert.equal(
      mockRootElement.classList.contains("__wbr_collapsed__"),
      false,
      "Widget should stay expanded while mouse is hovering"
    );

    // 悬停期间移动鼠标：持续保持展开
    mockRootElement.dispatchEvent({ type: "mousemove" });
    (globalThis.window as any).triggerCollapseTimer();
    assert.equal(
      mockRootElement.classList.contains("__wbr_collapsed__"),
      false,
      "Widget should keep expanding on mousemove while hovering"
    );

    // 鼠标移出后才开始折叠倒计时
    mockRootElement.dispatchEvent({ type: "mouseleave" });
    assert.equal(
      mockRootElement.classList.contains("__wbr_collapsed__"),
      false,
      "Widget should not collapse immediately on mouseleave"
    );
    (globalThis.window as any).triggerCollapseTimer();
    assert.equal(
      mockRootElement.classList.contains("__wbr_collapsed__"),
      true,
      "Widget should collapse after mouse leaves and timeout elapses"
    );
  });

  test("resets saved position to default on explicit resetPosition for a new recording session", () => {
    sessionStorage.setItem(
      "__wbr_widget_pos__",
      JSON.stringify({ right: "120px", top: "240px" })
    );

    widget = new RecordingWidget(callbacks);
    widget.resetPosition();

    assert.equal(
      sessionStorage.getItem("__wbr_widget_pos__"),
      null,
      "Saved position should be cleared when starting a new recording session"
    );
  });

  test("restores saved drag position on re-mount within the same session", () => {
    sessionStorage.setItem(
      "__wbr_widget_pos__",
      JSON.stringify({ right: "120px", top: "240px" })
    );

    widget = new RecordingWidget(callbacks);
    widget.mount();

    // 同一会话内重挂载（标记问题后返回）应恢复用户拖拽的位置，
    // 而非跳回默认右下角遮挡页面内容
    assert.equal(
      sessionStorage.getItem("__wbr_widget_pos__"),
      JSON.stringify({ right: "120px", top: "240px" }),
      "Saved position should survive re-mount within the same session"
    );
    assert.equal(
      mockRootElement.style.top,
      "240px",
      "Widget should restore the saved top position"
    );
    assert.equal(
      mockRootElement.style.right,
      "120px",
      "Widget should restore the saved right position"
    );
    assert.equal(
      mockRootElement.style.bottom,
      "auto",
      "Widget should clear bottom when restoring top/right position"
    );
    assert.equal(
      mockRootElement.style.left,
      "auto",
      "Widget should clear left when restoring top/right position"
    );
  });

  test("clamps restored position to current viewport bounds", () => {
    // 窗口比保存位置时更小：保存的 right/top 超出视口，应被钳制回可视范围
    sessionStorage.setItem(
      "__wbr_widget_pos__",
      JSON.stringify({ right: "5000px", top: "3000px" })
    );

    widget = new RecordingWidget(callbacks);
    widget.mount();

    const rect = mockRootElement.getBoundingClientRect(); // width 200, height 40
    const maxRight = 1200 - rect.width; // 1000
    const maxTop = 800 - rect.height; // 760
    assert.equal(
      mockRootElement.style.top,
      `${maxTop}px`,
      "Restored top should be clamped to the visible viewport"
    );
    assert.equal(
      mockRootElement.style.right,
      `${maxRight}px`,
      "Restored right should be clamped to the visible viewport"
    );
  });

  test("sessionId 匹配时恢复已保存位置（例如在同一次会话内刷新页面）", () => {
    sessionStorage.setItem(
      "__wbr_widget_pos__",
      JSON.stringify({ sessionId: "session-123", right: "150px", top: "180px" })
    );

    widget = new RecordingWidget({
      ...callbacks,
      getSessionId: () => "session-123",
    });
    widget.mount();

    assert.equal(
      mockRootElement.style.top,
      "180px",
      "匹配 sessionId 时应恢复位置"
    );
    assert.equal(
      mockRootElement.style.right,
      "150px",
      "匹配 sessionId 时应恢复位置"
    );
  });

  test("sessionId 不匹配时不恢复位置（新会话已开始）", () => {
    mockRootElement.style.top = "";
    mockRootElement.style.right = "";

    sessionStorage.setItem(
      "__wbr_widget_pos__",
      JSON.stringify({ sessionId: "old-session", right: "150px", top: "180px" })
    );

    widget = new RecordingWidget({
      ...callbacks,
      getSessionId: () => "new-session",
    });
    widget.mount();

    assert.equal(
      mockRootElement.style.top,
      "",
      "来自其他会话的已保存位置应被忽略"
    );
    assert.equal(
      mockRootElement.style.right,
      "",
      "来自其他会话的已保存位置应被忽略"
    );
  });

  test("setSavingState(false) restores interactive state after a failed stop", () => {
    const startMs = Date.now() - 10_000; // 已录制 10 秒
    widget = new RecordingWidget({
      ...callbacks,
      getStartedAtEpochMs: () => startMs,
    });
    widget.mount();

    const timerDisplay = mockRootElement.querySelector(
      "#__wbr_timer_display__"
    );
    assert.equal(timerDisplay.textContent, "00:10");

    // 进入保存中：隐藏交互（saving class）、冻结计时并显示 spinner 文案
    widget.setSavingState(true);
    assert.equal(mockRootElement.classList.contains("__wbr_saving__"), true);
    assert.match(timerDisplay.innerHTML, /__wbr_spinner/);
    assert.notEqual(timerDisplay.textContent, "00:10");

    // 停止失败后恢复：saving 样式移除、计时显示回到 mm:ss、计时器重新运行
    widget.setSavingState(false);
    assert.equal(mockRootElement.classList.contains("__wbr_saving__"), false);
    assert.equal(timerDisplay.textContent, "00:10");

    // 计时器已重启：再次触发 interval 仍正常刷新显示（不再残留 spinner）
    (globalThis.window as any).triggerInterval();
    assert.equal(timerDisplay.textContent, "00:10");
    assert.match(timerDisplay.textContent, /^\d{2}:\d{2}$/);
  });

  test("deducts paused duration correctly in timer display when idle paused", () => {
    let isPaused = false;
    let pausedDurationMs = 0;
    const startMs = Date.now() - 10_000; // 已经开始录制 10 秒

    const testCallbacks = {
      ...callbacks,
      getStartedAtEpochMs: () => startMs,
      isIdlePaused: () => isPaused,
      getPausedDurationMs: () => pausedDurationMs,
    };

    widget = new RecordingWidget(testCallbacks);
    widget.mount();

    // 初始运行状态：已录制 10 秒，显示 00:10
    (globalThis.window as any).triggerInterval();
    const timerDisplay = mockRootElement.querySelector(
      "#__wbr_timer_display__"
    );
    assert.equal(timerDisplay.textContent, "00:10");

    // 切换为闲置暂停状态，暂停了 4 秒
    isPaused = true;
    pausedDurationMs = 4_000;
    (globalThis.window as any).triggerInterval();

    // 应扣除 4 秒暂停时间：显示 00:06，左侧 Tag 显示本地化闲置暂停文案
    assert.equal(timerDisplay.textContent, "00:06");
    const recTag = mockRootElement.querySelector("[data-wbr-rec-tag]");
    assert.equal(recTag?.textContent, t("idlePaused"));
  });

  test("setIssueSelecting(false) restores mark-issue button after a cancelled selection", () => {
    widget = new RecordingWidget(callbacks);
    widget.mount();

    const issueBtn = mockRootElement.querySelector(
      "#__wbr_issue_btn__"
    ) as unknown as {
      disabled: boolean;
      textContent: string;
      style: { opacity: string };
    };
    assert.ok(issueBtn, "Issue button should exist in widget");
    assert.equal(issueBtn.disabled, false);

    // 进入选择模式（proceedToIssueSelection）：按钮禁用并显示「选择中…」
    widget.setIssueSelecting(true);
    assert.equal(issueBtn.disabled, true);
    assert.equal(issueBtn.textContent, t("selecting"));
    assert.equal(issueBtn.style.opacity, ".72");

    // 取消选择后恢复（onCancel 路径）：按钮可用、文案回到「标记问题 (快捷键)」
    widget.setIssueSelecting(false);
    assert.equal(issueBtn.disabled, false);
    assert.equal(
      issueBtn.textContent,
      `${t("markIssue")} (${widget.shortcutKeyText})`
    );
    assert.equal(issueBtn.style.opacity, "1");
  });

  test("卸载并重新挂载会自动清除 isSelectingIssue 状态", () => {
    widget = new RecordingWidget(callbacks);
    widget.mount();

    widget.setIssueSelecting(true);
    widget.unmount();
    widget.mount();

    const issueBtn = mockRootElement.querySelector(
      "#__wbr_issue_btn__"
    ) as unknown as {
      disabled: boolean;
      textContent: string;
      style: { opacity: string };
    };
    assert.equal(
      issueBtn.disabled,
      false,
      "重新挂载后标记按钮不得处于禁用状态"
    );
    assert.equal(
      issueBtn.textContent,
      `${t("markIssue")} (${widget.shortcutKeyText})`,
      "重新挂载后标记按钮必须恢复默认文本"
    );
  });

  test("shows toast notification with zen light style consistent with preview page", () => {
    widget = new RecordingWidget(callbacks);
    widget.showToast("测试提示文本");

    const toast = document.querySelector("#__wbr_toast__") as HTMLElement;
    assert.ok(toast, "Toast element should exist in DOM");
    assert.match(toast.textContent || "", /测试提示文本/);
    assert.match(toast.style.cssText, /background:\s*#ffffff/);
    assert.match(toast.style.cssText, /color:\s*#1d2129/);
    assert.match(
      toast.style.cssText,
      /border:\s*1px solid rgba\(0,\s*0,\s*0,\s*0\.08\)/
    );
  });

  test("shows an error toast with a red icon", () => {
    widget = new RecordingWidget(callbacks);
    widget.showToast("导出失败", 2800, "error");

    const toast = document.querySelector("#__wbr_toast__") as HTMLElement;
    assert.ok(toast, "Toast element should exist in DOM");
    assert.match(toast.textContent || "", /导出失败/);
    assert.match(toast.innerHTML, /color:#d5484c/);
  });

  test("录制挂件 showToast 支持双行渲染", () => {
    widget = new RecordingWidget(callbacks);
    widget.showToast("主标题\n副标题 (按 ⌘V 粘贴)");
    const toast = document.querySelector("#__wbr_toast__") as HTMLElement;
    assert.ok(toast, "页面必须渲染 #__wbr_toast__");
    assert.ok(toast.innerHTML.includes("主标题"), "Toast 应包含主标题");
    assert.ok(toast.innerHTML.includes("副标题"), "Toast 应包含副标题");
    assert.ok(
      toast.innerHTML.includes("<kbd"),
      "Toast 中的快捷键应被包装为 kbd 键帽"
    );
  });

  test("录制挂件 showToast 支持渲染操作按钮并响应点击", () => {
    widget = new RecordingWidget(callbacks);
    let clicked = false;
    widget.showToast("主标题\n副标题", 5000, "normal", {
      label: "预览 ↗",
      onClick: () => {
        clicked = true;
      },
    });

    const toast = document.querySelector("#__wbr_toast__") as HTMLElement;
    assert.ok(toast, "页面必须渲染 #__wbr_toast__");
    assert.ok(toast.innerHTML.includes("·"), "Toast 第二行应包含中点分隔符");
    const actionBtn = toast.querySelector(
      "#__wbr_toast_action__"
    ) as HTMLElement;
    assert.ok(actionBtn, "Toast 中应渲染行内操作链接 #__wbr_toast_action__");
    assert.equal(actionBtn.textContent, "预览 ↗");
    assert.match(actionBtn.style.cssText, /cursor:\s*pointer/);

    // 触发鼠标悬停与移出
    actionBtn.dispatchEvent({ type: "mouseenter" });
    assert.equal(actionBtn.style.color, "#0e42d2");
    assert.equal(actionBtn.style.textDecoration, "underline");
    actionBtn.dispatchEvent({ type: "mouseleave" });
    assert.equal(actionBtn.style.color, "#165dff");
    assert.equal(actionBtn.style.textDecoration, "none");

    // 点击操作按钮触发回调
    actionBtn.dispatchEvent({
      type: "click",
      stopPropagation: () => {},
    });
    assert.equal(clicked, true, "点击操作按钮必须触发 onClick 回调");
  });

  test("录制挂件 showToast 支持 3 行独立渲染且操作按钮保留在第 2 行副标题内", () => {
    widget = new RecordingWidget(callbacks);
    widget.showToast(
      "主标题\n副标题 (按 ⌘V 粘贴)\n第三行引导提示",
      6000,
      "normal",
      {
        label: "预览 ↗",
        onClick: () => {},
      }
    );

    const toast = document.querySelector("#__wbr_toast__") as HTMLElement;
    assert.ok(toast, "页面必须渲染 #__wbr_toast__");
    assert.match(
      toast.innerHTML,
      /<div[^>]*>主标题<\/div>/,
      "第 1 行主标题应渲染在独立 div 中"
    );
    assert.match(
      toast.innerHTML,
      /<div[^>]*>副标题 \(按 <kbd[^>]*>⌘V<\/kbd> 粘贴\)<span[^>]*>·<\/span><span id="__wbr_toast_action__"[^>]*>预览 ↗<\/span><\/div>/,
      "第 2 行副标题与操作按钮应保持在同一 div 内且未混入第 3 行引导提示"
    );
    assert.match(
      toast.innerHTML,
      /<div[^>]*border-top:1px solid rgba\(0,0,0,0\.06\)!important;[^>]*>第三行引导提示<\/div>/,
      "第 3 行引导提示应渲染在带顶部边框分隔的独立 div 中"
    );
  });

  test("首次挂载录制悬浮条时展示跟随轻气泡，且气泡展示期间保持展开", () => {
    storageMap.delete("__wbr_widget_bubble_seen__");
    widget = new RecordingWidget(callbacks);
    widget.mount();

    const bubble = document.querySelector(
      "#__wbr_widget_bubble__"
    ) as HTMLElement;
    assert.ok(bubble, "首次录制必须在 DOM 中挂载提示气泡");
    assert.match(bubble.textContent || "", /正在录制/);
    assert.match(bubble.textContent || "", /⌥S|Option\+S|Alt\+S/);

    // 气泡展示期间，即使触发折叠倒计时也不折叠
    (globalThis.window as any).triggerCollapseTimer();
    assert.equal(
      mockRootElement.classList.contains("__wbr_collapsed__"),
      false,
      "气泡展示期间悬浮条必须保持展开态"
    );
  });

  test("气泡不自动消失，只有用户点击关闭或确认才关闭并记录已看标记", () => {
    storageMap.delete("__wbr_widget_bubble_seen__");
    widget = new RecordingWidget(callbacks);
    widget.mount();

    let bubble = document.querySelector(
      "#__wbr_widget_bubble__"
    ) as HTMLElement;
    assert.ok(bubble, "挂载初始必须有气泡");

    // 不论触发多少次常规计时器，气泡都不得自动消失
    (globalThis.window as any).triggerBubbleTimer();
    bubble = document.querySelector("#__wbr_widget_bubble__") as HTMLElement;
    assert.ok(bubble, "气泡不得自动消失");

    // 用户点击气泡上的关闭/我知道了
    bubble.dispatchEvent({ type: "click" });
    // 触发 250ms 淡出移除计时
    (globalThis.window as any).triggerBubbleTimer();

    bubble = document.querySelector("#__wbr_widget_bubble__") as HTMLElement;
    assert.equal(bubble, null, "用户点击后气泡必须从 DOM 移除");
    assert.equal(storageMap.get("__wbr_widget_bubble_seen__"), "true");
  });

  test("点击气泡立即关闭并记录已看标记", () => {
    storageMap.delete("__wbr_widget_bubble_seen__");
    widget = new RecordingWidget(callbacks);
    widget.mount();

    const bubble = document.querySelector(
      "#__wbr_widget_bubble__"
    ) as HTMLElement;
    assert.ok(bubble, "挂载初始必须有气泡");

    // 点击气泡
    bubble.dispatchEvent({ type: "click" });
    // 触发 250ms 淡出移除计时
    (globalThis.window as any).triggerBubbleTimer();

    const bubbleAfter = document.querySelector("#__wbr_widget_bubble__");
    assert.equal(bubbleAfter, null, "点击气泡后应立即淡出销毁");
    assert.equal(storageMap.get("__wbr_widget_bubble_seen__"), "true");
  });

  test("PC 桌面端 100% 无损还原：彻底隐藏显式折叠按钮 [▾]，恢复 mouseenter 展开与 1500ms 自动收起", () => {
    const win = globalThis.window as any;
    win.innerWidth = 1200;
    win.innerHeight = 800;

    widget = new RecordingWidget(callbacks);
    widget.mount();

    // PC 桌面端不应挂载移动仿真模式属性
    assert.equal(
      mockRootElement.dataset.wbrMobileMode,
      undefined,
      "PC 端不得挂载 data-wbr-mobile-mode"
    );

    // PC 桌面端子流程隐身调用不影响挂件可见性
    widget.setSuppressedForSubflow(true);
    assert.equal(
      mockRootElement.attributes["data-wbr-suppressed"],
      undefined,
      "PC 端 setSuppressedForSubflow 不得给挂件挂载 data-wbr-suppressed"
    );
    widget.setSuppressedForSubflow(false);

    // PC 桌面端鼠标移出后 1500ms 自动收起为胶囊
    mockRootElement.dispatchEvent({ type: "mouseleave" });
    win.triggerCollapseTimer();
    assert.equal(
      mockRootElement.classList.contains("__wbr_collapsed__"),
      true,
      "PC 桌面端鼠标移出 1500ms 后应自动收起"
    );

    // 鼠标移入恢复展开
    mockRootElement.dispatchEvent({ type: "mouseenter" });
    assert.equal(
      mockRootElement.classList.contains("__wbr_collapsed__"),
      false,
      "PC 桌面端鼠标移入应恢复展开"
    );
  });

  test("PC 桌面端拖拽手柄 Pointer Events 拖拽与视口 resize 边界钳制", () => {
    const win = globalThis.window as any;
    win.innerWidth = 1200;
    win.innerHeight = 800;
    storageMap.delete("__wbr_widget_bubble_seen__");

    widget = new RecordingWidget(callbacks);
    widget.mount();

    const dragHandle = mockRootElement.querySelector(".__wbr_drag_handle");
    assert.ok(dragHandle);

    // 1. pointerdown -> pointermove -> pointerup 正常拖拽（含越界钳制与指针捕获）
    dragHandle.dispatchEvent({
      type: "pointerdown",
      pointerId: 7,
      button: 0,
      clientX: 150,
      clientY: 120,
    });
    assert.deepEqual(dragHandle.capturedPointerIds, [7]);

    // 拖出右边界与下边界：应钳制在 [0, 1200 - 200] 与 [0, 800 - 40]
    win.dispatchEvent({
      type: "pointermove",
      pointerId: 7,
      clientX: 1500,
      clientY: 1000,
    });
    assert.equal(mockRootElement.style.right, "0px");
    assert.equal(mockRootElement.style.top, "760px");

    win.dispatchEvent({ type: "pointerup", pointerId: 7 });
    assert.deepEqual(dragHandle.releasedPointerIds, [7]);
    assert.ok(sessionStorage.getItem("__wbr_widget_pos__"));

    // 2. pointercancel 同样结束拖拽并释放指针捕获
    dragHandle.dispatchEvent({
      type: "pointerdown",
      pointerId: 9,
      button: 0,
      clientX: 120,
      clientY: 110,
    });
    win.dispatchEvent({
      type: "pointermove",
      pointerId: 9,
      clientX: 100,
      clientY: 300,
    });
    win.dispatchEvent({ type: "pointercancel", pointerId: 9 });
    assert.deepEqual(dragHandle.releasedPointerIds, [7, 9]);

    // 3. 视口 resize（含 visualViewport resize）：位置应重新钳制进新视口
    widget.container!.style.setProperty("right", "1100px");
    widget.container!.style.setProperty("top", "750px");
    win.innerWidth = 1000;
    win.innerHeight = 600;
    win.visualViewport.dispatchEvent({ type: "resize" });

    assert.equal(mockRootElement.style.right, "800px"); // maxRight = 1000 - 200
    assert.equal(mockRootElement.style.top, "560px"); // maxTop = 600 - 40
  });

  test("移动仿真态全新双态交互：默认侧边磁吸胶囊、轻点侧边菜单展开、一键换边、全胶囊拖拽吸附与子流程互斥隐身", () => {
    const win = globalThis.window as any;
    win.innerWidth = 375;
    win.innerHeight = 667;
    storageMap.delete("__wbr_widget_bubble_seen__");

    let stoppedExportMode: string | undefined;
    let markIssueCalled = false;
    let discardCalled = false;

    const testCallbacks = {
      ...callbacks,
      onStop: (info?: WidgetClickInfo) => {
        stoppedExportMode = info?.exportMode;
      },
      onMarkIssue: () => {
        markIssueCalled = true;
      },
      onDiscard: () => {
        discardCalled = true;
      },
    };

    widget = new RecordingWidget(testCallbacks);
    widget.mount();

    // 1. 验证移动仿真模式属性与默认右侧靠边停靠
    assert.equal(
      mockRootElement.dataset.wbrMobileMode,
      "true",
      "应挂载 data-wbr-mobile-mode='true'"
    );
    assert.equal(mockRootElement.dataset.wbrEdge, "right", "默认应贴右侧停靠");
    const arrow = mockRootElement.querySelector(".__wbr_mobile_arrow__");
    assert.ok(arrow);
    assert.equal(arrow.textContent, "‹", "贴右侧时箭头向内指向左");

    // 验证 Y 坐标避开顶部 56px 和底部 76px
    const topPx = Number.parseFloat(mockRootElement.style.top || "0");
    assert.ok(
      topPx >= 56 && topPx <= 667 - 76 - 32,
      `Y 坐标 ${topPx} 应在安全保护区内`
    );

    // 2. 全胶囊轻点（移动距离 < 6px）：展开紧凑侧边菜单
    mockRootElement.dispatchEvent({
      type: "pointerdown",
      button: 0,
      clientX: 350,
      clientY: 400,
    });
    win.dispatchEvent({
      type: "pointerup",
    });

    const menu = document.querySelector("#__wbr_mobile_menu__");
    assert.ok(menu, "轻点胶囊后应在 DOM 中展开移动端侧边菜单");
    const backdrop = document.querySelector("#__wbr_mobile_menu_backdrop__");
    assert.ok(backdrop, "应有 Light Dismiss 透明点击拦截遮罩");

    // 3. 一键换边：点击菜单内换边按钮，胶囊与菜单贴至左侧（方案 A：12×12 图标 + aria-label 同步）
    const dockBtn = mockRootElement.querySelector("#__wbr_mobile_dock_btn__");
    assert.ok(dockBtn);
    assert.match(dockBtn.textContent, /靠左/);
    assert.equal(dockBtn.title, "靠左");
    assert.equal(dockBtn.getAttribute("aria-label"), "靠左");
    dockBtn.click();

    assert.equal(
      mockRootElement.dataset.wbrEdge,
      "left",
      "点击换边后胶囊应贴靠左边缘"
    );
    assert.equal(arrow.textContent, "›", "贴左侧时箭头向内指向右");
    assert.match(dockBtn.textContent, /靠右/, "换边后按钮文案应翻转为靠右");
    assert.equal(dockBtn.title, "靠右", "换边后按钮 title 应翻转为靠右");
    assert.equal(
      dockBtn.getAttribute("aria-label"),
      "靠右",
      "换边后按钮 aria-label 应翻转为靠右"
    );

    // 4. 关闭菜单（Light Dismiss / Close Btn）
    const closeBtn = mockRootElement.querySelector("#__wbr_mobile_close_btn__");
    assert.ok(closeBtn);
    closeBtn.click();
    assert.equal(
      document.querySelector("#__wbr_mobile_menu__"),
      null,
      "点击关闭菜单应收起菜单"
    );

    // 再次轻点打开菜单测试操作按钮回调
    mockRootElement.dispatchEvent({
      type: "pointerdown",
      button: 0,
      clientX: 10,
      clientY: 400,
    });
    win.dispatchEvent({ type: "pointerup" });
    assert.ok(document.querySelector("#__wbr_mobile_menu__"));

    // 点击工单按钮触发 onStop(ticket) 且关闭菜单
    const ticketBtn = mockRootElement.querySelector(
      "#__wbr_mobile_ticket_btn__"
    );
    assert.ok(ticketBtn);
    ticketBtn.click();
    assert.equal(stoppedExportMode, "ticket");
    assert.equal(document.querySelector("#__wbr_mobile_menu__"), null);

    // 5. 子流程互斥隐身（仅移动仿真态生效）
    widget.setSuppressedForSubflow(true);
    assert.equal(
      mockRootElement.attributes["data-wbr-suppressed"],
      "true",
      "进入子流程时移动端挂件应设置 data-wbr-suppressed='true'"
    );

    widget.setSuppressedForSubflow(false);
    assert.equal(
      mockRootElement.attributes["data-wbr-suppressed"],
      undefined,
      "退出子流程时应清除 data-wbr-suppressed"
    );

    // 6. 全胶囊平滑拖拽（移动距离 >= 6px）与松手磁吸吸附
    mockRootElement.dispatchEvent({
      type: "pointerdown",
      button: 0,
      clientX: 10,
      clientY: 400,
    });
    // 向右拖拽 260px，中心到达 > 187.5px 区域
    win.dispatchEvent({
      type: "pointermove",
      clientX: 270,
      clientY: 420,
    });
    win.dispatchEvent({ type: "pointerup" });

    assert.equal(
      mockRootElement.dataset.wbrEdge,
      "right",
      "松手后应自动磁吸至最近的右边缘"
    );
    const savedPos = JSON.parse(
      sessionStorage.getItem("__wbr_widget_pos__") || "{}"
    );
    assert.equal(savedPos.edge, "right");
    assert.ok(typeof savedPos.yRatio === "number");

    // 7. 移动仿真态 Saving 状态
    widget.setSavingState(true, "保存中...");
    assert.equal(mockRootElement.classList.contains("__wbr_saving__"), true);
    assert.match(
      mockRootElement.querySelector("#__wbr_timer_display__").innerHTML,
      /保存中\.\.\./
    );
    widget.setSavingState(false);
    assert.equal(mockRootElement.classList.contains("__wbr_saving__"), false);
  });

  test("移动端切回 PC 桌面端：清除移动态 inline 坐标样式，防移动端位置污染 PC 端，恢复 PC 默认右下角定位", () => {
    const win = globalThis.window as any;
    win.innerWidth = 375;
    win.innerHeight = 667;
    sessionStorage.clear();

    widget = new RecordingWidget(callbacks);
    widget.mount();

    // 移动态下确认有 inline top/right/left/bottom 样式
    assert.equal(mockRootElement.dataset.wbrMobileMode, "true");
    assert.notEqual(mockRootElement.style.top, "");

    // 模拟切回 PC 桌面端 (1280x800)
    win.innerWidth = 1280;
    win.innerHeight = 800;
    win.visualViewport.dispatchEvent({ type: "resize" });

    // 验证移动模式属性被移除
    assert.equal(mockRootElement.dataset.wbrMobileMode, undefined);
    assert.equal(mockRootElement.dataset.wbrEdge, undefined);

    // 验证 inline top/bottom/left/right 已被彻底移除，恢复由 PC 默认 CSS 规则生效
    assert.equal(mockRootElement.style.top, "");
    assert.equal(mockRootElement.style.bottom, "");
    assert.equal(mockRootElement.style.left, "");
    assert.equal(mockRootElement.style.right, "");
  });

  test("移动仿真态 Code Review 缺陷修复综合验证：移动拖拽中 unmount 清理监听器、healthMsg XSS 转义、快捷键不裁切与气泡边界钳制", () => {
    const win = globalThis.window as any;
    win.innerWidth = 375;
    win.innerHeight = 667;
    storageMap.delete("__wbr_widget_bubble_seen__");

    widget = new RecordingWidget({ ...callbacks, isMac: false });
    widget.mount();

    // 1. 验证 Windows 快捷键完整性与移动菜单 CSS 规则
    assert.equal(widget.shortcutKeyText, "Alt+S");
    assert.equal(widget.stopShortcutKeyText, "Ctrl+Shift+Y");
    assert.match(
      mockRootElement.innerHTML,
      /width:\s*max-content\s*!important/
    );
    assert.match(
      mockRootElement.innerHTML,
      /max-width:\s*min\(calc\(100vw - 92px\),\s*240px\)\s*!important/
    );

    // 2. healthMsg XSS 转义验证
    const maliciousMsg = '<script>alert("xss")</script>&"\'';
    widget.updateHealth({
      code: "RECORDER_ERROR",
      message: maliciousMsg,
      badgeText: "ERR",
      badgeColor: "#f53f3f",
    });
    // 打开移动菜单
    mockRootElement.dispatchEvent({
      type: "pointerdown",
      button: 0,
      clientX: 350,
      clientY: 400,
    });
    win.dispatchEvent({ type: "pointerup" });
    const mobileMenu = document.querySelector("#__wbr_mobile_menu__");
    assert.ok(mobileMenu);
    assert.doesNotMatch(mobileMenu.innerHTML, /<script>/);
    assert.match(mobileMenu.innerHTML, /&lt;script&gt;/);

    // 3. 气泡宽度钳制：移动端贴右停靠时气泡 max-width 应受控避开左边缘
    const bubble = document.querySelector(
      "#__wbr_widget_bubble__"
    ) as HTMLElement;
    if (bubble) {
      const bubbleMaxWidthStr =
        (bubble.style as any)["max-width"] || bubble.style.maxWidth || "";
      assert.match(bubbleMaxWidthStr, /px/);
      const bubbleMaxWidth = Number.parseFloat(bubbleMaxWidthStr);
      assert.ok(
        bubbleMaxWidth <= 375 - 68 - 16,
        "气泡 max-width 必须钳制在视口可用宽度内"
      );
    }

    // 4. 移动拖拽中途调用 unmount()，全局 window 监听器必须干净移除
    mockRootElement.dispatchEvent({
      type: "pointerdown",
      button: 0,
      clientX: 350,
      clientY: 400,
    });
    // 移动 > 6px 激活拖拽状态
    win.dispatchEvent({
      type: "pointermove",
      clientX: 300,
      clientY: 400,
    });
    assert.equal(widget.isDragging, true);

    // 此时直接 unmount
    widget.unmount();
    assert.equal(widget.isDragging, false);
    assert.equal(widget.cleanupDragListeners, undefined);
  });

  test("构造参数 isMac 与 setIsMac() 动态刷新快捷键文案与 tooltip", () => {
    widget = new RecordingWidget({ ...callbacks, isMac: false });
    widget.mount();

    assert.equal(widget.shortcutKeyText, "Alt+S");
    assert.equal(widget.stopShortcutKeyText, "Ctrl+Shift+Y");

    const issueBtn = mockRootElement.querySelector("#__wbr_issue_btn__");
    const stopBtn = mockRootElement.querySelector("#__wbr_stop_btn__");
    assert.match(issueBtn.textContent, /Alt\+S/);
    assert.match(issueBtn.title, /Alt\+S/);
    assert.match(stopBtn.title, /Ctrl\+Shift\+Y/);

    widget.setIsMac(true);
    assert.equal(widget.shortcutKeyText, "⌥S");
    assert.equal(widget.stopShortcutKeyText, "⇧⌘Y");
    assert.match(issueBtn.textContent, /⌥S/);
    assert.match(issueBtn.title, /⌥S/);
    assert.match(stopBtn.title, /⇧⌘Y/);
  });

  test("showToast 样式包含窄屏折行与 max-width: calc(100vw - 24px) 约束", () => {
    widget = new RecordingWidget(callbacks);
    widget.showToast(
      "窄屏长文本提示\n第二行包含 ⌘V 与可折行操作",
      4000,
      "normal",
      {
        label: "查看详情",
        onClick: () => {},
      }
    );

    const toast = document.querySelector("#__wbr_toast__") as HTMLElement;
    assert.ok(toast);
    assert.match(toast.style.cssText, /max-width:\s*calc\(100vw - 24px\)/);
    assert.match(toast.style.cssText, /box-sizing:\s*border-box/);
    assert.match(toast.style.cssText, /flex-wrap:\s*wrap/);
    assert.match(toast.style.cssText, /word-break:\s*break-word/);
  });
});

describe("RecordingWidget - i18n", () => {
  test("暂停状态标签不得硬编码英文文案，必须走 t()", () => {
    const source = readFileSync(WIDGET_SOURCE, "utf8");
    assert.ok(
      !source.includes('"IDLE PAUSED"') && !source.includes("'IDLE PAUSED'"),
      "recording-widget.ts 不得硬编码 'IDLE PAUSED'，应通过 t('idlePaused') 提供"
    );
    assert.ok(
      !source.includes('"PAUSED"') && !source.includes("'PAUSED'"),
      "recording-widget.ts 不得硬编码 'PAUSED'，应通过 t('widgetPaused') 提供"
    );
  });

  test("悬浮条与气泡 i18n key 必须双语言齐全且 en 文案不得混入中文", () => {
    const zhDict = loadDict("zh_CN");
    const enDict = loadDict("en");
    for (const key of [
      "idlePaused",
      "widgetPaused",
      "widgetBubbleGuide",
      "widgetBubbleGotIt",
      "widgetToolbarIssueTooltip",
      "widgetToolbarStopTooltip",
      "widgetCollapseTooltip",
      "widgetExpandTooltip",
      "discardRecording",
      "confirmDiscard",
      "widgetToolbarDiscardTooltip",
      "discarding",
      "recordingDiscarded",
    ] as const) {
      assert.ok(key in zhDict, `i18n key '${key}' 缺失于 zh_CN/messages.json`);
      assert.ok(key in enDict, `i18n key '${key}' 缺失于 en/messages.json`);
      assert.ok(zhDict[key].message.trim().length > 0, `zh 文案 '${key}' 为空`);
      assert.ok(enDict[key].message.trim().length > 0, `en 文案 '${key}' 为空`);
      assert.ok(
        !/[\u4e00-\u9fff]/.test(enDict[key].message),
        `en 文案 '${key}' 不得混入中文`
      );
    }
  });

  test("悬浮条圈选与停止按钮具有强化的 Tooltip 语义与快捷键提示", () => {
    const source = readFileSync(WIDGET_SOURCE, "utf8");
    assert.ok(
      source.includes(
        't("widgetToolbarIssueTooltip", [this.shortcutKeyText])'
      ) || source.includes('t("widgetToolbarIssueTooltip"'),
      "悬浮条 📷 按钮必须使用 widgetToolbarIssueTooltip 并注入快捷键"
    );
    assert.ok(
      source.includes(
        't("widgetToolbarStopTooltip", [this.stopShortcutKeyText])'
      ) || source.includes('t("widgetToolbarStopTooltip"'),
      "悬浮条 ⏹ 按钮必须使用 widgetToolbarStopTooltip 并注入快捷键"
    );
  });

  test("新手引导气泡按钮文案必须为行动驱动型 '开始操作'", () => {
    const zhDict = loadDict("zh_CN");
    const enDict = loadDict("en");
    assert.equal(zhDict.widgetBubbleGotIt.message, "开始操作");
    assert.match(enDict.widgetBubbleGotIt.message, /Start|Reproduce/i);
  });
});

describe("RecordingWidget - Smooth Close and Saving Lifecycle", () => {
  let widget: RecordingWidget;
  let mockRootElement: any;
  const callbacks = {
    onStop: () => {},
    onMarkIssue: () => {},
    getStartedAtEpochMs: () => Date.now(),
    isIdlePaused: () => false,
  };

  let stopBtnMock: any;
  let issueBtnMock: any;
  let discardBtnMock: any;
  let dragHandleMock: any;
  let stopCallCount = 0;
  let issueCallCount = 0;
  let discardCallCount = 0;

  beforeEach(() => {
    stopCallCount = 0;
    issueCallCount = 0;
    discardCallCount = 0;
    const createMockBtn = () => {
      const btnListeners = new Map<string, Function[]>();
      const btnClassSet = new Set<string>();
      return {
        style: {},
        disabled: false,
        textContent: "",
        title: "",
        classList: {
          add(cls: string) {
            btnClassSet.add(cls);
          },
          remove(cls: string) {
            btnClassSet.delete(cls);
          },
          contains(cls: string) {
            return btnClassSet.has(cls);
          },
        },
        addEventListener(event: string, fn: Function) {
          if (!btnListeners.has(event)) btnListeners.set(event, []);
          btnListeners.get(event)!.push(fn);
        },
        removeEventListener(event: string, fn: Function) {
          if (btnListeners.has(event)) {
            const arr = btnListeners.get(event)!;
            const idx = arr.indexOf(fn);
            if (idx >= 0) arr.splice(idx, 1);
          }
        },
        dispatchEvent(evt: any) {
          const fns = btnListeners.get(evt.type) || [];
          fns.forEach((fn) => fn(evt));
        },
        click() {
          const fns = btnListeners.get("click") || [];
          fns.forEach((fn) =>
            fn({
              stopPropagation() {},
              preventDefault() {},
              clientX: 10,
              clientY: 10,
            })
          );
        },
      };
    };
    stopBtnMock = createMockBtn();
    issueBtnMock = createMockBtn();
    discardBtnMock = createMockBtn();
    dragHandleMock = createMockBtn();

    const classSet = new Set<string>();
    mockRootElement = {
      id: "__wbr_recording_widget__",
      getBoundingClientRect() {
        return {
          left: 10,
          top: 10,
          right: 100,
          bottom: 50,
          width: 90,
          height: 40,
        };
      },
      style: {
        setProperty() {},
      },
      classList: {
        add(cls: string) {
          classSet.add(cls);
        },
        remove(cls: string) {
          classSet.delete(cls);
        },
        contains(cls: string) {
          return classSet.has(cls);
        },
      },
      setAttribute() {},
      addEventListener() {},
      removeEventListener() {},
      querySelector(sel: string) {
        if (sel.includes("timer_display")) {
          return { innerHTML: "", textContent: "" };
        }
        if (sel.includes("stop_btn")) {
          return stopBtnMock;
        }
        if (sel.includes("issue_btn")) {
          return issueBtnMock;
        }
        if (sel.includes("discard_btn")) {
          return discardBtnMock;
        }
        if (sel.includes("drag_handle")) {
          return dragHandleMock;
        }
        return null;
      },
      remove() {},
    };

    (globalThis as any).document = {
      body: {
        appendChild() {},
      },
      createElement() {
        return mockRootElement;
      },
    };
    const winListeners = new Map<string, Function[]>();
    (globalThis as any).window = {
      top: {},
      addEventListener(type: string, fn: Function) {
        if (!winListeners.has(type)) winListeners.set(type, []);
        winListeners.get(type)!.push(fn);
      },
      removeEventListener(type: string, fn: Function) {
        if (winListeners.has(type)) {
          const arr = winListeners.get(type)!;
          const idx = arr.indexOf(fn);
          if (idx >= 0) arr.splice(idx, 1);
        }
      },
      setInterval() {
        return 1;
      },
      clearInterval() {},
      setTimeout(fn: () => void, ms: number) {
        return setTimeout(fn, ms);
      },
      clearTimeout(id: any) {
        clearTimeout(id);
      },
    };
    (globalThis as any).window.top = (globalThis as any).window;
  });

  afterEach(() => {
    if (widget?.container) {
      widget.unmount();
    }
  });

  test("closeSmoothly 添加 __wbr_closing__ 类并平滑卸载挂件", async () => {
    widget = new RecordingWidget({
      ...callbacks,
      onStop: () => {
        stopCallCount++;
      },
    });
    widget.mount();
    assert.equal(widget.container !== undefined, true);
    assert.equal(widget.isClosing, false);

    const closePromise = widget.closeSmoothly(20);
    assert.equal(widget.isClosing, true);
    assert.equal(mockRootElement.classList.contains("__wbr_closing__"), true);
    await closePromise;
    assert.equal(widget.isClosing, false);
    assert.equal(widget.container, undefined);
  });

  test("closeSmoothly 并发调用返回同一 Promise，同时等待完成", async () => {
    widget = new RecordingWidget(callbacks);
    widget.mount();

    const p1 = widget.closeSmoothly(25);
    const p2 = widget.closeSmoothly(25);
    assert.equal(p1, p2);
    await Promise.all([p1, p2]);
    assert.equal(widget.container, undefined);
  });

  test("在 closeSmoothly 执行期间调用 mount()，中止正在关闭的旧挂件并成功挂载新挂件", async () => {
    widget = new RecordingWidget(callbacks);
    widget.mount();
    assert.equal(widget.container !== undefined, true);

    const closePromise = widget.closeSmoothly(50);
    assert.equal(widget.isClosing, true);

    // 在关闭过程中重新 mount（如快速开启新会话）
    widget.mount();
    assert.equal(widget.isClosing, false);
    assert.equal(widget.container !== undefined, true);

    // 原关闭任务即使到期，也不得销毁新挂载的 widget
    await closePromise;
    assert.equal(widget.container !== undefined, true);
  });

  test("在 closeSmoothly 执行期间调用 unmount()，清理定时器并正常 resolve", async () => {
    widget = new RecordingWidget(callbacks);
    widget.mount();

    const closePromise = widget.closeSmoothly(50);
    assert.equal(widget.isClosing, true);

    widget.unmount();
    assert.equal(widget.isClosing, false);
    assert.equal(widget.container, undefined);

    // closePromise 应当正常 resolve 而不是 hang
    await closePromise;
  });

  test("isSaving 或 isClosing 状态下点击 stop 与 issue 按钮被拦截，不触发重复回调", () => {
    widget = new RecordingWidget({
      ...callbacks,
      onStop: () => {
        stopCallCount++;
      },
      onMarkIssue: () => {
        issueCallCount++;
      },
    });
    widget.mount();

    // 正常状态点击：应当触发
    stopBtnMock.click();
    issueBtnMock.click();
    assert.equal(stopCallCount, 1);
    assert.equal(issueCallCount, 1);

    // setSavingState(true) 状态下点击：应当被拦截阻断
    widget.setSavingState(true);
    stopBtnMock.click();
    issueBtnMock.click();
    assert.equal(stopCallCount, 1);
    assert.equal(issueCallCount, 1);

    // 恢复正常后点击：恢复响应
    widget.setSavingState(false);
    stopBtnMock.click();
    assert.equal(stopCallCount, 2);

    // closeSmoothly 关闭状态下点击：应当被拦截阻断
    void widget.closeSmoothly(50);
    stopBtnMock.click();
    issueBtnMock.click();
    assert.equal(stopCallCount, 2);
    assert.equal(issueCallCount, 1);
  });

  test("setSavingState(true) 激活 isSaving 状态并在挂件添加 __wbr_saving__ 类", () => {
    widget = new RecordingWidget(callbacks);
    widget.mount();
    assert.equal(widget.isSaving, false);

    widget.setSavingState(true);
    assert.equal(widget.isSaving, true);
    assert.equal(mockRootElement.classList.contains("__wbr_saving__"), true);

    widget.setSavingState(false);
    assert.equal(widget.isSaving, false);
    assert.equal(mockRootElement.classList.contains("__wbr_saving__"), false);
  });

  test("未 mount 时调用 closeSmoothly 安全返回无异常", async () => {
    widget = new RecordingWidget(callbacks);
    assert.equal(widget.container, undefined);
    await widget.closeSmoothly(10);
    assert.equal(widget.container, undefined);
  });

  test("closeSmoothly(0) 立即卸载挂件并 resolve", async () => {
    widget = new RecordingWidget(callbacks);
    widget.mount();
    assert.equal(widget.container !== undefined, true);
    await widget.closeSmoothly(0);
    assert.equal(widget.isClosing, false);
    assert.equal(widget.container, undefined);
  });

  test("isClosing 状态下调用 setSavingState 无效，不破坏关闭状态", async () => {
    widget = new RecordingWidget(callbacks);
    widget.mount();
    const p = widget.closeSmoothly(30);
    assert.equal(widget.isClosing, true);
    widget.setSavingState(true);
    widget.setSavingState(false);
    assert.equal(widget.isClosing, true);
    await p;
    assert.equal(widget.container, undefined);
  });

  test("isClosing 状态下 updateLanguage、updatePauseState 与 updateHealth 安全忽略不操作 DOM", async () => {
    widget = new RecordingWidget(callbacks);
    widget.mount();
    const p = widget.closeSmoothly(30);
    widget.updateLanguage();
    widget.updatePauseState(true);
    widget.updateHealth({ badgeColor: "#000", message: "ok" });
    assert.equal(widget.isClosing, true);
    await p;
  });

  test("setSavingState(false) 恢复非保存状态并触发自动折叠定时器", () => {
    let timeoutMs = 0;
    const origSetTimeout = (globalThis as any).window.setTimeout;
    (globalThis as any).window.setTimeout = (fn: () => void, ms: number) => {
      timeoutMs = ms;
      return 999;
    };
    try {
      widget = new RecordingWidget(callbacks);
      widget.mount();
      widget.setSavingState(true);
      widget.setSavingState(false);
      assert.equal(widget.isSaving, false);
      assert.equal(timeoutMs, 1500);
    } finally {
      (globalThis as any).window.setTimeout = origSetTimeout;
    }
  });

  test("isSaving 状态下 updateLanguage、updatePauseState 与 updateHealth 安全忽略不操作 DOM", () => {
    widget = new RecordingWidget(callbacks);
    widget.mount();
    widget.setSavingState(true);
    assert.equal(widget.isSaving, true);

    widget.updateLanguage();
    widget.updatePauseState(true);
    widget.updateHealth({ badgeColor: "#000", message: "warn" });
    assert.equal(widget.isSaving, true);
    assert.equal(mockRootElement.classList.contains("__wbr_saving__"), true);
  });

  test("closeSmoothly(NaN) 安全回退默认时长并正常关闭", async () => {
    widget = new RecordingWidget(callbacks);
    widget.mount();
    assert.equal(widget.container !== undefined, true);
    // 传入 NaN，测试内部 safeDuration 防御性机制生效且顺利 resolve
    const p = widget.closeSmoothly(NaN as any);
    assert.equal(widget.isClosing, true);
    // 手动调用 unmount 加速结束测试并验证状态闭环
    widget.unmount();
    await p;
    assert.equal(widget.container, undefined);
  });

  test("在拖拽过程中调用 unmount()，能通过 cleanupDragListeners 干净移除 Pointer Events 与 resize 监听器", () => {
    const removedWinTypes: string[] = [];
    const removedViewportTypes: string[] = [];
    const origRemoveEventListener = (globalThis as any).window
      .removeEventListener;
    (globalThis as any).window.removeEventListener = (
      type: string,
      fn: any
    ) => {
      removedWinTypes.push(type);
      return origRemoveEventListener.call((globalThis as any).window, type, fn);
    };
    (globalThis as any).window.visualViewport = {
      addEventListener() {},
      removeEventListener(type: string) {
        removedViewportTypes.push(type);
      },
    };

    try {
      widget = new RecordingWidget(callbacks);
      widget.mount();

      // 触发 pointerdown 开启拖拽，并分发一次 pointermove
      const dragHandle = mockRootElement.querySelector(".__wbr_drag_handle");
      assert.ok(dragHandle);
      dragHandle.dispatchEvent({
        type: "pointerdown",
        pointerId: 3,
        button: 0,
        stopPropagation() {},
        preventDefault() {},
        clientX: 100,
        clientY: 200,
      });

      // 在拖拽中突然卸载
      widget.unmount();
      assert.ok(
        removedWinTypes.includes("pointermove") &&
          removedWinTypes.includes("pointerup") &&
          removedWinTypes.includes("pointercancel"),
        "卸载时应当清理 pointermove、pointerup 与 pointercancel 监听器"
      );
      assert.ok(
        removedWinTypes.includes("resize") &&
          removedViewportTypes.includes("resize"),
        "卸载时应当清理 window 与 visualViewport 的 resize 监听器"
      );
    } finally {
      (globalThis as any).window.removeEventListener = origRemoveEventListener;
    }
  });

  test("discard 按钮行内二次确认：首次点击进入确认态，二次点击触发 onDiscard", () => {
    widget = new RecordingWidget({
      ...callbacks,
      onDiscard: () => {
        discardCallCount++;
      },
    });
    widget.mount();

    assert.equal(discardBtnMock.textContent, t("discardRecording"));
    assert.equal(
      discardBtnMock.classList.contains("__wbr_confirming__"),
      false
    );

    // 首次点击：仅进入确认态，不触发 onDiscard
    discardBtnMock.click();
    assert.equal(discardCallCount, 0);
    assert.equal(discardBtnMock.textContent, t("confirmDiscard"));
    assert.equal(discardBtnMock.classList.contains("__wbr_confirming__"), true);

    // 二次点击：触发 onDiscard 并恢复按钮初始状态
    discardBtnMock.click();
    assert.equal(discardCallCount, 1);
    assert.equal(discardBtnMock.textContent, t("discardRecording"));
    assert.equal(
      discardBtnMock.classList.contains("__wbr_confirming__"),
      false
    );
  });

  test("discard 按钮行内二次确认：超时 3 秒未点击或点击其他按钮时自动恢复", () => {
    let confirmTimeoutFn: (() => void) | undefined;
    const origSetTimeout = (globalThis as any).window.setTimeout;
    (globalThis as any).window.setTimeout = (fn: () => void, ms: number) => {
      if (ms === 3000) {
        confirmTimeoutFn = fn;
        return 3001;
      }
      return origSetTimeout(fn, ms);
    };

    try {
      widget = new RecordingWidget({
        ...callbacks,
        onStop: () => {
          stopCallCount++;
        },
        onDiscard: () => {
          discardCallCount++;
        },
      });
      widget.mount();

      // 首次点击进入确认态
      discardBtnMock.click();
      assert.equal(
        discardBtnMock.classList.contains("__wbr_confirming__"),
        true
      );
      assert.ok(confirmTimeoutFn, "应当注册 3000ms 超时恢复定时器");

      // 触发 3 秒超时：自动恢复为初始态
      confirmTimeoutFn!();
      assert.equal(
        discardBtnMock.classList.contains("__wbr_confirming__"),
        false
      );
      assert.equal(discardBtnMock.textContent, t("discardRecording"));
      assert.equal(discardCallCount, 0);

      // 再次点击重新进入确认态，随后点击 stopBtn 应主动重置确认态
      discardBtnMock.click();
      assert.equal(
        discardBtnMock.classList.contains("__wbr_confirming__"),
        true
      );
      stopBtnMock.click();
      assert.equal(stopCallCount, 1);
      assert.equal(
        discardBtnMock.classList.contains("__wbr_confirming__"),
        false
      );
      assert.equal(discardCallCount, 0);
    } finally {
      (globalThis as any).window.setTimeout = origSetTimeout;
    }
  });
});
