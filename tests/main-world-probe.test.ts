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

  test("React fiber.return 链：标记为 react（无版本证据时为 0，不猜 18）", () => {
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
        version: 0,
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
      // 无 hook、fiber 上也无可判别版本字段 → 0（未知），而不是写死 18
      assert.equal(res.version, 0);
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

  test("Vue2 + Element UI 穿透业务父组件：跳过 node_modules 库组件并提取上层业务状态与源码", () => {
    const workStationVm = {
      _isVue: true,
      $options: {
        name: "WorkStationPage",
        __file: "/Users/dev/cims/src/pages/work_station/index.vue",
      },
      _data: { activeTab: "issues", apiSecret: "hide-me" },
      $parent: null,
    };
    const editIssueVm = {
      _isVue: true,
      $options: {
        name: "EditIssueDialog",
        __file: "webpack:///./src/pages/work_station/dialog/edit_issue.vue",
      },
      $props: { visible: true, mode: "edit" },
      _data: {
        form: { categoryCode: "" },
        originFormData: { categoryCode: "bug" },
      },
      $parent: workStationVm,
    };
    const elFormItemVm = {
      _isVue: true,
      $options: {
        name: "ElFormItem",
        __file:
          "/Users/dev/cims/node_modules/element-ui/packages/form/src/form-item.vue",
      },
      $props: { prop: "category_key" },
      $parent: editIssueVm,
    };
    const elButtonVm = {
      _isVue: true,
      $options: {
        name: "ElButton",
        __file:
          "/Users/dev/cims/node_modules/element-ui/packages/button/src/button.vue",
      },
      $props: { type: "primary", loading: false },
      $parent: elFormItemVm,
    };
    const el = fakeEl("blp-v2-parent", { __vue__: elButtonVm });

    withDocument([el], () => {
      const results = runMainWorldFrameworkProbe(["blp-v2-parent"]);
      const res = results["blp-v2-parent"];
      assert.ok(res);
      assert.equal(res.framework, "vue");
      assert.equal(res.version, 2);
      assert.equal(res.componentName, "ElButton");
      assert.deepEqual(res.componentPath, [
        "WorkStationPage",
        "EditIssueDialog",
        "ElFormItem",
        "ElButton",
      ]);
      assert.ok(res.parentComponents);
      assert.equal(res.parentComponents.length, 2);
      assert.equal(res.parentComponents[0].componentName, "EditIssueDialog");
      assert.equal(
        res.parentComponents[0].componentFile,
        "src/pages/work_station/dialog/edit_issue.vue"
      );
      assert.deepEqual(res.parentComponents[0].props, {
        visible: true,
        mode: "edit",
      });
      assert.deepEqual(res.parentComponents[0].data, {
        form: { categoryCode: "" },
        originFormData: { categoryCode: "bug" },
      });
      assert.equal(res.parentComponents[1].componentName, "WorkStationPage");
      assert.equal(res.parentComponents[1].data?.activeTab, "issues");
      assert.equal(
        res.parentComponents[1].data?.apiSecret,
        "[REDACTED_SENSITIVE_KEY]"
      );
    });
  });

  test("Vue2 Portal (append-to-body) 通过 $vnode.context 穿透回业务宿主组件", () => {
    const ownerVm = {
      _isVue: true,
      $options: {
        name: "BpmSelectForm",
        __file: "/repo/src/components/BpmSelectForm.vue",
      },
      _data: { isDirty: true, selectedId: "ssd_a" },
      $parent: null,
    };
    const portalDropdownVm = {
      _isVue: true,
      $options: { name: "ElSelectDropdown" },
      $props: { placement: "bottom-start" },
      $parent: null,
      $vnode: { context: ownerVm },
    };
    const optionItemEl = fakeEl("blp-v2-portal", {
      parentElement: fakeEl(null, { __vue__: portalDropdownVm }),
    });

    withDocument([optionItemEl], () => {
      const results = runMainWorldFrameworkProbe(["blp-v2-portal"]);
      const res = results["blp-v2-portal"];
      assert.ok(res);
      assert.equal(res.componentName, "ElSelectDropdown");
      assert.deepEqual(res.componentPath, [
        "BpmSelectForm",
        "ElSelectDropdown",
      ]);
      assert.equal(res.parentComponents?.[0]?.componentName, "BpmSelectForm");
      assert.deepEqual(res.parentComponents?.[0]?.data, {
        isDirty: true,
        selectedId: "ssd_a",
      });
    });
  });

  test("Vue2 生产无 __file 时依然穿透 UI 库前缀跳过 ElFormItem 并提取业务父状态", () => {
    const completeTaskVm = {
      _isVue: true,
      $options: { name: "CompleteTaskModal" },
      _data: { reject_target: "", dirtyCount: 2 },
      $parent: null,
    };
    const formItemVm = {
      _isVue: true,
      $options: { name: "ElFormItem" },
      $props: { prop: "reject_target" },
      _data: { validateState: "error" },
      $parent: completeTaskVm,
    };
    const el = fakeEl("blp-v2-prod", {
      __vue__: {
        _isVue: true,
        $options: { _componentTag: "ElSelect" },
        $props: { value: "" },
        $parent: formItemVm,
      },
    });

    withDocument([el], () => {
      const res = runMainWorldFrameworkProbe(["blp-v2-prod"])["blp-v2-prod"];
      assert.ok(res);
      assert.equal(res.componentName, "ElSelect");
      assert.equal(res.parentComponents?.length, 1);
      assert.equal(
        res.parentComponents?.[0]?.componentName,
        "CompleteTaskModal"
      );
      assert.deepEqual(res.parentComponents?.[0]?.data, {
        reject_target: "",
        dirtyCount: 2,
      });
    });
  });

  test("Vue2 Hook 兜底与 body 子节点受限广度扫描兜底", () => {
    const savedHook = (globalThis as any).__VUE_DEVTOOLS_GLOBAL_HOOK__;
    const savedDoc = (globalThis as any).document;
    try {
      // 1) DevTools Hook 中挂载 Vue 2 实例（无 _instance，仅 _isVue/$options）
      (globalThis as any).__VUE_DEVTOOLS_GLOBAL_HOOK__ = {
        apps: [
          {
            _isVue: true,
            $options: {
              name: "LegacyRootApp",
              __file: "/repo/src/LegacyRootApp.vue",
            },
            _data: { routeName: "CostSetList" },
          },
        ],
      };
      const bodyEl = fakeEl("blp-v2-hook", { parentElement: null });
      withDocument([bodyEl], () => {
        const res = runMainWorldFrameworkProbe(["blp-v2-hook"])["blp-v2-hook"];
        assert.ok(res);
        assert.equal(res.framework, "vue");
        assert.equal(res.version, 2);
        assert.equal(res.componentName, "LegacyRootApp");
        assert.deepEqual(res.data, { routeName: "CostSetList" });
      });

      // 2) 无 DevTools Hook 时，从 body 浅层扫描命中非标准容器内的 Vue 2 实例
      delete (globalThis as any).__VUE_DEVTOOLS_GLOBAL_HOOK__;
      const innerApp = {
        tagName: "SECTION",
        __vue__: {
          _isVue: true,
          $options: {
            name: "PortalMainView",
            __file: "/repo/src/PortalMainView.vue",
          },
          _data: { initialized: true },
          $parent: null,
        },
        children: [],
      };
      const bodyMock = {
        tagName: "BODY",
        parentElement: null,
        getAttribute: (n: string) => (n === ATTR ? "blp-v2-bfs" : null),
        children: [{ tagName: "DIV", children: [innerApp] }],
      };
      (globalThis as any).document = {
        body: bodyMock,
        querySelector: () => null,
        querySelectorAll: () => [bodyMock],
      };
      const bfsRes = runMainWorldFrameworkProbe(["blp-v2-bfs"])["blp-v2-bfs"];
      assert.ok(bfsRes);
      assert.equal(bfsRes.framework, "vue");
      assert.equal(bfsRes.version, 2);
      assert.equal(bfsRes.componentName, "PortalMainView");
      assert.deepEqual(bfsRes.data, { initialized: true });
    } finally {
      (globalThis as any).__VUE_DEVTOOLS_GLOBAL_HOOK__ = savedHook;
      (globalThis as any).document = savedDoc;
    }
  });

  test("React 穿透包装组件抽取业务父组件 Hooks 状态与 _debugSource", () => {
    const orderDrawerFiber = {
      tag: 0,
      type: function OrderDrawer() {},
      _debugSource: {
        fileName: "/repo/src/components/OrderDrawer.tsx",
        lineNumber: 35,
      },
      memoizedProps: { open: true, orderId: "ORD-42" },
      memoizedState: {
        memoizedState: "draft",
        queue: { lastRenderedReducer: () => {} },
        next: null,
      },
      return: null,
    };
    const antBtnFiber = {
      tag: 0,
      type: function AntButton() {},
      _debugSource: {
        fileName: "/repo/node_modules/antd/es/button/index.js",
        lineNumber: 12,
      },
      memoizedProps: { type: "primary" },
      return: orderDrawerFiber,
    };
    const hostBtnFiber = {
      tag: 5,
      type: "button",
      return: antBtnFiber,
    };
    const el = fakeEl("blp-react-parent", { __reactFiber$p: hostBtnFiber });

    withDocument([el], () => {
      const res = runMainWorldFrameworkProbe(["blp-react-parent"])[
        "blp-react-parent"
      ];
      assert.ok(res);
      assert.equal(res.componentName, "AntButton");
      assert.equal(res.parentComponents?.length, 1);
      assert.equal(res.parentComponents?.[0]?.componentName, "OrderDrawer");
      assert.equal(
        res.parentComponents?.[0]?.componentFile,
        "src/components/OrderDrawer.tsx"
      );
      assert.equal(res.parentComponents?.[0]?.componentLine, 35);
      assert.deepEqual(res.parentComponents?.[0]?.props, {
        open: true,
        orderId: "ORD-42",
      });
      assert.deepEqual(res.parentComponents?.[0]?.data, {
        useState_0: "draft",
      });
    });
  });
});

