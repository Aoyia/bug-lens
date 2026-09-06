import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runMainWorldFrameworkProbe } from "../src/screenshot/probes/main-world-probe.ts";
import { buildScreenshotZipPackage } from "../src/screenshot/pipeline/screenshot-zip-builder.ts";
import {
  normalizePayloadKeyOrder,
  type AIScreenshotPayload,
} from "../src/domain/screenshot-payload.ts";
import { unzipSync, strFromU8 } from "fflate";

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

describe("Empirical Challenger M4-REM Suite 1: React 18 Hooks Sensitive State Redaction", () => {
  test("1.1 TodoItem Fiber: useState_2 & useState_3 are strictly redacted, useState_0 & useState_1 preserved intact", () => {
    // 模拟 e2e/fixtures/apps/react-app/src/components/TodoItem.jsx 真实 Fiber 结构
    const hook4 = {
      memoizedState: "react18-item-password-secret-888",
      queue: { lastRenderedReducer: () => {} },
      next: null,
    };
    const hook3 = {
      memoizedState: "react18-item-token-secret-777",
      queue: { lastRenderedReducer: () => {} },
      next: hook4,
    };
    const hook2 = {
      memoizedState: "Internal notes for React item",
      queue: { lastRenderedReducer: () => {} },
      next: hook3,
    };
    const hook1 = {
      memoizedState: 0,
      queue: { lastRenderedReducer: () => {} },
      next: hook2,
    };

    const el = fakeEl("probe-todo-1", {
      __reactFiber$test: {
        tag: 5,
        type: "div",
        return: {
          tag: 0,
          type: { name: "TodoItem" },
          _debugSource: {
            fileName: "src/components/TodoItem.jsx",
            lineNumber: 15,
          },
          memoizedProps: {
            id: 1,
            title: "Learn Bug Lens",
            completed: false,
            secretToken: "default-secret-token-react18",
            authPassword: "default-auth-password-react18",
          },
          memoizedState: hook1,
          return: null,
        },
      },
    });

    withDocument([el], () => {
      const results = runMainWorldFrameworkProbe(["probe-todo-1"]);
      const entry = results["probe-todo-1"];
      assert.ok(entry, "Probe entry should be found");
      assert.equal(entry.framework, "react");
      assert.equal(entry.version, 18);
      assert.equal(entry.componentFile, "src/components/TodoItem.jsx");
      assert.equal(entry.componentLine, 15);

      // 验证 props 脱敏
      assert.ok(entry.props);
      assert.equal(entry.props.id, 1);
      assert.equal(entry.props.title, "Learn Bug Lens");
      assert.equal(entry.props.completed, false);
      assert.equal(entry.props.secretToken, "[REDACTED_SENSITIVE_KEY]");
      assert.equal(entry.props.authPassword, "[REDACTED_SENSITIVE_KEY]");

      // 验证 data (Hooks 解包)
      assert.ok(entry.data);
      assert.equal(
        entry.data.useState_0,
        0,
        "useState_0 should remain number 0"
      );
      assert.equal(
        entry.data.useState_1,
        "Internal notes for React item",
        "useState_1 should remain plaintext notes"
      );
      assert.equal(
        entry.data.useState_2,
        "[REDACTED_SENSITIVE_KEY]",
        "useState_2 must be redacted"
      );
      assert.equal(
        entry.data.useState_3,
        "[REDACTED_SENSITIVE_KEY]",
        "useState_3 must be redacted"
      );

      // 全量明文扫描：断言序列化文本中 0 个明文敏感字符串
      const serialized = JSON.stringify(entry);
      assert.equal(
        serialized.includes("react18-item-token-secret-777"),
        false,
        "Zero token plaintext allowed"
      );
      assert.equal(
        serialized.includes("react18-item-password-secret-888"),
        false,
        "Zero password plaintext allowed"
      );
      assert.equal(
        serialized.includes("default-secret-token-react18"),
        false,
        "Zero default token plaintext allowed"
      );
      assert.equal(
        serialized.includes("default-auth-password-react18"),
        false,
        "Zero default password plaintext allowed"
      );
    });
  });

  test("1.2 Edge cases: Nested objects, arrays, and useMemo in hooks are redacted", () => {
    const hook3 = {
      memoizedState: ["https://api.example.com?auth_token=jwt12345", ["dep1"]], // useMemo
      queue: null,
      next: null,
    };
    const hook2 = {
      memoizedState: {
        config: {
          clientSecret: "very-secret-value",
          normalField: "safe-text",
        },
        items: ["safe-item", "bearer-token-xyz"],
      },
      queue: { lastRenderedReducer: () => {} },
      next: hook3,
    };
    const hook1 = {
      memoizedState: { current: "normal-ref-value" },
      queue: null,
      next: hook2,
    };

    const el = fakeEl("probe-edge-1", {
      __reactFiber$test: {
        tag: 5,
        type: "div",
        return: {
          tag: 0,
          type: { name: "ComplexComponent" },
          memoizedState: hook1,
          return: null,
        },
      },
    });

    withDocument([el], () => {
      const results = runMainWorldFrameworkProbe(["probe-edge-1"]);
      const entry = results["probe-edge-1"];
      assert.ok(entry);
      assert.ok(entry.data);
      assert.equal(entry.data.useRef_0, "normal-ref-value");

      const state1 = entry.data.useState_0 as any;
      assert.ok(state1);
      assert.equal(state1.config.clientSecret, "[REDACTED_SENSITIVE_KEY]");
      assert.equal(state1.config.normalField, "safe-text");
      assert.equal(state1.items[0], "safe-item");
      assert.equal(state1.items[1], "[REDACTED_SENSITIVE_KEY]");

      assert.equal(entry.data.useMemo_0, "[REDACTED_SENSITIVE_KEY]");
    });
  });

  test("1.3 Non-sensitive states are preserved without false positive redactions", () => {
    const hook1 = {
      memoizedState: "Regular description without any sensitive words",
      queue: { lastRenderedReducer: () => {} },
      next: {
        memoizedState: 123456,
        queue: { lastRenderedReducer: () => {} },
        next: {
          memoizedState: true,
          queue: { lastRenderedReducer: () => {} },
          next: null,
        },
      },
    };

    const el = fakeEl("probe-safe-1", {
      __reactFiber$test: {
        tag: 5,
        type: "div",
        return: {
          tag: 0,
          type: { name: "SafeComponent" },
          memoizedState: hook1,
          return: null,
        },
      },
    });

    withDocument([el], () => {
      const results = runMainWorldFrameworkProbe(["probe-safe-1"]);
      const entry = results["probe-safe-1"];
      assert.ok(entry?.data);
      assert.equal(
        entry.data.useState_0,
        "Regular description without any sensitive words"
      );
      assert.equal(entry.data.useState_1, 123456);
      assert.equal(entry.data.useState_2, true);
    });
  });
});

