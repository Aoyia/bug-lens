import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  isVueProject,
  detectVue,
} from "../src/entrypoints/content/vue-detector.ts";

describe("Vue Detector", () => {
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

    mockWindow = {};

    (globalThis as any).window = mockWindow;
    (globalThis as any).document = mockDocument;
  });

  afterEach(() => {
    (globalThis as any).window = originalWindow;
    (globalThis as any).document = originalDocument;
  });

  describe("isVueProject", () => {
    test("returns true when window.__VUE__ or window.Vue is present", () => {
      mockWindow.__VUE__ = true;
      assert.equal(isVueProject(), true);

      mockWindow.__VUE__ = undefined;
      mockWindow.Vue = {};
      assert.equal(isVueProject(), true);
    });

    test("returns true when Vue DevTools apps array is non-empty", () => {
      mockWindow.__VUE_DEVTOOLS_GLOBAL_HOOK__ = { apps: [1] };
      assert.equal(isVueProject(), true);
    });

    test("returns true when DOM selector finds vue attributes", () => {
      mockDocument.querySelector = (selector: string) => {
        if (selector === "[data-v-app]") return {};
        return null;
      };
      assert.equal(isVueProject(), true);
    });

    test("returns false when no Vue indicators are found", () => {
      assert.equal(isVueProject(), false);
    });
  });

  describe("detectVue - Vue 3 Component Tree", () => {
    test("detects Vue 3 component, parent chain, subTree children, and sanitizes data", () => {
      mockWindow.__VUE__ = true;

      const parentComp = {
        type: { __name: "ParentVue3" },
        props: {
          title: "Vue3 Parent",
          jwtToken: "eyJhbGciOi...",
        },
        setupState: {
          parentCount: 10,
        },
        parent: null,
      };

      const childComp = {
        type: { name: "ChildVue3" },
        props: { childProp: "childValue" },
        parent: parentComp,
      };

      const circularObj: any = { status: "active" };
      circularObj.self = circularObj;

      const targetComp = {
        type: { __name: "TargetVue3" },
        props: {
          secretKey: "sensitive-123",
          userPhone: "13800138000",
          circular: circularObj,
        },
        setupState: {
          count: 1,
        },
        parent: parentComp,
        subTree: {
          children: [{ component: childComp }],
        },
      };

      (parentComp as any).subTree = {
        children: [{ component: targetComp }],
      };

      const targetElement: any = {
        parentElement: mockDocument.body,
        __vueParentComponent: targetComp,
      };

      const result = detectVue(targetElement);

      assert.ok(result);
      assert.ok(result.targetComponent);
      assert.equal(result.targetComponent.componentName, "TargetVue3");
      assert.equal(result.targetComponent.version, 3);
      assert.equal(result.targetComponent.isTarget, true);

      // Props redaction
      const props = result.targetComponent.props as any;
      assert.equal(props.secretKey, "[REDACTED:sensitive-store-key]");
      assert.equal(props.userPhone, "[REDACTED:sensitive-store-key]");
      assert.equal(props.circular.self, "[CIRCULAR]");

      // Parent chain
      assert.equal(result.parentChain.length, 1);
      assert.equal(result.parentChain[0].componentName, "ParentVue3");
      assert.equal(
        (result.parentChain[0].props as any).jwtToken,
        "[REDACTED:sensitive-store-key]"
      );

      // Root tree children
      assert.ok(result.rootComponent);
      assert.equal(result.rootComponent.componentName, "ParentVue3");
      assert.ok(result.rootComponent.children);
      assert.equal(
        result.rootComponent.children[0].componentName,
        "TargetVue3"
      );
    });
  });

  describe("detectVue - Vue 2 Component Tree", () => {
    test("detects Vue 2 component, parent chain, $children, and sanitizes data", () => {
      mockWindow.Vue = {};

      const parentVm = {
        $options: { name: "ParentVue2" },
        $props: {
          bearerToken: "bearer-xyz",
        },
        _data: {
          privateData: "hidden",
        },
        $parent: null,
      };

      const targetVm = {
        $options: { _componentTag: "target-vue2" },
        $props: {
          publicInfo: "public",
          authCode: "auth-999",
        },
        _data: {
          mobileNum: "10086",
        },
        $parent: parentVm,
        $children: [],
      };

      (parentVm as any).$children = [targetVm];

      const targetElement: any = {
        parentElement: mockDocument.body,
        __vue__: targetVm,
      };

      const result = detectVue(targetElement);

      assert.ok(result);
      assert.ok(result.targetComponent);
      assert.equal(result.targetComponent.componentName, "target-vue2");
      assert.equal(result.targetComponent.version, 2);

      const props = result.targetComponent.props as any;
      assert.equal(props.publicInfo, "public");
      assert.equal(props.authCode, "[REDACTED:sensitive-store-key]");

      const state = result.targetComponent.state as any;
      assert.equal(state.mobileNum, "[REDACTED:sensitive-store-key]");

      assert.equal(result.parentChain.length, 1);
      assert.equal(result.parentChain[0].componentName, "ParentVue2");
    });
  });
});
