import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  captureGlobalState,
  captureWebStorage,
  captureFrameworkState,
  isMeaningfulFrameworkState,
} from "../src/domain/framework-state-capture.ts";
import { captureReactTree } from "../src/entrypoints/content/react-detector.ts";

describe("Framework State Capture", () => {
  let mockWindow: any;
  let mockDocument: any;
  let mockLocation: any;
  let originalWindow: any;
  let originalDocument: any;
  let originalLocation: any;
  let originalHTMLElement: any;
  let originalNode: any;

  beforeEach(() => {
    originalWindow = (globalThis as any).window;
    originalDocument = (globalThis as any).document;
    originalLocation = (globalThis as any).location;
    originalHTMLElement = (globalThis as any).HTMLElement;
    originalNode = (globalThis as any).Node;

    class MockHTMLElement {}
    class MockNode {}
    (globalThis as any).HTMLElement = MockHTMLElement;
    (globalThis as any).Node = MockNode;

    mockLocation = { href: "https://example.com/checkout", protocol: "https:" };

    mockDocument = {
      title: "Checkout",
      body: { parentElement: null },
      getElementById: (id: string) => null,
      querySelector: (selector: string) => null,
    };

    const storageEntries = new Map<string, string>([
      ["theme", "dark"],
      ["cartItems", "[1,2,3]"],
      ["authToken", "secret-jwt-token"],
    ]);
    mockWindow = {
      __REACT_DEVTOOLS_GLOBAL_HOOK__: undefined,
      innerWidth: 1280,
      innerHeight: 800,
      scrollY: 120,
      top: null,
      localStorage: {
        length: storageEntries.size,
        key: (index: number) => [...storageEntries.keys()][index] ?? null,
        getItem: (key: string) => storageEntries.get(key) ?? null,
      },
      sessionStorage: { length: 0, key: () => null, getItem: () => null },
    };
    mockWindow.top = mockWindow;

    (globalThis as any).window = mockWindow;
    (globalThis as any).document = mockDocument;
    (globalThis as any).location = mockLocation;
  });

  afterEach(() => {
    (globalThis as any).window = originalWindow;
    (globalThis as any).document = originalDocument;
    (globalThis as any).location = originalLocation;
    (globalThis as any).HTMLElement = originalHTMLElement;
    (globalThis as any).Node = originalNode;
  });

  describe("captureWebStorage", () => {
    test("safe mode records keys with redacted values and redacts sensitive keys", () => {
      const result = captureWebStorage("safe");
      assert.ok(result);
      assert.equal(result!.redactedValues, true);
      assert.deepEqual(result!.localStorage, {
        theme: "[REDACTED]",
        cartItems: "[REDACTED]",
        authToken: "[REDACTED]",
      });
    });

    test("raw mode keeps plain values but redacts sensitive keys", () => {
      const result = captureWebStorage("raw");
      assert.ok(result);
      assert.equal(result!.redactedValues, false);
      assert.equal(result!.localStorage!.theme, "dark");
      assert.equal(result!.localStorage!.cartItems, "[1,2,3]");
      assert.equal(
        result!.localStorage!.authToken,
        "[REDACTED:sensitive-store-key]"
      );
    });
  });

  describe("captureGlobalState", () => {
    test("collects known SSR/state mount points and sanitizes them", () => {
      mockWindow.__INITIAL_STATE__ = {
        user: { name: "Alice", token: "abc123" },
        items: ["a", "b"],
      };
      mockWindow.__NEXT_DATA__ = { props: { pageProps: { ok: true } } };
      const result = captureGlobalState();
      assert.ok(result);
      assert.equal(
        (result!.__INITIAL_STATE__ as any).user.token,
        "[REDACTED:sensitive-store-key]"
      );
      assert.equal((result!.__INITIAL_STATE__ as any).items.length, 2);
      assert.deepEqual((result!.__NEXT_DATA__ as any).props.pageProps, {
        ok: true,
      });
    });

    test("returns undefined when no mount points exist", () => {
      assert.equal(captureGlobalState(), undefined);
    });
  });

  describe("captureFrameworkState", () => {
    test("captures page context and web storage without a framework tree", () => {
      const state = captureFrameworkState({
        sessionId: "s1",
        trigger: "start",
        privacyMode: "safe",
      });
      assert.equal(state.sessionId, "s1");
      assert.equal(state.trigger, "start");
      assert.equal(state.page.url, "https://example.com/checkout");
      assert.equal(state.page.title, "Checkout");
      assert.equal(state.page.scrollY, 120);
      assert.ok(state.webStorage);
      assert.equal(isMeaningfulFrameworkState(state), true);
    });

    test("isMeaningfulFrameworkState returns false for an empty frame", () => {
      const empty = {
        id: "x",
        sessionId: "s1",
        capturedAtEpochMs: 0,
        trigger: "start" as const,
        page: { url: "", title: "" },
      };
      assert.equal(isMeaningfulFrameworkState(empty as any), false);
    });
  });

  describe("captureReactTree", () => {
    test("captures full component tree from body fiber without a target element", () => {
      const appFiber = {
        tag: 0,
        type: { displayName: "App" },
        memoizedProps: { title: "Hello", password: "pwd" },
        state: undefined,
        return: null,
        child: null,
      };
      const formFiber = {
        tag: 0,
        type: { displayName: "CheckoutForm" },
        memoizedProps: { items: 3 },
        return: appFiber,
        child: null,
        sibling: null,
      };
      const hostRootFiber = {
        tag: 3,
        return: null,
        child: appFiber,
        sibling: null,
      };
      appFiber.return = hostRootFiber;
      appFiber.child = formFiber;
      mockDocument.body.__reactFiber$xyz = hostRootFiber;

      const result = captureReactTree();
      assert.ok(result);
      assert.equal(result!.rootComponent?.componentName, "App");
      assert.equal(result!.rootComponent?.children?.length, 1);
      assert.equal(
        result!.rootComponent?.children?.[0].componentName,
        "CheckoutForm"
      );
      // Sensitive props are redacted even in the full tree
      assert.equal(
        (result!.rootComponent?.props as any).password,
        "[REDACTED:sensitive-store-key]"
      );
    });
  });
});
