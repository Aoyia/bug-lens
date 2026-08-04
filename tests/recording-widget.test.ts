import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { RecordingWidget } from "../src/entrypoints/content/collector/recording-widget.ts";

describe("RecordingWidget - Drag and Auto-Collapse", () => {
  let widget: RecordingWidget;
  const storageMap = new Map<string, string>();
  let mockRootElement: any;

  const callbacks = {
    onStop: () => {},
    onStopAndExport: () => {},
    onStopAndDiscard: () => {},
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
      const map = listenersMap.get(target);
      if (map && map[type]) {
        map[type].forEach((fn) => fn(event));
      }
    };

    const dragHandle = {
      textContent: "⋮⋮",
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

    const pauseBtn = {
      textContent: "Pause",
      style: {},
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

    const stopBtn = {
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
    };

    const classSet = new Set<string>();
    const styleObj: Record<string, string> = {};

    mockRootElement = {
      id: "__wbr_recording_widget__",
      style: {
        ...styleObj,
        setProperty(prop: string, val: string) {
          styleObj[prop] = val;
          (mockRootElement.style as any)[prop] = val;
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
      setAttribute(k: string, v: string) {},
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
        if (sel.includes("pause_btn")) return pauseBtn;
        if (sel.includes("stop_btn")) return stopBtn;
        if (sel.includes("timer_display")) return timerDisplay;
        return null;
      },
      remove() {},
    };

    const doc = {
      body: {
        appendChild(child: any) {},
      },
      createElement(tag: string) {
        return mockRootElement;
      },
      querySelector(sel: string) {
        if (sel === "#__wbr_recording_widget__") return mockRootElement;
        return null;
      },
      addEventListener() {},
    };

    let timeoutCallback: Function | undefined;
    let intervalCallback: Function | undefined;
    const mockWindow: any = {
      setInterval(fn: Function) {
        intervalCallback = fn;
        return 1;
      },
      clearInterval() {},
      setTimeout(fn: Function, ms: number) {
        if (ms === 1500) {
          timeoutCallback = fn;
          return 999;
        }
        return setTimeout(fn, ms) as any;
      },
      clearTimeout(id: any) {
        clearTimeout(id);
      },
      addEventListener() {},
      removeEventListener() {},
      triggerCollapseTimer() {
        if (timeoutCallback) timeoutCallback();
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

  test("resets position to default on new recording session mount", () => {
    sessionStorage.setItem(
      "__wbr_widget_pos__",
      JSON.stringify({ right: "120px", top: "240px" })
    );

    widget = new RecordingWidget(callbacks);
    widget.mount();

    assert.equal(
      sessionStorage.getItem("__wbr_widget_pos__"),
      null,
      "Saved position should be cleared on new recording session"
    );
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

    // 应扣除 4 秒暂停时间：显示 00:06 (idlePaused)
    assert.equal(timerDisplay.textContent, "00:06 (idlePaused)");
  });

  test("triggers onTogglePause callback when pause button clicked", () => {
    let pauseToggled = false;
    const testCallbacks = {
      ...callbacks,
      onTogglePause: () => {
        pauseToggled = true;
      },
    };

    widget = new RecordingWidget(testCallbacks);
    widget.mount();

    const pauseBtn = mockRootElement.querySelector("#__wbr_pause_btn__");
    assert.ok(pauseBtn);
    pauseBtn.dispatchEvent({
      type: "click",
      stopPropagation: () => {},
      preventDefault: () => {},
    });

    assert.equal(
      pauseToggled,
      true,
      "Clicking pause button should invoke onTogglePause callback"
    );
  });
});