/** React 19 dev 构建中 fiber._debugStack 的真实形态：栈底带 react_stack_bottom_frame。 */
const REACT19_STACK = [
  "Error: react-stack-top-frame",
  "    at jsxDEV (http://localhost:5173/node_modules/.vite/deps/react_jsx-dev-runtime.js?v=abc:326:12)",
  "    at TodoList (http://localhost:5173/src/components/TodoList.jsx:42:7)",
  "    at react_stack_bottom_frame (http://localhost:5173/node_modules/.vite/deps/react-dom_client.js?v=abc:18123:5)",
  "    at renderWithHooks (http://localhost:5173/node_modules/.vite/deps/react-dom_client.js?v=abc:12000:3)",
].join("\n");

function react19FiberChain(options: {
  hostDebugStack?: any;
  hostDebugSource?: any;
  hostDebugInfo?: any;
  hostRoot?: boolean;
}) {
  const appFiber: any = {
    tag: 0,
    type: { name: "App" },
    memoizedProps: {},
    return: null,
    _debugInfo: null,
    _debugTask: null,
    _debugStack: null,
  };
  const todoFiber: any = {
    tag: 0,
    type: { name: "TodoList" },
    memoizedProps: { items: 2 },
    memoizedState: null,
    return: appFiber,
    _debugInfo: null,
    _debugTask: null,
    _debugStack: null,
  };
  const hostFiber: any = {
    tag: 5,
    type: "ul",
    return: todoFiber,
    _debugInfo: options.hostDebugInfo ?? null,
    _debugTask: null,
    _debugStack: options.hostDebugStack,
    _debugSource: options.hostDebugSource,
  };
  if (options.hostRoot) {
    const hostRootFiber: any = {
      tag: 3,
      type: null,
      child: hostFiber,
      return: null,
      _debugInfo: null,
      _debugTask: null,
      _debugStack: null,
    };
    return { hostFiber, hostRootFiber };
  }
  return { hostFiber, hostRootFiber: null };
}

