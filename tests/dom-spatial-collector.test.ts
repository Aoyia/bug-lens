import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  isRectIntersecting,
  isPointInsideRect,
  findSmallestCommonAncestor,
  detectFrameworkComponentName,
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

  test("findSmallestCommonAncestor returns common ancestor for a set of elements", () => {
    const parent = createMockElement("div");
    const child1 = createMockElement("span", parent);
    const child2 = createMockElement("button", parent);

    const sca = findSmallestCommonAncestor([child1, child2]);
    assert.equal(sca, parent);
  });

  test("detectFrameworkComponentName identifies React and Vue components", () => {
    const element = createMockElement("div");
    element.__reactFiber$test = {
      type: { name: "OrderButton" },
    };

    const compName = detectFrameworkComponentName(element);
    assert.equal(compName, "<OrderButton>");
  });
});