describe("Empirical Challenger M4-REM Suite 2: ZIP Export Package environment.json Zero-Leak Oracle", () => {
  test("2.1 End-to-end ZIP package environment.json contains ZERO leaked secrets", async () => {
    const sampleState = {
      componentName: "TodoItem",
      componentPath: ["App", "TodoList", "TodoItem"],
      framework: "react" as const,
      version: 18,
      componentFile: "src/components/TodoItem.jsx",
      componentLine: 15,
      props: {
        id: 1,
        title: "Learn Bug Lens",
        secretToken: "[REDACTED_SENSITIVE_KEY]",
        authPassword: "[REDACTED_SENSITIVE_KEY]",
      },
      data: {
        useState_0: 0,
        useState_1: "Internal notes for React item",
        useState_2: "[REDACTED_SENSITIVE_KEY]",
        useState_3: "[REDACTED_SENSITIVE_KEY]",
      },
    };

    const payload: AIScreenshotPayload = {
      version: "1.0",
      timestamp: 1700000000000,
      cropBounds: { x: 0, y: 0, width: 800, height: 600 },
      image: {
        base64Data:
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        width: 800,
        height: 600,
        devicePixelRatio: 2,
      },
      annotations: [],
      annotationGroups: [],
      domContextTree: {
        smallestCommonAncestorSelector: "div#app",
        meta: {
          anchorCount: 0,
          leafCount: 0,
          ancestorCount: 0,
          truncated: false,
        },
        anchors: [],
        leaves: [],
        ancestors: [],
      },
      environment: {
        url: "http://127.0.0.1:64601/apps/react/dev/index.html",
        title: "React 18 Dev App",
        userAgent: "Playwright-Chrome",
        viewport: { width: 1280, height: 900 },
        mediaBreakpoint: "desktop",
        frameworkComponentStates: [sampleState],
        vueComponentStates: [sampleState],
        recentConsoleErrors: [],
        recentFailedRequests: [],
      },
    };

    const normalized = normalizePayloadKeyOrder(payload);
    const pack = buildScreenshotZipPackage(normalized);
    const zipBytes = new Uint8Array(await pack.blob.arrayBuffer());
    const unzipped = unzipSync(zipBytes);

    assert.ok(
      unzipped["environment.json"],
      "environment.json must exist in ZIP"
    );
    const envJsonStr = strFromU8(unzipped["environment.json"]);
    const envJson = JSON.parse(envJsonStr);

    // 验证双写对齐
    assert.deepEqual(
      envJson.frameworkComponentStates,
      envJson.vueComponentStates
    );

    // 验证状态提取与脱敏
    const todo = envJson.frameworkComponentStates[0];
    assert.equal(todo.componentFile, "src/components/TodoItem.jsx");
    assert.equal(todo.componentLine, 15);
    assert.equal(todo.data.useState_0, 0);
    assert.equal(todo.data.useState_1, "Internal notes for React item");
    assert.equal(todo.data.useState_2, "[REDACTED_SENSITIVE_KEY]");
    assert.equal(todo.data.useState_3, "[REDACTED_SENSITIVE_KEY]");
    assert.equal(todo.props.secretToken, "[REDACTED_SENSITIVE_KEY]");
    assert.equal(todo.props.authPassword, "[REDACTED_SENSITIVE_KEY]");

    // 全量明文扫描
    assert.equal(envJsonStr.includes("react18-item-token-secret-777"), false);
    assert.equal(
      envJsonStr.includes("react18-item-password-secret-888"),
      false
    );
    assert.equal(envJsonStr.includes("default-secret-token-react18"), false);
    assert.equal(envJsonStr.includes("default-auth-password-react18"), false);
  });
});
