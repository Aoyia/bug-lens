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

    const issueBtn = {
      disabled: false,
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
        if (sel.includes("stop_btn")) return stopBtn;
        if (sel.includes("issue_btn")) return issueBtn;
        if (sel.includes("timer_display")) return timerDisplay;
        if (sel.includes("rec-tag")) return recTag;
        return null;
      },
      remove() {},
    };

    const appendedElements: any[] = [];
    const doc = {
      body: {
        appendChild(child: any) {
          appendedElements.push(child);
        },
      },
      createElement(tag: string) {
        let _innerHTML = "";
        const el: any = {
          id: "",
          style: {
            ...mockRootElement.style,
            cssText: "",
          },
          get innerHTML() {
            return _innerHTML;
          },
          set innerHTML(val: string) {
            _innerHTML = val;
            el.textContent = val.replace(/<[^>]*>/g, "");
          },
          textContent: "",
          setAttribute() {},
          remove() {
            const idx = appendedElements.indexOf(el);
            if (idx !== -1) appendedElements.splice(idx, 1);
          },
          querySelector(sel: string) {
            return mockRootElement.querySelector(sel);
          },
          classList: mockRootElement.classList,
          addEventListener: mockRootElement.addEventListener,
          removeEventListener: mockRootElement.removeEventListener,
          dispatchEvent: mockRootElement.dispatchEvent,
          getBoundingClientRect: mockRootElement.getBoundingClientRect,
        };
        return el;
      },
      querySelector(sel: string) {
        if (sel === "#__wbr_recording_widget__") return mockRootElement;
        const found = appendedElements.find((e) => e.id && `#${e.id}` === sel);
        if (found) return found;
        return null;
      },
      addEventListener() {},
    };

    let timeoutIdSeq = 1000;
    const pendingTimeouts = new Map<number, Function>();
    let intervalCallback: Function | undefined;
    const mockWindow: any = {
      innerWidth: 1200,
      innerHeight: 800,
      setInterval(fn: Function) {
        intervalCallback = fn;
        return 1;
      },
      clearInterval() {},
      setTimeout(fn: Function, ms: number) {
        if (ms === 1500) {
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
      addEventListener() {},
      removeEventListener() {},
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

  test("暂停状态 i18n key 必须双语言齐全且 en 文案不得混入中文", () => {
    const zhDict = loadDict("zh_CN");
    const enDict = loadDict("en");
    for (const key of ["idlePaused", "widgetPaused"] as const) {
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
});
