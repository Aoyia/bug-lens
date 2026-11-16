import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import {
  AI_CRITICAL_CSS_PROPERTIES,
  buildDomSnapshot,
  extractWinnerCssRules,
  findRelatedPortalOverlays,
  findTriggerForPortalElement,
} from "../src/entrypoints/content/collector/dom-snapshot.ts";
import { sanitizeIssueScene } from "../src/domain/privacy-policy.ts";
import { buildIssueSceneDomFilesV5 } from "../src/export/ai-pack-slimming.ts";
import type { IssueScene } from "../src/shared/protocol.ts";

describe("Schema v5 DOM Snapshot (CSS 34 props, Portal, Winner Rules)", () => {
  const originalDocument = (globalThis as any).document;
  const originalGetComputedStyle = (globalThis as any).getComputedStyle;
  const originalMatchMedia = (globalThis as any).matchMedia;
  const originalNode = (globalThis as any).Node;
  const originalElement = (globalThis as any).Element;
  const originalHTMLElement = (globalThis as any).HTMLElement;

  afterEach(() => {
    (globalThis as any).document = originalDocument;
    (globalThis as any).getComputedStyle = originalGetComputedStyle;
    (globalThis as any).matchMedia = originalMatchMedia;
    (globalThis as any).Node = originalNode;
    (globalThis as any).Element = originalElement;
    (globalThis as any).HTMLElement = originalHTMLElement;
  });

  function makeMockElement(init: {
    tagName: string;
    id?: string;
    classes?: string[];
    attrs?: Record<string, string>;
    text?: string;
    rect?: { x: number; y: number; width: number; height: number };
    styles?: Record<string, string>;
    inlineStyle?: Record<string, { value: string; important?: boolean }>;
    parent?: any;
    doc?: any;
    matchesSelectors?: string[];
  }) {
    const attrs = new Map<string, string>(Object.entries(init.attrs ?? {}));
    if (init.id) attrs.set("id", init.id);
    const children: any[] = [];
    const classes = init.classes ?? [];
    const rect = init.rect ?? { x: 10, y: 20, width: 100, height: 32 };
    const inlineEntries = Object.entries(init.inlineStyle ?? {});
    const inlineStyleObj: Record<string, unknown> = {
      length: inlineEntries.length,
      getPropertyValue: (p: string) => init.inlineStyle?.[p]?.value ?? "",
      getPropertyPriority: (p: string) =>
        init.inlineStyle?.[p]?.important ? "important" : "",
    };
    inlineEntries.forEach(([prop], idx) => {
      inlineStyleObj[idx] = prop;
    });

    const el: any = {
      tagName: init.tagName.toUpperCase(),
      id: init.id ?? "",
      className: classes.join(" "),
      classList: {
        ...classes,
        [Symbol.iterator]: () => classes[Symbol.iterator](),
        contains: (c: string) => classes.includes(c),
        length: classes.length,
      },
      attributes: Array.from(attrs.entries()).map(([name, value]) => ({
        name,
        value,
      })),
      children,
      childNodes: children,
      parentElement: init.parent ?? null,
      ownerDocument: init.doc,
      isConnected: true,
      getRootNode: () => init.doc,
      style: inlineStyleObj,
      getAttribute: (name: string) => attrs.get(name) ?? null,
      hasAttribute: (name: string) => attrs.has(name),
      getBoundingClientRect: () => ({
        ...rect,
        left: rect.x,
        top: rect.y,
        right: rect.x + rect.width,
        bottom: rect.y + rect.height,
      }),
      closest: (sel: string) => {
        let curr: any = el;
        while (curr) {
          if (curr.matches(sel)) return curr;
          curr = curr.parentElement;
        }
        return null;
      },
      matches: (sel: string) => {
        if (init.matchesSelectors?.includes(sel)) return true;
        if (sel.includes("#") && init.id && sel.includes(`#${init.id}`)) {
          return true;
        }
        if (sel.includes(`[aria-controls`)) {
          const val = attrs.get("aria-controls");
          return Boolean(val && sel.includes(val));
        }
        return classes.some((c) => sel.includes(`.${c}`));
      },
      contains: (other: any): boolean => {
        let curr = other;
        while (curr) {
          if (curr === el) return true;
          curr = curr.parentElement;
        }
        return false;
      },
      cloneNode: () => ({
        tagName: init.tagName.toUpperCase(),
        outerHTML: `<${init.tagName.toLowerCase()}${init.id ? ` id="${init.id}"` : ""}>${init.text ?? ""}</${init.tagName.toLowerCase()}>`,
        querySelectorAll: () => [],
        attributes: [],
        removeAttribute: () => {},
        setAttribute: () => {},
      }),
      textContent: init.text ?? "",
      innerText: init.text ?? "",
      __styles: init.styles ?? {},
    };
    if (init.parent) {
      init.parent.children.push(el);
    }
    return el;
  }

  beforeEach(() => {
    class MockElement {}
    (globalThis as any).Element = MockElement;
    (globalThis as any).HTMLElement = MockElement;
    (globalThis as any).Node = MockElement;
    (globalThis as any).getComputedStyle = (el: any) => ({
      getPropertyValue: (key: string) => el.__styles?.[key] ?? "",
      display: el.__styles?.display ?? "block",
      visibility: el.__styles?.visibility ?? "visible",
      opacity: el.__styles?.opacity ?? "1",
      position: el.__styles?.position ?? "static",
    });
    (globalThis as any).matchMedia = () => ({ matches: true });
  });

  test("captures all 32 AI_CRITICAL_CSS_PROPERTIES plus color & background-color without truncation in sanitizeIssueScene", () => {
    const doc: any = {
      styleSheets: [],
      body: null,
      getElementById: () => null,
    };
    const body = makeMockElement({ tagName: "body", doc });
    const app = makeMockElement({
      tagName: "div",
      id: "app",
      parent: body,
      doc,
    });
    const fullStyles: Record<string, string> = {};
    for (const key of AI_CRITICAL_CSS_PROPERTIES) {
      fullStyles[key] = `val-${key}`;
    }
    fullStyles.color = "rgb(10, 20, 30)";
    fullStyles["background-color"] = "rgb(255, 255, 255)";
    fullStyles["white-space"] = "nowrap";
    fullStyles["text-overflow"] = "ellipsis";

    const td = makeMockElement({
      tagName: "td",
      classes: ["cell-wrap"],
      parent: app,
      doc,
      styles: fullStyles,
    });

    const snap = buildDomSnapshot(td, "safe");
    for (const key of AI_CRITICAL_CSS_PROPERTIES) {
      assert.equal(snap.computedStyle[key], fullStyles[key]);
    }
    assert.equal(snap.computedStyle.color, "rgb(10, 20, 30)");
    assert.equal(snap.computedStyle["background-color"], "rgb(255, 255, 255)");

    const scene: IssueScene = {
      id: "scene-34css",
      sessionId: "sess-1",
      status: "draft",
      observedAtEpochMs: 1,
      page: { url: "https://example.test", title: "Table", frameId: 0 },
      target: snap,
      annotation: {
        type: "arrow-box",
        color: "#ef233c",
        point: { xRatio: 0.5, yRatio: 0.5 },
      },
      screenshot: { status: "captured" },
      issues: [],
    };
    const sanitized = sanitizeIssueScene(scene, "safe");
    assert.equal(sanitized.target.computedStyle["white-space"], "nowrap");
    assert.equal(
      sanitized.target.computedStyle["will-change"],
      "val-will-change"
    );
    assert.equal(
      sanitized.target.computedStyle["background-color"],
      "rgb(255, 255, 255)"
    );
  });

  test("bidirectionally associates Portal overlays (host -> overlay) and triggers (overlay -> host)", () => {
    const doc: any = {
      styleSheets: [],
      body: null,
      activeElement: null,
      getElementById: (id: string) =>
        id === "select-dropdown-99" ? portalRoot : null,
      querySelectorAll: (sel: string) =>
        sel.includes("select-dropdown-99") ? [selectHost] : [],
    };
    const body = makeMockElement({ tagName: "body", doc });
    doc.body = body;
    const app = makeMockElement({
      tagName: "div",
      id: "app",
      parent: body,
      doc,
    });
    const form = makeMockElement({
      tagName: "form",
      classes: ["el-form"],
      parent: app,
      doc,
    });
    const selectHost = makeMockElement({
      tagName: "div",
      classes: ["el-select", "workstation-select"],
      attrs: { "aria-controls": "select-dropdown-99" },
      text: "Category",
      rect: { x: 100, y: 120, width: 200, height: 32 },
      parent: form,
      doc,
    });
    const portalRoot = makeMockElement({
      tagName: "div",
      id: "select-dropdown-99",
      classes: ["el-popper", "el-select-dropdown"],
      attrs: { role: "listbox" },
      rect: { x: 100, y: 156, width: 640, height: 220 },
      styles: { display: "block", position: "absolute", opacity: "1" },
      parent: body,
      doc,
    });
    const optionItem = makeMockElement({
      tagName: "li",
      classes: ["el-select-dropdown__item"],
      text: "Long Overflowing Option",
      parent: portalRoot,
      doc,
    });

    // Host selected -> discovers portal in relatedOverlays
    const hostOverlays = findRelatedPortalOverlays(selectHost);
    assert.equal(hostOverlays.length, 1);
    assert.equal(hostOverlays[0].id, "select-dropdown-99");
    assert.equal(hostOverlays[0].relationReason, "aria-controls");
    assert.equal(hostOverlays[0].boundingBox.width, 640);

    // Portal item selected -> resolves triggerElement
    const { triggerElement } = findTriggerForPortalElement(optionItem, "safe");
    assert.ok(triggerElement);
    assert.equal(triggerElement.tagName, "div");
    assert.ok(triggerElement.classNames.includes("el-select"));
    assert.equal(triggerElement.ancestors[0].tagName, "form");

    // End-to-end into buildIssueSceneDomFilesV5
    const portalSnap = buildDomSnapshot(optionItem, "safe");
    const files = buildIssueSceneDomFilesV5({
      id: "scene-portal",
      sessionId: "sess-1",
      status: "complete",
      observedAtEpochMs: 1,
      page: { url: "https://example.test", title: "Workstation", frameId: 0 },
      target: portalSnap,
      annotation: {
        type: "arrow-box",
        color: "#ef233c",
        point: { xRatio: 0.5, yRatio: 0.5 },
      },
      screenshot: { status: "captured" },
      issues: [],
    });
    const ctxText = new TextDecoder().decode(files[0].data);
    const ctxJson = JSON.parse(ctxText);
    assert.ok(ctxJson.triggerElement);
    assert.ok(ctxJson.triggerElement.classNames.includes("workstation-select"));
  });

  test("extractWinnerCssRules resolves specificity, cascade order, and !important", () => {
    function makeStyleDecl(
      entries: Array<[string, string, boolean]>
    ): Record<string, unknown> {
      const obj: Record<string, unknown> = {
        length: entries.length,
        getPropertyValue: (p: string) =>
          entries.find(([k]) => k === p)?.[1] ?? "",
        getPropertyPriority: (p: string) =>
          entries.find(([k]) => k === p)?.[2] ? "important" : "",
      };
      entries.forEach(([k], i) => {
        obj[i] = k;
      });
      return obj;
    }

    const doc: any = {
      body: null,
      styleSheets: [
        {
          href: "https://cdn.example.test/static/table.css?v=1",
          disabled: false,
          cssRules: [
            {
              selectorText: "td.cell",
              style: makeStyleDecl([
                ["white-space", "normal", false],
                ["color", "#333", false],
              ]),
            },
            {
              selectorText: "#orders-table .el-table__cell.cell",
              style: makeStyleDecl([
                ["white-space", "nowrap", false],
                ["text-overflow", "ellipsis", false],
              ]),
            },
            {
              selectorText: "td",
              style: makeStyleDecl([["display", "table-cell", true]]),
            },
          ],
        },
        {
          href: "https://cross-origin.example.test/secret.css",
          disabled: false,
          get cssRules() {
            throw new Error("SecurityError: Cannot access cross-origin rules");
          },
        },
      ],
    };

    const td = makeMockElement({
      tagName: "td",
      id: "target-cell",
      classes: ["cell", "el-table__cell"],
      doc,
      matchesSelectors: ["td", "td.cell", "#orders-table .el-table__cell.cell"],
      inlineStyle: {
        width: { value: "120px", important: false },
      },
    });

    const winners = extractWinnerCssRules(td);
    assert.equal(winners[0].source, "inline");
    assert.equal(winners[0].properties.width, "120px");

    const tableRule = winners.find(
      (r) => r.selector === "#orders-table .el-table__cell.cell"
    );
    assert.ok(tableRule);
    assert.equal(tableRule.source, "table.css");
    assert.equal(tableRule.properties["white-space"], "nowrap");
    assert.equal(tableRule.properties["text-overflow"], "ellipsis");

    const tdImpRule = winners.find((r) => r.selector === "td");
    assert.equal(tdImpRule?.properties.display, "table-cell !important");
  });
});
