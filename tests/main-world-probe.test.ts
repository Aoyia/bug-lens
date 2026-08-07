import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runMainWorldFrameworkProbe } from "../src/screenshot/main-world-probe.ts";

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
        componentName: "<ElCard>",
        componentPath: ["<ElCard>", "<App>"],
        framework: "vue",
        version: 2,
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
      assert.deepEqual(results["blp-1"]?.componentPath, [
        "<ElFormItem>",
        "<App>",
      ]);
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
        componentName: "<UserCard>",
        componentPath: ["<UserCard>", "<App>"],
        framework: "vue",
        version: 3,
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
        componentName: "<OrderButton>",
        componentPath: ["<OrderButton>", "<App>"],
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
      assert.equal(results["blp-5"]?.componentName, "<App>");
      assert.equal(results["other-id"], undefined);
    });
  });
});
