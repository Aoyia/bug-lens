import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  isRectIntersecting,
  isPointInsideRect,
  findSmallestCommonAncestor,
  detectFrameworkComponentName,
  detectComponentPath,
  shouldDropComputedStyle,
  coverageRatio,
  buildSelectorPath,
  domDepthRelativeTo,
} from "../src/screenshot/dom-spatial-collector.ts";
import type { RectBounds } from "../src/domain/screenshot-payload.ts";

function createMockElement(tagName: string, parent?: any): any {
  const el: any = {
    tagName: tagName.toUpperCase(),
    parentElement: parent || null,
  };
  return el;
}

describe("DOM Spatial Collector", () => {
  test("isRectIntersecting correctly calculates bounding box overlaps", () => {
    const boxA: RectBounds = { x: 10, y: 10, width: 100, height: 100 };
    const boxB: RectBounds = { x: 50, y: 50, width: 100, height: 100 };
    const boxC: RectBounds = { x: 200, y: 200, width: 50, height: 50 };

    assert.equal(isRectIntersecting(boxA, boxB), true);
    assert.equal(isRectIntersecting(boxA, boxC), false);
  });

  test("isPointInsideRect correctly checks point containment", () => {
    const rect: RectBounds = { x: 100, y: 100, width: 200, height: 150 };
    assert.equal(isPointInsideRect({ x: 150, y: 120 }, rect), true);
    assert.equal(isPointInsideRect({ x: 50, y: 50 }, rect), false);
  });

  test("coverageRatio 计算覆盖面积占比", () => {
    const outer: RectBounds = { x: 0, y: 0, width: 100, height: 100 };
    // 完全覆盖 → 1
    assert.equal(coverageRatio(outer, outer), 1);
    // 覆盖一半
    const half: RectBounds = { x: 50, y: 0, width: 100, height: 100 };
    assert.ok(Math.abs(coverageRatio(half, outer) - 0.5) < 1e-6);
    // 不相交 → 0
    const away: RectBounds = { x: 200, y: 200, width: 10, height: 10 };
    assert.equal(coverageRatio(away, outer), 0);
  });

  test("findSmallestCommonAncestor returns common ancestor for a set of elements", () => {
    const parent = createMockElement("div");
    const child1 = createMockElement("span", parent);
    const child2 = createMockElement("button", parent);

    const sca = findSmallestCommonAncestor([child1, child2]);
    assert.equal(sca, parent);
  });

  test("detectComponentPath 沿 React fiber.return 收集组件链并过滤 HTML 标签", () => {
    const element = createMockElement("div");
    element.__reactFiber$test = {
      type: { name: "OrderButton" },
      return: {
        type: { name: "App" },
        return: {
          type: "div", // HTML 内置标签应被过滤
          return: null,
        },
      },
    };

    assert.deepEqual(detectComponentPath(element), ["<OrderButton>", "<App>"]);
    assert.equal(detectFrameworkComponentName(element), "<OrderButton>");
  });

  test("detectComponentPath 沿 Vue3 parent 链收集组件名", () => {
    const element = createMockElement("div");
    element.__vueParentComponent$ = {
      type: { __name: "UserCard" },
      parent: {
        type: { name: "App" },
        parent: null,
      },
    };

    assert.deepEqual(detectComponentPath(element), ["<UserCard>", "<App>"]);
  });

  test("detectComponentPath Vue 实例属性仅挂在组件根：沿 DOM 向上查找", () => {
    // 子元素自身无 Vue 属性，其父元素是 Vue 组件根
    const componentRoot = createMockElement("div");
    componentRoot.__vueParentComponent$ = {
      type: { __name: "ElFormItem" },
      parent: {
        type: { name: "App" },
        parent: null,
      },
    };
    const child = createMockElement("span", componentRoot);

    assert.deepEqual(detectComponentPath(child), ["<ElFormItem>", "<App>"]);
    assert.equal(detectFrameworkComponentName(child), "<ElFormItem>");
  });

  test("detectComponentPath 无框架上下文时返回 undefined", () => {
    const element = createMockElement("div");
    assert.equal(detectComponentPath(element), undefined);
    assert.equal(detectFrameworkComponentName(element), undefined);
  });

  test("buildSelectorPath 从 SCA 到元素拼接完整路径", () => {
    const sca = createMockElement("div");
    sca.id = "app";
    const mid = createMockElement("form", sca);
    mid.className = "login-form";
    const leaf = createMockElement("button", mid);
    leaf.id = "submit-btn";

    assert.equal(
      buildSelectorPath(leaf, sca),
      "#app > form.login-form > #submit-btn"
    );
  });

  test("buildSelectorPath 超过最近层级上限时用 … 省略", () => {
    const sca = createMockElement("div");
    sca.id = "app";
    let parent: any = sca;
    let leaf: any = sca;
    // 构造 12 层链
    for (let i = 0; i < 12; i++) {
      const node = createMockElement("div", parent);
      parent = node;
      leaf = node;
    }
    const path = buildSelectorPath(leaf, sca);
    assert.ok(path.includes("… > "), `应包含省略标记，实际: ${path}`);
  });

  test("domDepthRelativeTo 计算相对 SCA 的层级距离", () => {
    const sca = createMockElement("div");
    const level1 = createMockElement("div", sca);
    const level2 = createMockElement("div", level1);
    const leaf = createMockElement("button", level2);

    // SCA 自身 → 0
    assert.equal(domDepthRelativeTo(sca, sca), 0);
    // 直接子 → 1
    assert.equal(domDepthRelativeTo(level1, sca), 1);
    // 隔两层 → 2
    assert.equal(domDepthRelativeTo(level2, sca), 2);
    // 隔三层 → 3
    assert.equal(domDepthRelativeTo(leaf, sca), 3);
    // 不在链上 → -1
    const other = createMockElement("div");
    assert.equal(domDepthRelativeTo(other, sca), -1);
  });

  test("shouldDropComputedStyle 过滤浏览器默认值以压缩体积", () => {
    // 默认值/无信息值 → 丢弃
    assert.equal(shouldDropComputedStyle("display", "block"), true);
    assert.equal(shouldDropComputedStyle("display", "inline"), true);
    assert.equal(shouldDropComputedStyle("position", "static"), true);
    assert.equal(shouldDropComputedStyle("opacity", "1"), true);
    assert.equal(shouldDropComputedStyle("visibility", "visible"), true);
    assert.equal(shouldDropComputedStyle("zIndex", "auto"), true);
    assert.equal(shouldDropComputedStyle("overflow", "visible"), true);
    assert.equal(shouldDropComputedStyle("fontWeight", "400"), true);
    assert.equal(
      shouldDropComputedStyle("backgroundColor", "rgba(0, 0, 0, 0)"),
      true
    );
    assert.equal(shouldDropComputedStyle("color", ""), true);

    // 有诊断差异的值 → 保留
    assert.equal(shouldDropComputedStyle("display", "flex"), false);
    assert.equal(shouldDropComputedStyle("color", "rgb(245, 249, 254)"), false);
    assert.equal(shouldDropComputedStyle("fontSize", "16px"), false);
    assert.equal(
      shouldDropComputedStyle("backgroundColor", "rgb(255, 0, 0)"),
      false
    );
  });
});
