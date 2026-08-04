import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  isReactProject,
  detectReact,
} from "../src/entrypoints/content/react-detector.ts";

describe("React Detector", () => {
  let mockWindow: any;
  let mockDocument: any;
  let originalWindow: any;
  let originalDocument: any;

  beforeEach(() => {
    originalWindow = (globalThis as any).window;
    originalDocument = (globalThis as any).document;

    (globalThis as any).HTMLElement = class HTMLElement {};
    (globalThis as any).Node = class Node {};

    mockDocument = {
      body: {
        parentElement: null,
      },
      getElementById: (id: string) => null,
      querySelector: (selector: string) => null,
    };

    mockWindow = {
      __REACT_DEVTOOLS_GLOBAL_HOOK__: undefined,
    };

    (globalThis as any).window = mockWindow;
    (globalThis as any).document = mockDocument;
  });

  afterEach(() => {
    (globalThis as any).window = originalWindow;
    (globalThis as any).document = originalDocument;
  });

  describe("isReactProject", () => {
    test("returns true when React DevTools hook is present", () => {
      mockWindow.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {};
      assert.equal(isReactProject(), true);
    });

    test("returns true when body or root element contains reactFiber key", () => {
      mockDocument.body.__reactFiber$abc = {};
      assert.equal(isReactProject(), true);
    });

    test("returns true when querySelector finds react element", () => {
      mockDocument.querySelector = (selector: string) => {
        if (selector === "#root, [data-reactroot]") return {};
        return null;
      };
      assert.equal(isReactProject(), true);
    });

    test("returns false when no React indicators are found", () => {
      assert.equal(isReactProject(), false);
    });
  });

  describe("detectReact & redactAndSanitize", () => {
    test("returns undefined when element or React project is not found", () => {
      assert.equal(detectReact(null as any), undefined);

      const el = { parentElement: null } as any;
      assert.equal(detectReact(el), undefined);
    });

    test("detects React Fiber tree, extracts props/state and sanitizes sensitive data & circular refs", () => {
      mockWindow.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {};

      const parentFiber = {
        tag: 1, // Class Component
        type: function ParentComponent() {},
        memoizedProps: {
          title: "Parent Title",
          authToken: "secret-token-123",
          userPassword: "my-password",
        },
        stateNode: {
          state: {
            parentState: "ok",
            apiSecretKey: "hidden-key",
          },
        },
        return: null,
      };

      const circularObj: any = { name: "test" };
      circularObj.self = circularObj;

      const targetFiber = {
        tag: 0, // Function Component
        type: { displayName: "TargetComponent" },
        memoizedProps: {
          normalProp: "hello",
          creditcard: "1234-5678-9012-3456",
          circular: circularObj,
          deep: { level1: { level2: { level3: "too deep" } } },
        },
        return: parentFiber,
        child: null,
      };

      (parentFiber as any).child = targetFiber;

      const targetElement: any = {
        parentElement: mockDocument.body,
        __reactFiber$123: targetFiber,
      };

      const result = detectReact(targetElement);

      assert.ok(result);
      assert.ok(result.targetComponent);
      assert.equal(result.targetComponent.componentName, "TargetComponent");
      assert.equal(result.targetComponent.isTarget, true);
      assert.equal(result.targetComponent.framework, "react");

      // Verify Redaction & Deep sanitization
      const props = result.targetComponent.props as any;
      assert.equal(props.normalProp, "hello");
      assert.equal(props.creditcard, "[REDACTED:sensitive-store-key]");
      assert.equal(props.circular.self, "[CIRCULAR]");
      assert.equal(props.deep.level1.level2, "[MAX_DEPTH]");

      // Verify Parent Chain
      assert.equal(result.parentChain.length, 1);
      assert.equal(result.parentChain[0].componentName, "ParentComponent");
      assert.equal(
        (result.parentChain[0].props as any).authToken,
        "[REDACTED:sensitive-store-key]"
      );
      assert.equal(
        (result.parentChain[0].state as any).apiSecretKey,
        "[REDACTED:sensitive-store-key]"
      );
    });
  });
});
