import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  captureGlobalState,
  captureWebStorage,
  captureFrameworkState,
  captureFrameworkStateWithMainProbe,
  probeEntryToFrameworkSnapshot,
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

  describe("captureFrameworkStateWithMainProbe", () => {
    test("populates FrameworkSnapshot via main-world probe when isolated detectors find nothing", async () => {
      const btn = { tagName: "BUTTON", id: "submit-btn" } as unknown as Element;
      mockDocument.body = { tagName: "BODY", parentElement: null };
      mockDocument.querySelector = () => null;
      const state = await captureFrameworkStateWithMainProbe({
        sessionId: "s-probe",
        trigger: "interaction",
        privacyMode: "safe",
        targetElement: btn,
        probeFn: async (elements) => {
          assert.equal(elements[0], btn);
          return new Map([
            [
              btn,
              {
                framework: "vue",
                version: 3,
                componentName: "SubmitButton",
                componentPath: ["App", "WorkStationForm", "SubmitButton"],
                componentFile: "src/components/SubmitButton.vue",
                componentLine: 42,
                props: { loading: false, apiToken: "secret-123" },
                data: { count: 2 },
              },
            ],
          ]);
        },
      });

      assert.equal(state.snapshot?.rootComponent?.componentName, "App");
      assert.equal(
        state.snapshot?.parentChain.map((n) => n.componentName).join(">"),
        "WorkStationForm"
      );
      assert.equal(
        state.snapshot?.targetComponent?.componentName,
        "SubmitButton"
      );
      assert.equal(
        state.snapshot?.targetComponent?.componentFile,
        "src/components/SubmitButton.vue"
      );
      assert.equal(state.snapshot?.targetComponent?.componentLine, 42);
      assert.equal(
        state.snapshot?.targetComponent?.props?.apiToken,
        "[REDACTED:sensitive-store-key]"
      );
      assert.equal(isMeaningfulFrameworkState(state), true);
    });

    test("strict privacy mode redacts string values from probed component props/data", () => {
      const snapshot = probeEntryToFrameworkSnapshot(
        {
          framework: "react",
          version: 18,
          componentName: "OrderCard",
          componentPath: ["OrderCard"],
          props: { orderId: "ORD-999", total: 100 },
          data: { note: "vip customer" },
        },
        "strict"
      );
      assert.ok(snapshot);
      assert.equal(snapshot!.rootComponent, undefined);
      assert.equal(snapshot!.targetComponent?.props?.orderId, "[REDACTED]");
      assert.equal(snapshot!.targetComponent?.props?.total, 100);
      assert.equal(snapshot!.targetComponent?.state?.note, "[REDACTED]");
    });

    test("injects penetrated business parentComponents props/state/file into parentChain & rootComponent", () => {
      const snapshot = probeEntryToFrameworkSnapshot(
        {
          framework: "vue",
          version: 2,
          componentName: "ElButton",
          componentPath: ["App", "EditIssueDialog", "ElFormItem", "ElButton"],
          componentFile: "node_modules/element-ui/lib/button.js",
          props: { type: "primary" },
          parentComponents: [
            {
              componentName: "EditIssueDialog",
              componentFile: "src/pages/work_station/edit_issue.vue",
              props: { visible: true, authSecret: "top-secret" },
              data: { category_key: "", isDirty: true },
            },
            {
              componentName: "App",
              componentFile: "src/App.vue",
              data: { currentProjectId: 101935 },
            },
            {
              componentName: "DeepBusinessPage",
              componentFile: "src/pages/DeepBusinessPage.vue",
              data: { extraFlag: "preserved" },
            },
          ],
        },
        "safe"
      );

      assert.ok(snapshot);
      assert.equal(snapshot!.rootComponent?.componentName, "App");
      assert.equal(snapshot!.rootComponent?.componentFile, "src/App.vue");
      assert.deepEqual(snapshot!.rootComponent?.state, {
        currentProjectId: 101935,
      });

      const editNode = snapshot!.parentChain.find(
        (n) => n.componentName === "EditIssueDialog"
      );
      assert.ok(editNode);
      assert.equal(
        editNode.componentFile,
        "src/pages/work_station/edit_issue.vue"
      );
      assert.equal(
        editNode.props?.authSecret,
        "[REDACTED:sensitive-store-key]"
      );
      assert.deepEqual(editNode.state, { category_key: "", isDirty: true });

      // Exceeded MAX_PATH parent still preserved in parentChain
      const extraNode = snapshot!.parentChain.find(
        (n) => n.componentName === "DeepBusinessPage"
      );
      assert.ok(extraNode);
      assert.deepEqual(extraNode.state, { extraFlag: "preserved" });

      // Strict privacy mode also redacts penetrated parent strings
      const strictSnap = probeEntryToFrameworkSnapshot(
        {
          framework: "vue",
          version: 2,
          componentName: "ElButton",
          componentPath: ["EditIssueDialog", "ElButton"],
          parentComponents: [
            {
              componentName: "EditIssueDialog",
              data: { title: "sensitive-title", count: 3 },
            },
          ],
        },
        "strict"
      );
      assert.equal(strictSnap?.rootComponent?.state?.title, "[REDACTED]");
      assert.equal(strictSnap?.rootComponent?.state?.count, 3);
    });
  });
});