describe("React 19 源码定位与版本探测", () => {
  test("fiber._debugStack 能解析出 src/components/TodoList.jsx:42（跳过运行时帧）", () => {
    const { hostFiber } = react19FiberChain({
      hostDebugStack: Object.assign(new Error("react-stack-top-frame"), {
        stack: REACT19_STACK,
      }),
    });
    const el = fakeEl("blp-r19-stack", { __reactFiber$r19: hostFiber });
    withDocument([el], () => {
      const res = runMainWorldFrameworkProbe(["blp-r19-stack"])[
        "blp-r19-stack"
      ];
      assert.ok(res);
      assert.equal(res.componentName, "TodoList");
      assert.equal(res.componentFile, "src/components/TodoList.jsx");
      assert.equal(res.componentLine, 42);
      assert.equal(res.framework, "react");
      assert.equal(res.version, 19);
    });
  });

  test("_debugSource 优先于 _debugStack", () => {
    const { hostFiber } = react19FiberChain({
      hostDebugStack: Object.assign(new Error("react-stack-top-frame"), {
        stack: REACT19_STACK,
      }),
      hostDebugSource: {
        fileName: "/repo/src/components/LegacyCard.jsx",
        lineNumber: 7,
      },
    });
    const el = fakeEl("blp-r19-priority", { __reactFiber$r19p: hostFiber });
    withDocument([el], () => {
      const res = runMainWorldFrameworkProbe(["blp-r19-priority"])[
        "blp-r19-priority"
      ];
      assert.ok(res);
      assert.equal(res.componentFile, "src/components/LegacyCard.jsx");
      assert.equal(res.componentLine, 7);
    });
  });

  test("_debugStack 为空串或无匹配帧时返回 undefined，不伪造行号", () => {
    const emptyStack = Object.assign(new Error("react-stack-top-frame"), {
      stack: "",
    });
    const { hostFiber } = react19FiberChain({ hostDebugStack: emptyStack });
    const el = fakeEl("blp-r19-empty", { __reactFiber$r19e: hostFiber });
    withDocument([el], () => {
      const res = runMainWorldFrameworkProbe(["blp-r19-empty"])[
        "blp-r19-empty"
      ];
      assert.ok(res);
      assert.equal(res.componentName, "TodoList");
      assert.equal(res.componentFile, undefined);
      assert.equal(res.componentLine, undefined);
      assert.equal("filePath" in res, false);
    });

    const noMatchStack = Object.assign(new Error("react-stack-top-frame"), {
      stack: [
        "Error: react-stack-top-frame",
        "    at jsxDEV (<anonymous>)",
        "    at react_stack_bottom_frame (http://localhost:5173/node_modules/.vite/deps/react-dom_client.js?v=abc:18123:5)",
      ].join("\n"),
    });
    const second = react19FiberChain({ hostDebugStack: noMatchStack });
    const el2 = fakeEl("blp-r19-nomatch", {
      __reactFiber$r19n: second.hostFiber,
    });
    withDocument([el2], () => {
      const res = runMainWorldFrameworkProbe(["blp-r19-nomatch"])[
        "blp-r19-nomatch"
      ];
      assert.ok(res);
      assert.equal(res.componentFile, undefined);
      assert.equal(res.componentLine, undefined);
    });
  });

  test("_debugInfo[].debugLocation 作为第 3 级回退", () => {
    const { hostFiber } = react19FiberChain({
      hostDebugInfo: [
        {
          name: "TodoListBoundary",
          env: "Server",
          debugLocation: REACT19_STACK,
        },
      ],
    });
    const el = fakeEl("blp-r19-info", { __reactFiber$r19i: hostFiber });
    withDocument([el], () => {
      const res = runMainWorldFrameworkProbe(["blp-r19-info"])["blp-r19-info"];
      assert.ok(res);
      assert.equal(res.componentFile, "src/components/TodoList.jsx");
      assert.equal(res.componentLine, 42);
    });
  });

  test("__reactContainer$ 上的 HostRoot fiber 能解出组件链", () => {
    const { hostRootFiber } = react19FiberChain({ hostRoot: true });
    const el = fakeEl("blp-r19-container", {
      __reactContainer$abc: hostRootFiber,
    });
    withDocument([el], () => {
      const res = runMainWorldFrameworkProbe(["blp-r19-container"])[
        "blp-r19-container"
      ];
      assert.ok(res);
      assert.equal(res.framework, "react");
      assert.equal(res.componentName, "TodoList");
      assert.deepEqual(res.componentPath, ["App", "TodoList"]);
      assert.equal(res.version, 19);
    });
  });

  test("__reactContainer$ 上挂 FiberRoot({current}) 时同样可解引用", () => {
    const { hostRootFiber } = react19FiberChain({ hostRoot: true });
    const el = fakeEl("blp-r19-fiberroot", {
      __reactContainer$def: { current: hostRootFiber, containerInfo: {} },
    });
    withDocument([el], () => {
      const res = runMainWorldFrameworkProbe(["blp-r19-fiberroot"])[
        "blp-r19-fiberroot"
      ];
      assert.ok(res);
      assert.equal(res.componentName, "TodoList");
    });
  });

  test("__reactContainer$ 解不出 fiber 时返回 null，不瞎猜", () => {
    const el = fakeEl("blp-r19-container-null", {
      __reactContainer$empty: { current: null },
    });
    withDocument([el], () => {
      assert.equal(
        runMainWorldFrameworkProbe(["blp-r19-container-null"])[
          "blp-r19-container-null"
        ],
        null
      );
    });
  });

  test("DevTools hook renderer version=19.2.8 → 版本 19", () => {
    const saved = (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
    try {
      (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
        renderers: new Map([
          [1, { version: "19.2.8", rendererPackageName: "react-dom" }],
        ]),
      };
      // fiber 上没有任何可判别字段，版本只能来自 hook
      const el = fakeEl("blp-ver-19", {
        __reactFiber$ver19: {
          tag: 5,
          type: "button",
          return: { tag: 0, type: { name: "OrderButton" }, return: null },
        },
      });
      withDocument([el], () => {
        const res = runMainWorldFrameworkProbe(["blp-ver-19"])["blp-ver-19"];
        assert.equal(res?.version, 19);
      });
    } finally {
      (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__ = saved;
    }
  });

  test("DevTools hook renderer version=18.3.1 → 版本 18", () => {
    const saved = (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
    try {
      (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
        renderers: [{ version: "18.3.1", rendererPackageName: "react-dom" }],
      };
      const el = fakeEl("blp-ver-18", {
        __reactFiber$ver18: {
          tag: 5,
          type: "button",
          return: { tag: 0, type: { name: "OrderButton" }, return: null },
        },
      });
      withDocument([el], () => {
        const res = runMainWorldFrameworkProbe(["blp-ver-18"])["blp-ver-18"];
        assert.equal(res?.version, 18);
      });
    } finally {
      (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__ = saved;
    }
  });

  test("无 hook 时按 fiber 结构判别：19 = 有 _debugInfo/_debugStack，18 = 只有 _debugSource", () => {
    const saved = (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
    try {
      delete (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;

      const r19 = react19FiberChain({});
      const el19 = fakeEl("blp-ver-heur19", {
        __reactFiber$h19: r19.hostFiber,
      });
      withDocument([el19], () => {
        assert.equal(
          runMainWorldFrameworkProbe(["blp-ver-heur19"])["blp-ver-heur19"]
            ?.version,
          19
        );
      });

      const el18 = fakeEl("blp-ver-heur18", {
        __reactFiber$h18: {
          tag: 5,
          type: "button",
          _debugSource: {
            fileName: "/repo/src/components/LegacyButton.tsx",
            lineNumber: 12,
          },
          return: { tag: 0, type: { name: "LegacyButton" }, return: null },
        },
      });
      withDocument([el18], () => {
        const res = runMainWorldFrameworkProbe(["blp-ver-heur18"])[
          "blp-ver-heur18"
        ];
        assert.equal(res?.version, 18);
        assert.equal(res?.componentFile, "src/components/LegacyButton.tsx");
        assert.equal(res?.componentLine, 12);
      });
    } finally {
      (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__ = saved;
    }
  });
});

/** 通过 _debugSource.fileName 注入路径，验证 normalizeFilePath 的归一化结果。 */
function componentFileFor(fileName: string): string | undefined {
  const el = fakeEl("blp-normalize", {
    __reactFiber$normalize: {
      tag: 5,
      type: "button",
      _debugSource: { fileName, lineNumber: 5 },
      return: { tag: 0, type: { name: "PathTarget" }, return: null },
    },
  });
  let file: string | undefined;
  withDocument([el], () => {
    const res = runMainWorldFrameworkProbe(["blp-normalize"])["blp-normalize"];
    assert.ok(res);
    file = res.componentFile;
  });
  return file;
}

describe("normalizeFilePath 路径归一化", () => {
  test("http:// + host[:port] 前缀被剥离，query 一并剥离", () => {
    assert.equal(
      componentFileFor(
        "http://localhost:5173/src/components/TodoList.jsx?t=1712:42:7"
      ),
      "src/components/TodoList.jsx"
    );
  });

  test("https:// + 自定义端口前缀被剥离", () => {
    assert.equal(
      componentFileFor("https://example.com:8080/src/a/b.js"),
      "src/a/b.js"
    );
  });

  test("webpack:/// 虚拟协议与 ./ 前缀被剥离", () => {
    assert.equal(componentFileFor("webpack:///./src/x.jsx"), "src/x.jsx");
  });

  test("file:/// 绝对路径仅保留源码根起的相对路径", () => {
    assert.equal(componentFileFor("file:///Users/a/proj/src/y.js"), "src/y.js");
  });

  test("无协议的绝对路径保留源码根起的相对路径", () => {
    assert.equal(componentFileFor("/Users/a/proj/src/z.js"), "src/z.js");
  });

  test("已相对路径原样直通", () => {
    assert.equal(componentFileFor("src/q.jsx"), "src/q.jsx");
  });

  test("node_modules 路径维持原有判定", () => {
    assert.equal(
      componentFileFor("/Users/a/proj/node_modules/antd/es/button/index.js"),
      "node_modules/antd/es/button/index.js"
    );
  });

  test("无法识别源码根时返回 undefined，不返回空串、不编造 src/ 前缀", () => {
    assert.equal(componentFileFor("http://localhost:5173"), undefined);
  });
});

describe("resolveReactContainerFiber 解引用顺序", () => {
  function containerProbe(container: unknown) {
    const el = fakeEl("blp-container-shape", {
      __reactContainer$shape: container,
    });
    let res: ReturnType<typeof runMainWorldFrameworkProbe>[string] | undefined;
    withDocument([el], () => {
      res = runMainWorldFrameworkProbe(["blp-container-shape"])[
        "blp-container-shape"
      ];
    });
    return res;
  }

  test("HostRoot.child 直接可用时取 child", () => {
    const { hostFiber } = react19FiberChain({});
    const res = containerProbe({ tag: 3, child: hostFiber });
    assert.ok(res);
    assert.equal(res.componentName, "TodoList");
    assert.deepEqual(res.componentPath, ["App", "TodoList"]);
  });

  test("HostRoot.child 为空时回退到 stateNode.current.child", () => {
    const { hostFiber } = react19FiberChain({});
    const res = containerProbe({
      tag: 3,
      child: null,
      stateNode: { current: { child: hostFiber } },
      alternate: { child: null },
    });
    assert.ok(res);
    assert.equal(res.componentName, "TodoList");
    assert.deepEqual(res.componentPath, ["App", "TodoList"]);
  });

  test("child 与 stateNode.current.child 均为空时回退到 alternate.child", () => {
    const { hostFiber } = react19FiberChain({});
    const res = containerProbe({
      tag: 3,
      child: null,
      stateNode: { current: { child: null } },
      alternate: { child: hostFiber },
    });
    assert.ok(res);
    assert.equal(res.componentName, "TodoList");
    assert.deepEqual(res.componentPath, ["App", "TodoList"]);
  });

  test("三种形态全为空时返回 null，不瞎猜", () => {
    const res = containerProbe({
      tag: 3,
      child: null,
      stateNode: { current: { child: null } },
      alternate: { child: null },
    });
    assert.equal(res, null);
  });
});
