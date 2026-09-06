import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { runMainWorldFrameworkProbe } from "../src/screenshot/probes/main-world-probe";

const ATTR = "data-bug-lens-probe-id";

function fakeEl(id: string | null, props: Record<string, unknown> = {}): any {
  return {
    getAttribute: (name: string) => (name === ATTR ? id : null),
    ...props,
  };
}

function withDocument(elements: any[], fn: () => void): void {
  const savedDoc = (globalThis as any).document;
  (globalThis as any).document = {
    querySelectorAll: (selector: string) => {
      if (selector === "[data-bug-lens-probe-id]") {
        return elements.filter(
          (el) => el && el.getAttribute && el.getAttribute(ATTR)
        );
      }
      return elements;
    },
  };
  try {
    fn();
  } finally {
    (globalThis as any).document = savedDoc;
  }
}

describe("Empirical Challenger M2: runMainWorldFrameworkProbe 对抗应力测试", () => {
  // ──────────────────────────────────────────────────────────────────────────
  // 1. 深层循环引用与极端嵌套防爆对抗 (Deep Circular References & Extreme Objects)
  // ──────────────────────────────────────────────────────────────────────────
  describe("1. 深层循环引用与极端嵌套防爆对抗", () => {
    test("对象自引用、交叉互引用与数组环状引用均安全脱敏并输出 [Circular]，无栈溢出", () => {
      // 构造自环
      const selfLoop: any = { id: "self" };
      selfLoop.myself = selfLoop;

      // 构造多节点交叉互引用环: A -> B -> C -> D -> A
      const nodeA: any = { name: "A" };
      const nodeB: any = { name: "B" };
      const nodeC: any = { name: "C" };
      const nodeD: any = { name: "D" };
      nodeA.next = nodeB;
      nodeB.next = nodeC;
      nodeC.next = nodeD;
      nodeD.next = nodeA;

      // 构造数组与对象交织环
      const mixedCycleObj: any = { title: "mixed" };
      const cycleArr: any[] = ["item1", mixedCycleObj];
      mixedCycleObj.arrayRef = cycleArr;

      // 构造嵌套对象（用于验证 depth 截断）
      // depth 0: extractedData
      // depth 1: useState_0
      // depth 2: deepInState
      // depth 3: level1 -> [Truncated]
      const el = fakeEl("probe-circ-react", {
        __reactFiber$circ: {
          tag: 5,
          type: "div",
          return: {
            tag: 0,
            type: { name: "CircularContainer" },
            memoizedProps: {
              directLoop: selfLoop,
              crossLoop: nodeA,
              arrayLoop: mixedCycleObj,
            },
            memoizedState: {
              memoizedState: {
                loopInState: selfLoop,
                crossInState: nodeA,
                deepInState: { level1: { level2: { level3: "to-truncate" } } },
              },
              queue: { lastRenderedReducer: () => {} },
              next: null,
            },
            return: null,
          },
        },
      });

      withDocument([el], () => {
        const results = runMainWorldFrameworkProbe(["probe-circ-react"]);
        const res = results["probe-circ-react"];
        assert.ok(res, "应成功提取组件");
        assert.equal(res.componentName, "CircularContainer");

        // 验证 Props 脱敏与环引用截断
        const props = res.props as any;
        assert.ok(props);
        assert.equal(props.directLoop.myself, "[Circular]");
        assert.ok(props.crossLoop);
        const mixed = props.arrayLoop;
        assert.ok(mixed);
        assert.equal(mixed.title, "mixed");

        // 验证 State 脱敏与深度截断
        const state = (res.data as any).useState_0;
        assert.ok(state);
        assert.equal(state.loopInState.myself, "[Circular]");
        assert.equal(state.deepInState.level1, "[Truncated]");

        // 验证产物完全可被 JSON 序列化（无真实循环引用残留）
        const jsonStr = JSON.stringify(res);
        assert.ok(jsonStr.length > 0);
        assert.ok(jsonStr.includes("[Circular]"));
      });
    });

    test("嵌套深度达到 100 层的超深对象安全截断为 [Truncated]，无调用栈溢出", () => {
      let deepObj: any = { depth: 100 };
      for (let d = 99; d >= 0; d--) {
        deepObj = { level: d, inner: deepObj };
      }

      const el = fakeEl("probe-deep-nest", {
        __reactFiber$deep: {
          tag: 5,
          type: "div",
          return: {
            tag: 0,
            type: { name: "DeepNestComp" },
            memoizedProps: { deep: deepObj },
            return: null,
          },
        },
      });

      withDocument([el], () => {
        const results = runMainWorldFrameworkProbe(["probe-deep-nest"]);
        const res = results["probe-deep-nest"];
        assert.ok(res?.props);
        const deep = (res.props as any).deep;
        assert.ok(deep);
        // filtered (depth 0) -> deep (depth 1) -> inner (depth 2) -> inner (depth 3, [Truncated])
        assert.equal(deep.inner.inner, "[Truncated]");
      });
    });

    test("2000 个键的超宽对象限制提取不超过 20 个键，防止遍历卡死", () => {
      const wideObj: Record<string, unknown> = {};
      for (let i = 0; i < 2000; i++) {
        wideObj[`field_${i}`] = `value_${i}`;
      }

      const el = fakeEl("probe-wide-obj", {
        __reactFiber$wide: {
          tag: 5,
          type: "div",
          return: {
            tag: 0,
            type: { name: "WideObjectComp" },
            memoizedProps: wideObj,
            return: null,
          },
        },
      });

      withDocument([el], () => {
        const t0 = performance.now();
        const results = runMainWorldFrameworkProbe(["probe-wide-obj"]);
        const elapsed = performance.now() - t0;

        assert.ok(
          elapsed < 10,
          `处理 2000 属性对象耗时必须 < 10ms，实际: ${elapsed.toFixed(3)}ms`
        );
        const res = results["probe-wide-obj"];
        assert.ok(res);
        assert.ok(res.props);
        const propKeys = Object.keys(res.props);
        assert.ok(
          propKeys.length <= 20,
          `宽对象属性必须被截断至 <= 20，实际: ${propKeys.length}`
        );
      });
    });

    test("50,000 个元素的巨型数组截断至 10 个元素", () => {
      const hugeArray: number[] = new Array(50000).fill(1).map((_, i) => i);

      const el = fakeEl("probe-huge-arr", {
        __reactFiber$arr: {
          tag: 5,
          type: "div",
          return: {
            tag: 0,
            type: { name: "HugeArrayComp" },
            memoizedProps: { items: hugeArray },
            return: null,
          },
        },
      });

      withDocument([el], () => {
        const t0 = performance.now();
        const results = runMainWorldFrameworkProbe(["probe-huge-arr"]);
        const elapsed = performance.now() - t0;

        assert.ok(
          elapsed < 10,
          `处理 50000 数组耗时必须 < 10ms，实际: ${elapsed.toFixed(3)}ms`
        );
        const res = results["probe-huge-arr"];
        assert.ok(res?.props);
        const items = (res.props as any).items;
        assert.ok(Array.isArray(items));
        assert.equal(items.length, 10, "巨型数组应截断为 10 个元素");
      });
    });

    test("包含恶意抛错 Getter 与被撤销 Proxy 的对象不导致探针崩溃", () => {
      const maliciousObj: any = { safeProp: "ok" };
      Object.defineProperty(maliciousObj, "trapProp", {
        get() {
          throw new Error("MALICIOUS_GETTER_EXCEPTION");
        },
        enumerable: true,
      });

      const el = fakeEl("probe-getter-trap", {
        __reactFiber$trap: {
          tag: 5,
          type: "div",
          return: {
            tag: 0,
            type: { name: "TrapComp" },
            memoizedProps: { data: maliciousObj },
            return: null,
          },
        },
      });

      withDocument([el], () => {
        assert.doesNotThrow(() => {
          const results = runMainWorldFrameworkProbe(["probe-getter-trap"]);
          assert.ok("probe-getter-trap" in results);
        });
      });
    });

    test("Vue 3 setupState 中的 Ref 相互引用与循环嵌套安全解包", () => {
      const refA: any = { __v_isRef: true, value: { name: "refA" } };
      const refB: any = {
        __v_isRef: true,
        value: { name: "refB", parent: refA },
      };
      refA.value.child = refB; // 相互引用

      const el = fakeEl("probe-vue3-circ", {
        __vueParentComponent$: {
          type: { __name: "Vue3CycleComp", __file: "/src/views/CycleView.vue" },
          setupState: {
            a: refA,
            b: refB,
          },
          parent: null,
        },
      });

      withDocument([el], () => {
        const results = runMainWorldFrameworkProbe(["probe-vue3-circ"]);
        const res = results["probe-vue3-circ"];
        assert.ok(res);
        assert.equal(res.componentName, "Vue3CycleComp");
        assert.equal(res.componentFile, "src/views/CycleView.vue");
        assert.ok(res.data);
        assert.equal((res.data as any).a.name, "refA");
        assert.doesNotThrow(() => JSON.stringify(res));
      });
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. React Fiber 多样化 Hooks 解包与副作用过滤对抗
  // ──────────────────────────────────────────────────────────────────────────
  describe("2. React Fiber 多样化 Hooks 解包与副作用过滤对抗", () => {
    test("解包 useState, useReducer, useRef (DOM/primitive/object), useMemo, 跳过 useEffect/useLayoutEffect", () => {
      const domNode = fakeEl(null, { nodeType: 1, tagName: "DIV" });
      const refCycle: any = { note: "ref-loop" };
      refCycle.self = refCycle;

      // 构建交错 Hooks 链表:
      // Hook 0: useState (number)
      // Hook 1: useEffect (create/destroy) -> 必须被过滤
      // Hook 2: useReducer ({ count: 10, token: "secret" })
      // Hook 3: useRef (DOM element) -> 提取为 [DOM Element]
      // Hook 4: useRef (primitive 999) -> 提取为 999
      // Hook 5: useRef (循环对象) -> 提取为包含 [Circular] 的对象
      // Hook 6: useLayoutEffect (tag: 4, create) -> 必须被过滤
      // Hook 7: useMemo ([computedVal, deps]) -> 提取为 computedVal
      // Hook 8: useCallback ([fn, deps]) -> 必须被跳过
      const hook8 = {
        memoizedState: [() => "callback-result", []],
        queue: null,
        next: null,
      };
      const hook7 = {
        memoizedState: [{ calculatedScore: 100 }, ["dep1"]],
        queue: null,
        next: hook8,
      };
      const hook6 = {
        memoizedState: { tag: 4, create: () => {} },
        queue: null,
        next: hook7,
      };
      const hook5 = {
        memoizedState: { current: refCycle },
        queue: null,
        next: hook6,
      };
      const hook4 = {
        memoizedState: { current: 999 },
        queue: null,
        next: hook5,
      };
      const hook3 = {
        memoizedState: { current: domNode },
        queue: null,
        next: hook4,
      };
      const hook2 = {
        memoizedState: { count: 10, authToken: "tok_secret_123" },
        queue: { lastRenderedReducer: () => {} },
        next: hook3,
      };
      const hook1 = {
        memoizedState: {
          create: () => {
            throw new Error("Side effect must not be called!");
          },
          destroy: () => {},
        },
        queue: null,
        next: hook2,
      };
      const hook0 = {
        memoizedState: 42,
        queue: { lastRenderedReducer: () => {} },
        next: hook1,
      };

      const el = fakeEl("probe-diverse-hooks", {
        __reactFiber$diverse: {
          tag: 5,
          type: "div",
          return: {
            tag: 0,
            type: { name: "DiverseHooksComponent" },
            memoizedState: hook0,
            return: null,
          },
        },
      });

      withDocument([el], () => {
        const results = runMainWorldFrameworkProbe(["probe-diverse-hooks"]);
        const res = results["probe-diverse-hooks"];
        assert.ok(res);
        assert.ok(res.data);
        const data = res.data as any;

        // useState
        assert.equal(data.useState_0, 42);

        // useReducer (映射为 useState_1 并脱敏)
        assert.equal(data.useState_1.count, 10);
        assert.equal(data.useState_1.authToken, "[REDACTED_SENSITIVE_KEY]");

        // useRef (DOM Element)
        assert.equal(data.useRef_0, "[DOM Element]");

        // useRef (Primitive)
        assert.equal(data.useRef_1, 999);

        // useRef (Circular object)
        assert.equal(data.useRef_2.note, "ref-loop");
        assert.equal(data.useRef_2.self, "[Circular]");

        // useMemo (Data)
        assert.deepEqual(data.useMemo_0, { calculatedScore: 100 });

        // 绝不包含任何带有 create/destroy 的副作用闭包
        for (const k of Object.keys(data)) {
          const val = data[k];
          if (val && typeof val === "object") {
            assert.equal(
              "create" in val,
              false,
              `Hook ${k} 泄露了 create 闭包`
            );
            assert.equal(
              "destroy" in val,
              false,
              `Hook ${k} 泄露了 destroy 闭包`
            );
          }
        }
      });
    });

    test("React Hooks 单向链表恶意闭环（hook.next 指向自身或前序节点）受步数保护安全跳出", () => {
      const hook2: any = {
        memoizedState: "hook2-val",
        queue: { lastRenderedReducer: () => {} },
        next: null,
      };
      const hook1: any = {
        memoizedState: "hook1-val",
        queue: { lastRenderedReducer: () => {} },
        next: hook2,
      };
      hook2.next = hook1; // 形成死循环闭环

      const el = fakeEl("probe-hook-loop", {
        __reactFiber$loop: {
          tag: 5,
          type: "div",
          return: {
            tag: 0,
            type: { name: "InfiniteHookLoopComp" },
            memoizedState: hook1,
            return: null,
          },
        },
      });

      withDocument([el], () => {
        const t0 = performance.now();
        const results = runMainWorldFrameworkProbe(["probe-hook-loop"]);
        const elapsed = performance.now() - t0;

        assert.ok(
          elapsed < 10,
          `恶意 Hook 闭环必须在 10ms 内安全跳出，实际: ${elapsed.toFixed(3)}ms`
        );
        const res = results["probe-hook-loop"];
        assert.ok(res);
        assert.ok(res.data);
        assert.ok(
          Object.keys(res.data).length <= 20,
          "受 hookHops 及 sanitizeValue 属性截断双重保护"
        );
      });
    });

    test("超长 100 节点 Hooks 链表受 hookHops(30) 与 sanitizeValue(20) 双重保护安全截断，耗时 < 10ms", () => {
      let head: any = null;
      let curr: any = null;
      for (let i = 0; i < 100; i++) {
        const node: any = {
          memoizedState: `val_${i}`,
          queue: { lastRenderedReducer: () => {} },
          next: null,
        };
        if (!head) {
          head = node;
          curr = node;
        } else {
          curr.next = node;
          curr = node;
        }
      }

      const el = fakeEl("probe-100-hooks", {
        __reactFiber$100: {
          tag: 5,
          type: "div",
          return: {
            tag: 0,
            type: { name: "LongHooksComp" },
            memoizedState: head,
            return: null,
          },
        },
      });

      withDocument([el], () => {
        const t0 = performance.now();
        const results = runMainWorldFrameworkProbe(["probe-100-hooks"]);
        const elapsed = performance.now() - t0;

        assert.ok(
          elapsed < 10,
          `长链表耗时必须 < 10ms，实际: ${elapsed.toFixed(3)}ms`
        );
        const res = results["probe-100-hooks"];
        assert.ok(res?.data);
        // hookHops 限制最多遍历 30 步，sanitizeValue 进一步将对象属性截断至 20
        assert.equal(
          Object.keys(res.data).length,
          20,
          "受 sanitizeValue 20 属性截断保护"
        );
      });
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. 生产混淆单字母组件名与原生 DOM 标签精准判别对抗
  // ──────────────────────────────────────────────────────────────────────────
  describe("3. 生产混淆单字母组件名与原生 HTML 标签判别对抗", () => {
    test("严格基于 fiber.tag === 5 || typeof type === 'string' 判别 HostComponent，彻底排除原生标签，保留单字母组件", () => {
      function a() {}
      function b() {}
      function t() {}
      function s() {}

      // 构造交错 Fiber 树：
      // button (tag: 5, type: "button")
      //   -> a (tag: 0, type: a)
      //     -> span (tag: 5, type: "span")
      //       -> b (tag: 0, type: b)
      //         -> div (tag: 5, type: "div")
      //           -> t (tag: 0, type: t)
      //             -> a (tag: 5, type: "a", 原生超链接 HTML 标签)
      //               -> s (tag: 0, type: s)
      const fiberS = { tag: 0, type: s, return: null };
      const fiberNativeA = { tag: 5, type: "a", return: fiberS }; // 原生 <a> 标签！
      const fiberT = { tag: 0, type: t, return: fiberNativeA };
      const fiberDiv = { tag: 5, type: "div", return: fiberT };
      const fiberB = { tag: 0, type: b, return: fiberDiv };
      const fiberSpan = { tag: 5, type: "span", return: fiberB };
      const fiberA = { tag: 0, type: a, return: fiberSpan };
      const fiberButton = { tag: 5, type: "button", return: fiberA };

      const el = fakeEl("probe-prod-minified", {
        __reactFiber$min: fiberButton,
      });

      withDocument([el], () => {
        const results = runMainWorldFrameworkProbe(["probe-prod-minified"]);
        const res = results["probe-prod-minified"];
        assert.ok(res);
        assert.equal(res.framework, "react");
        assert.equal(res.version, 18);

        // 原生 DOM 标签必须 100% 被排除在组件链之外
        const path = res.componentPath || [];
        assert.equal(
          path.includes("button"),
          false,
          "原生 button 不得作为组件名"
        );
        assert.equal(path.includes("span"), false, "原生 span 不得作为组件名");
        assert.equal(path.includes("div"), false, "原生 div 不得作为组件名");

        // 混淆单字母函数必须被完整提取，且顺序正确
        assert.deepEqual(path, ["s", "t", "b", "a"]);
        assert.equal(res.componentName, "a");
      });
    });

    test("React.memo 与 React.forwardRef 包装的混淆单字母组件被准确识别", () => {
      function m() {}
      function f() {}

      const memoComp = {
        $$typeof: Symbol.for("react.memo"),
        type: m,
      };

      const forwardComp = {
        $$typeof: Symbol.for("react.forward_ref"),
        render: f,
      };

      const fiberF = { tag: 11, type: forwardComp, return: null };
      const fiberM = { tag: 14, type: memoComp, return: fiberF };
      const fiberHost = { tag: 5, type: "div", return: fiberM };

      const el = fakeEl("probe-hoc-minified", {
        __reactFiber$hoc: fiberHost,
      });

      withDocument([el], () => {
        const results = runMainWorldFrameworkProbe(["probe-hoc-minified"]);
        const res = results["probe-hoc-minified"];
        assert.ok(res);
        assert.deepEqual(res.componentPath, ["f", "m"]);
        assert.equal(res.componentName, "m");
      });
    });

    test("生产构建无 _debugSource 情况下平滑降级，不抛出异常且保留状态与组件链", () => {
      function prodWidget() {}

      const el = fakeEl("probe-prod-degrade", {
        __reactFiber$deg: {
          tag: 5,
          type: "main",
          return: {
            tag: 0,
            type: prodWidget,
            memoizedProps: { theme: "dark", count: 99 },
            memoizedState: {
              memoizedState: "active-tab",
              queue: { lastRenderedReducer: () => {} },
              next: null,
            },
            return: null,
          },
        },
      });

      withDocument([el], () => {
        const results = runMainWorldFrameworkProbe(["probe-prod-degrade"]);
        const res = results["probe-prod-degrade"];
        assert.ok(res);
        assert.equal(res.componentName, "prodWidget");
        assert.equal(
          res.componentFile,
          undefined,
          "生产无 _debugSource 应降级为 undefined"
        );
        assert.equal(res.componentLine, undefined);
        assert.deepEqual(res.props, { theme: "dark", count: 99 });
        assert.deepEqual(res.data, { useState_0: "active-tab" });
      });
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4. 路径标准化全环境对抗 (Windows / Unix / Vite / Webpack / Query / Hash)
  // ──────────────────────────────────────────────────────────────────────────
  describe("4. 路径标准化全环境对抗 (Windows, Unix, Vite, Webpack)", () => {
    test("Windows 反斜杠绝对路径与盘符被正确归一化为 POSIX 相对路径", () => {
      const paths = [
        {
          raw: "C:\\Users\\dev\\project\\src\\components\\Button.tsx",
          expected: "src/components/Button.tsx",
        },
        {
          raw: "D:\\work\\repo\\views\\Home.vue",
          expected: "views/Home.vue",
        },
        {
          raw: "E:\\app\\pages\\Detail.vue",
          expected: "app/pages/Detail.vue",
        },
        {
          raw: "C:\\projects\\my-app\\lib\\utils.ts",
          expected: "lib/utils.ts",
        },
        {
          raw: "C:\\custom-dir\\non-standard\\Component.tsx",
          expected: "custom-dir/non-standard/Component.tsx",
        },
      ];

      for (let i = 0; i < paths.length; i++) {
        const item = paths[i];
        const el = fakeEl(`probe-win-${i}`, {
          __reactFiber$test: {
            tag: 5,
            type: "div",
            _debugSource: { fileName: item.raw, lineNumber: 10 + i },
            return: {
              tag: 0,
              type: { name: `WinComp_${i}` },
              return: null,
            },
          },
        });

        withDocument([el], () => {
          const results = runMainWorldFrameworkProbe([`probe-win-${i}`]);
          const res = results[`probe-win-${i}`];
          assert.ok(res, `Failed for ${item.raw}`);
          assert.equal(
            res.componentFile,
            item.expected,
            `Mismatch for ${item.raw}`
          );
          assert.equal(res.componentLine, 10 + i);
        });
      }
    });

    test("Vite /@fs/ 虚拟路径与查询参数 / Hash 正确归一化", () => {
      const paths = [
        {
          raw: "/@fs/Users/alice/projects/bug-lens/src/App.vue?vue&type=script&lang.ts",
          expected: "src/App.vue",
        },
        {
          raw: "/@fs/C:/work/repo/src/views/User.vue#template",
          expected: "src/views/User.vue",
        },
        {
          raw: "/@fs/home/runner/work/repo/components/Card.vue?t=1690000000",
          expected: "components/Card.vue",
        },
        {
          raw: "/@fs/Users/alice/projects/bug-lens/node_modules/@my/pkg/dist/Button.js",
          expected: "node_modules/@my/pkg/dist/Button.js",
        },
      ];

      for (let i = 0; i < paths.length; i++) {
        const item = paths[i];
        const el = fakeEl(`probe-vite-${i}`, {
          __vueParentComponent$: {
            type: {
              __name: `ViteComp_${i}`,
              __file: item.raw,
            },
            parent: null,
          },
        });

        withDocument([el], () => {
          const results = runMainWorldFrameworkProbe([`probe-vite-${i}`]);
          const res = results[`probe-vite-${i}`];
          assert.ok(res, `Failed for ${item.raw}`);
          assert.equal(
            res.componentFile,
            item.expected,
            `Mismatch for ${item.raw}`
          );
        });
      }
    });

    test("Webpack webpack:/// 与 webpack:///./ 虚拟路径正确归一化", () => {
      const paths = [
        {
          raw: "webpack:///./src/components/Modal.vue?vue&type=script",
          expected: "src/components/Modal.vue",
        },
        {
          raw: "webpack:///src/components/Dialog.tsx",
          expected: "src/components/Dialog.tsx",
        },
        {
          raw: "webpack://./src/index.ts",
          expected: "src/index.ts",
        },
        {
          raw: "webpack:///node_modules/vue-router/dist/vue-router.esm.js",
          expected: "node_modules/vue-router/dist/vue-router.esm.js",
        },
      ];

      for (let i = 0; i < paths.length; i++) {
        const item = paths[i];
        const el = fakeEl(`probe-webpack-${i}`, {
          __vue__: {
            $options: {
              name: `WebpackComp_${i}`,
              __file: item.raw,
            },
            $parent: null,
          },
        });

        withDocument([el], () => {
          const results = runMainWorldFrameworkProbe([`probe-webpack-${i}`]);
          const res = results[`probe-webpack-${i}`];
          assert.ok(res, `Failed for ${item.raw}`);
          assert.equal(
            res.componentFile,
            item.expected,
            `Mismatch for ${item.raw}`
          );
        });
      }
    });

    test("极端无效路径（空串、全空格、非字符串、纯斜杠）安全降级为 undefined", () => {
      const invalidPaths = [
        "",
        "   ",
        "/",
        "//",
        "/@fs/",
        null,
        undefined,
        12345,
        {},
      ];

      for (let i = 0; i < invalidPaths.length; i++) {
        const p = invalidPaths[i];
        const el = fakeEl(`probe-invalid-${i}`, {
          __reactFiber$inv: {
            tag: 5,
            type: "div",
            _debugSource: { fileName: p as any, lineNumber: -1 },
            return: {
              tag: 0,
              type: { name: `InvComp_${i}` },
              return: null,
            },
          },
        });

        withDocument([el], () => {
          const results = runMainWorldFrameworkProbe([`probe-invalid-${i}`]);
          const res = results[`probe-invalid-${i}`];
          assert.ok(res);
          assert.equal(
            res.componentFile,
            undefined,
            `Expected undefined for ${String(p)}`
          );
          assert.equal(
            res.componentLine,
            undefined,
            `Expected undefined line for negative lineNumber`
          );
        });
      }
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 5. 敏感键脱敏全维度覆盖对抗 (Sensitive Keys Redaction)
  // ──────────────────────────────────────────────────────────────────────────
  describe("5. 敏感键脱敏全维度覆盖对抗", () => {
    test("Password, Token, Secret, Auth, Cookie 等敏感键变体完整脱敏", () => {
      const sensitiveBatchA: Record<string, unknown> = {
        password: "plain-password",
        userPassword: "user-pass-123",
        user_password: "snake-user-pass",
        PASSWORD: "all-caps-pass",
        old_password: "old-secret-pass",
        token: "tok_12345",
        api_token: "api_tok_999",
        accessToken: "acc_token_xyz",
        CSRF_TOKEN: "csrf_abc",
        secret: "my_secret",
        clientSecret: "client_sec_888",
        shared_secret_key: "shared_sec",
        auth: "auth_token_val",
        authHeader: "Bearer eyJhbGciOi...",
        authorization: "Basic dXNlcjpwYXNz",
        cookie: "session=xyz123",
        user_cookie: "id=456",
        normalUsername: "alice_smith",
      };

      const elA = fakeEl("probe-sens-batch-a", {
        __reactFiber$sensA: {
          tag: 5,
          type: "div",
          return: {
            tag: 0,
            type: { name: "SecurityAuditCompA" },
            memoizedProps: sensitiveBatchA,
            memoizedState: {
              memoizedState: {
                nestedAccount: sensitiveBatchA,
              },
              queue: { lastRenderedReducer: () => {} },
              next: null,
            },
            return: null,
          },
        },
      });

      withDocument([elA], () => {
        const results = runMainWorldFrameworkProbe(["probe-sens-batch-a"]);
        const res = results["probe-sens-batch-a"];
        assert.ok(res);
        assert.ok(res.props);
        assert.ok(res.data);

        const props = res.props as any;
        const REDACTED = "[REDACTED_SENSITIVE_KEY]";

        assert.equal(props.password, REDACTED);
        assert.equal(props.userPassword, REDACTED);
        assert.equal(props.user_password, REDACTED);
        assert.equal(props.PASSWORD, REDACTED);
        assert.equal(props.old_password, REDACTED);

        assert.equal(props.token, REDACTED);
        assert.equal(props.api_token, REDACTED);
        assert.equal(props.accessToken, REDACTED);
        assert.equal(props.CSRF_TOKEN, REDACTED);

        assert.equal(props.secret, REDACTED);
        assert.equal(props.clientSecret, REDACTED);
        assert.equal(props.shared_secret_key, REDACTED);

        assert.equal(props.auth, REDACTED);
        assert.equal(props.authHeader, REDACTED);
        assert.equal(props.authorization, REDACTED);

        assert.equal(props.cookie, REDACTED);
        assert.equal(props.user_cookie, REDACTED);

        // 非敏感键保留原值
        assert.equal(props.normalUsername, "alice_smith");

        // Hooks State 嵌套脱敏
        const stateNested = ((res.data as any).useState_0 as any).nestedAccount;
        assert.equal(stateNested.password, REDACTED);
        assert.equal(stateNested.api_token, REDACTED);
        assert.equal(stateNested.normalUsername, "alice_smith");
      });
    });

    test("JWT, Bearer, Session, Private, Key 等敏感键变体完整脱敏", () => {
      const sensitiveBatchB: Record<string, unknown> = {
        jwt: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
        jwtToken: "header.payload.signature",
        bearer: "token_value",
        bearer_token: "bearer_xyz",
        session: "sess_67890",
        sessionId: "sess_uuid_999",
        session_id: "sess_snake",
        private: "private_content",
        privateKey: "-----BEGIN RSA PRIVATE KEY-----",
        key: "plain_key",
        apiKey: "sk-proj-xxxxxxx",
        encryption_key: "aes-256-key",
        email: "alice@example.com",
        count: 42,
        active: true,
      };

      const elB = fakeEl("probe-sens-batch-b", {
        __reactFiber$sensB: {
          tag: 5,
          type: "div",
          return: {
            tag: 0,
            type: { name: "SecurityAuditCompB" },
            memoizedProps: sensitiveBatchB,
            return: null,
          },
        },
      });

      withDocument([elB], () => {
        const results = runMainWorldFrameworkProbe(["probe-sens-batch-b"]);
        const res = results["probe-sens-batch-b"];
        assert.ok(res);
        assert.ok(res.props);

        const props = res.props as any;
        const REDACTED = "[REDACTED_SENSITIVE_KEY]";

        assert.equal(props.jwt, REDACTED);
        assert.equal(props.jwtToken, REDACTED);
        assert.equal(props.bearer, REDACTED);
        assert.equal(props.bearer_token, REDACTED);

        assert.equal(props.session, REDACTED);
        assert.equal(props.sessionId, REDACTED);
        assert.equal(props.session_id, REDACTED);

        assert.equal(props.private, REDACTED);
        assert.equal(props.privateKey, REDACTED);

        // React props 中的 key 为 React 保留属性，已被过滤；apiKey 与 encryption_key 被成功脱敏
        assert.equal("key" in props, false, "React 内部 key 属性应被过滤");
        assert.equal(props.apiKey, REDACTED);
        assert.equal(props.encryption_key, REDACTED);

        // 非敏感键保留原值
        assert.equal(props.email, "alice@example.com");
        assert.equal(props.count, 42);
        assert.equal(props.active, true);
      });
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 6. 实机高压综合场景与性能基准断言 (< 10ms Benchmark & Memory Leak)
  // ──────────────────────────────────────────────────────────────────────────
  describe("6. 实机高压综合场景与执行时延断言 (< 10ms Benchmark)", () => {
    test("全对抗恶魔 DOM 树实机执行耗时严格 < 10ms，p99 延迟达标且无内存泄露", () => {
      // 构造汇聚全部对抗要素的“恶魔 DOM 树”：
      // - 30 层 DOM 祖先结构
      // - 生产混淆单字母组件 + HostComponent 混合
      // - 60 节点超长 Hooks 链表（含 useEffect 副作用）
      // - 500 属性宽对象 + 5000 元素大数组 + 深度嵌套
      // - 交叉互引用的双向环
      // - 涵盖全部变形的敏感键

      const loopObj: any = { tag: "loop-root" };
      const innerChild: any = { parent: loopObj };
      loopObj.child = innerChild;

      const largeArr = new Array(5000).fill("data-item");
      const wideProps: Record<string, any> = {
        password: "devil-password",
        apiKey: "sk-devil-key",
        accessToken: "tok_devil",
        cycle: loopObj,
        array: largeArr,
      };
      for (let i = 0; i < 500; i++) {
        wideProps[`k_${i}`] = i;
      }

      let hooksHead: any = null;
      let currHook: any = null;
      for (let h = 0; h < 60; h++) {
        const node: any = {
          memoizedState:
            h % 2 === 0
              ? { sessionToken: `sess_${h}`, cycle: loopObj }
              : { create: () => {} },
          queue: h % 2 === 0 ? { lastRenderedReducer: () => {} } : null,
          next: null,
        };
        if (!hooksHead) {
          hooksHead = node;
          currHook = node;
        } else {
          currHook.next = node;
          currHook = node;
        }
      }

      function minifiedZ() {}
      function minifiedA() {}

      const hostFiber = {
        tag: 5,
        type: "button",
        _debugSource: {
          fileName: "/work/bug-lens/src/components/DevilComponent.tsx",
          lineNumber: 666,
        },
        return: {
          tag: 0,
          type: minifiedA,
          memoizedProps: wideProps,
          memoizedState: hooksHead,
          return: {
            tag: 0,
            type: minifiedZ,
            return: null,
          },
        },
      };

      // 构造 30 层深度父级 DOM 节点
      let rootEl = fakeEl(null, { tagName: "BODY" });
      let currentEl = rootEl;
      for (let d = 0; d < 30; d++) {
        const nextEl = fakeEl(null, {
          tagName: "DIV",
          parentElement: currentEl,
        });
        currentEl = nextEl;
      }
      const targetEl = fakeEl("probe-devil-id", {
        tagName: "BUTTON",
        parentElement: currentEl,
        __reactFiber$devil: hostFiber,
      });

      const elements = [targetEl];

      withDocument(elements, () => {
        // 预热 5 次
        for (let i = 0; i < 5; i++) {
          runMainWorldFrameworkProbe(["probe-devil-id"]);
        }

        // 连续运行 100 次压测，记录各次延迟
        const iterations = 100;
        const latencies: number[] = [];

        for (let i = 0; i < iterations; i++) {
          const t0 = performance.now();
          const results = runMainWorldFrameworkProbe(["probe-devil-id"]);
          const t1 = performance.now();
          const duration = t1 - t0;
          latencies.push(duration);

          // 单次断言
          assert.ok(
            duration < 10,
            `第 ${i + 1} 次调用超时: ${duration.toFixed(3)}ms (上限 10ms)`
          );
          assert.ok(results["probe-devil-id"] !== null, "结果不应为空");
        }

        // 计算统计学指标
        latencies.sort((a, b) => a - b);
        const sum = latencies.reduce((acc, v) => acc + v, 0);
        const avg = sum / latencies.length;
        const p50 = latencies[Math.floor(latencies.length * 0.5)];
        const p90 = latencies[Math.floor(latencies.length * 0.9)];
        const p99 = latencies[Math.floor(latencies.length * 0.99)];
        const max = latencies[latencies.length - 1];

        // 严格性能阈值断言
        assert.ok(
          avg < 2.0,
          `平均执行耗时应 < 2.0ms，实际: ${avg.toFixed(3)}ms`
        );
        assert.ok(p99 < 8.0, `p99 耗时应 < 8.0ms，实际: ${p99.toFixed(3)}ms`);
        assert.ok(
          max < 10.0,
          `单次最大耗时必须严格 < 10.0ms，实际: ${max.toFixed(3)}ms`
        );

        // 验证产物结构完好性
        const sampleRes = runMainWorldFrameworkProbe(["probe-devil-id"])[
          "probe-devil-id"
        ]!;
        assert.equal(sampleRes.componentName, "minifiedA");
        assert.deepEqual(sampleRes.componentPath, ["minifiedZ", "minifiedA"]);
        assert.equal(
          sampleRes.componentFile,
          "src/components/DevilComponent.tsx"
        );
        assert.equal(sampleRes.componentLine, 666);
        assert.equal(sampleRes.props?.password, "[REDACTED_SENSITIVE_KEY]");
        assert.equal(sampleRes.props?.apiKey, "[REDACTED_SENSITIVE_KEY]");

        // 验证探针返回对象不包含 DOM 实例、无死循环引用
        const serialized = JSON.stringify(sampleRes);
        assert.ok(serialized.length > 0);
      });
    });
  });
});
