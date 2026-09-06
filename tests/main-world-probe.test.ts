import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runMainWorldFrameworkProbe } from "../src/screenshot/probes/main-world-probe";

const ATTR = "data-bug-lens-probe-id";

function fakeEl(id: string | null, props: Record<string, unknown> = {}): any {
  return {
    getAttribute: (name: string) => (name === ATTR ? id : null),
    ...props,
  };
}

function withDocument(elements: any[], fn: () => void): void {
  const saved = (globalThis as any).document;
  (globalThis as any).document = {
    querySelectorAll: () => elements,
  };
  try {
    fn();
  } finally {
    (globalThis as any).document = saved;
  }
}

describe("runMainWorldFrameworkProbe", () => {
  test("Vue2 __vue__ 挂在组件根：收集组件链", () => {
    const el = fakeEl("blp-0", {
      __vue__: {
        $options: { name: "ElCard" },
        $parent: { $options: { name: "App" }, $parent: null },
      },
    });
    withDocument([el], () => {
      const results = runMainWorldFrameworkProbe(["blp-0"]);
      assert.deepEqual(results["blp-0"], {
        componentName: "ElCard",
        componentPath: ["App", "ElCard"],
        framework: "vue",
        version: 2,
        props: undefined,
        data: undefined,
      });
    });
  });

  test("Vue2 实例属性仅挂在组件根：沿 DOM 向上查找", () => {
    const root = fakeEl(null, {
      __vue__: {
        $options: { name: "ElFormItem" },
        $parent: { $options: { name: "App" }, $parent: null },
      },
    });
    const child = fakeEl("blp-1", { parentElement: root });
    withDocument([child], () => {
      const results = runMainWorldFrameworkProbe(["blp-1"]);
      assert.deepEqual(results["blp-1"]?.componentPath, ["App", "ElFormItem"]);
      assert.equal(results["blp-1"]?.framework, "vue");
    });
  });

  test("Vue3 __vueParentComponent$ 链：标记为 vue v3", () => {
    const el = fakeEl("blp-2", {
      __vueParentComponent$: {
        type: { __name: "UserCard" },
        parent: { type: { name: "App" }, parent: null },
      },
    });
    withDocument([el], () => {
      const results = runMainWorldFrameworkProbe(["blp-2"]);
      assert.deepEqual(results["blp-2"], {
        componentName: "UserCard",
        componentPath: ["App", "UserCard"],
        framework: "vue",
        version: 3,
        props: undefined,
        data: undefined,
      });
    });
  });

  test("React fiber.return 链：标记为 react", () => {
    const el = fakeEl("blp-3", {
      __reactFiber$test: {
        type: { name: "OrderButton" },
        return: { type: { name: "App" }, return: null },
      },
    });
    withDocument([el], () => {
      const results = runMainWorldFrameworkProbe(["blp-3"]);
      assert.deepEqual(results["blp-3"], {
        componentName: "OrderButton",
        componentPath: ["App", "OrderButton"],
        framework: "react",
        version: 18,
      });
    });
  });

  test("无框架上下文：返回 null", () => {
    const el = fakeEl("blp-4");
    withDocument([el], () => {
      const results = runMainWorldFrameworkProbe(["blp-4"]);
      assert.equal(results["blp-4"], null);
    });
  });

  test("仅返回请求的 probeIds，跳过无关标记元素", () => {
    const el = fakeEl("blp-5", {
      __vue__: { $options: { name: "App" }, $parent: null },
    });
    const other = fakeEl("other-id", {
      __vue__: { $options: { name: "Other" }, $parent: null },
    });
    withDocument([el, other], () => {
      const results = runMainWorldFrameworkProbe(["blp-5"]);
      assert.equal(results["blp-5"]?.componentName, "App");
      assert.equal(results["other-id"], undefined);
    });
  });

  test("Vue2 $options.__file 路径归一化与 $props/$data 提取脱敏", () => {
    const el = fakeEl("blp-v2", {
      __vue__: {
        $options: {
          name: "ItemCard",
          __file: "/Users/dev/my-project/src/components/ItemCard.vue",
        },
        $props: { itemId: "item-1", apiToken: "secret-123" },
        $data: { count: 3, userPassword: "pass-xyz" },
        $parent: { $options: { name: "App" }, $parent: null },
      },
    });
    withDocument([el], () => {
      const results = runMainWorldFrameworkProbe(["blp-v2"]);
      const res = results["blp-v2"];
      assert.ok(res);
      assert.equal(res.componentName, "ItemCard");
      assert.equal(res.componentFile, "src/components/ItemCard.vue");
      assert.equal(res.filePath, "src/components/ItemCard.vue");
      assert.deepEqual(res.props, {
        itemId: "item-1",
        apiToken: "[REDACTED_SENSITIVE_KEY]",
      });
      assert.deepEqual(res.data, {
        count: 3,
        userPassword: "[REDACTED_SENSITIVE_KEY]",
      });
    });
  });

  test("Vue3 type.__file 路径归一化与 setupState 解包（修复 instance.data 空对象遮蔽）", () => {
    const el = fakeEl("blp-v3", {
      __vueParentComponent$: {
        type: {
          __name: "UserDetail",
          __file: "C:\\work\\bug-lens\\src\\views\\UserDetail.vue",
        },
        props: { userId: 100 },
        setupState: {
          userName: "Alice",
          authSecret: "s3cr3t",
          __v_internal: true,
        },
        data: {}, // 模拟 Vue 3 默认 reactive({}) 空对象
        parent: { type: { name: "App" }, parent: null },
      },
    });
    withDocument([el], () => {
      const results = runMainWorldFrameworkProbe(["blp-v3"]);
      const res = results["blp-v3"];
      assert.ok(res);
      assert.equal(res.componentName, "UserDetail");
      assert.equal(res.componentFile, "src/views/UserDetail.vue");
      assert.deepEqual(res.props, { userId: 100 });
      assert.deepEqual(res.data, {
        userName: "Alice",
        authSecret: "[REDACTED_SENSITIVE_KEY]",
      });
    });
  });

  test("React _debugSource 物理源码相对路径与行号提取", () => {
    const el = fakeEl("blp-react-source", {
      __reactFiber$source: {
        tag: 5,
        type: "button",
        _debugSource: {
          fileName: "/Users/work/bug-lens/src/components/OrderButton.tsx",
          lineNumber: 42,
        },
        return: {
          tag: 0,
          type: { name: "OrderButton" },
          return: { tag: 0, type: { name: "App" }, return: null },
        },
      },
    });
    withDocument([el], () => {
      const results = runMainWorldFrameworkProbe(["blp-react-source"]);
      const res = results["blp-react-source"];
      assert.ok(res);
      assert.equal(res.componentName, "OrderButton");
      assert.equal(res.componentFile, "src/components/OrderButton.tsx");
      assert.equal(res.componentLine, 42);
    });
  });

  test("React memoizedProps 解包：过滤 children/内部符号，敏感键脱敏", () => {
    const el = fakeEl("blp-react-props", {
      __reactFiber$props: {
        tag: 5,
        type: "button",
        return: {
          tag: 0,
          type: { name: "SubmitBtn" },
          memoizedProps: {
            label: "Submit",
            children: { $$typeof: Symbol.for("react.element") },
            key: "submit-key",
            ref: null,
            apiKey: "secret-key-123",
            onClick: () => {},
          },
          return: null,
        },
      },
    });
    withDocument([el], () => {
      const results = runMainWorldFrameworkProbe(["blp-react-props"]);
      const res = results["blp-react-props"];
      assert.ok(res);
      assert.ok(res.props);
      assert.equal(res.props.label, "Submit");
      assert.equal(res.props.apiKey, "[REDACTED_SENSITIVE_KEY]");
      assert.equal(res.props.onClick, "[Function]");
      assert.equal("children" in res.props, false);
      assert.equal("key" in res.props, false);
      assert.equal("ref" in res.props, false);
    });
  });

  test("React memoizedState Hooks 链表遍历：解包 useState/useRef 并跳过 useEffect", () => {
    const hook4 = {
      memoizedState: { current: "ref-current-value" },
      queue: null,
      next: null,
    };
    const hook3 = {
      memoizedState: { create: () => {}, destroy: () => {} }, // useEffect closure
      queue: null,
      next: hook4,
    };
    const hook2 = {
      memoizedState: { authToken: "tok_abc_123" },
      queue: { lastRenderedReducer: () => {} },
      next: hook3,
    };
    const hook1 = {
      memoizedState: 42,
      queue: { lastRenderedReducer: () => {} },
      next: hook2,
    };

    const el = fakeEl("blp-react-hooks", {
      __reactFiber$hooks: {
        tag: 5,
        type: "div",
        return: {
          tag: 0,
          type: { name: "CounterComponent" },
          memoizedState: hook1,
          return: null,
        },
      },
    });
    withDocument([el], () => {
      const results = runMainWorldFrameworkProbe(["blp-react-hooks"]);
      const res = results["blp-react-hooks"];
      assert.ok(res);
      assert.ok(res.data);
      assert.equal(res.data.useState_0, 42);
      assert.deepEqual(res.data.useState_1, {
        authToken: "[REDACTED_SENSITIVE_KEY]",
      });
      assert.equal(res.data.useRef_0, "ref-current-value");
      assert.equal(Object.keys(res.data).length, 3);
    });
  });

  test("React 生产混淆单字母组件名容错：区分 HostComponent 原生 DOM 标签，保留单字母组件继承链", () => {
    function a() {}
    function t() {}

    const el = fakeEl("blp-react-prod", {
      __reactFiber$prod: {
        tag: 5,
        type: "button",
        return: {
          tag: 0,
          type: a,
          return: {
            tag: 0,
            type: t,
            return: null,
          },
        },
      },
    });
    withDocument([el], () => {
      const results = runMainWorldFrameworkProbe(["blp-react-prod"]);
      const res = results["blp-react-prod"];
      assert.ok(res);
      assert.equal(res.componentName, "a");
      assert.deepEqual(res.componentPath, ["t", "a"]);
      assert.equal(res.framework, "react");
      assert.equal(res.version, 18);
    });
  });

  test("数据序列化防爆保护：循环引用、DOM 节点、深度截断", () => {
    const circular: any = { name: "loop" };
    circular.self = circular;

    const mockDomEl = fakeEl(null, { nodeType: 1, tagName: "DIV" });

    const el = fakeEl("blp-guardrails", {
      __reactFiber$guard: {
        tag: 5,
        type: "div",
        return: {
          tag: 0,
          type: { name: "GuardComponent" },
          memoizedState: {
            memoizedState: {
              loop: circular,
              element: mockDomEl,
              deep: { l1: { l2: { l3: "overflow" } } },
            },
            queue: { lastRenderedReducer: () => {} },
            next: null,
          },
          return: null,
        },
      },
    });
    withDocument([el], () => {
      const results = runMainWorldFrameworkProbe(["blp-guardrails"]);
      const res = results["blp-guardrails"];
      assert.ok(res);
      assert.ok(res.data);
      const state = res.data.useState_0 as any;
      assert.equal(state.loop.self, "[Circular]");
      assert.equal(state.element, "[DOM Element]");
      assert.equal(state.deep.l1, "[Truncated]");
    });
  });
});
