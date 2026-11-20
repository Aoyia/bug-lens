import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  computeScaledCropRect,
  drawAnnotationsOnCanvas,
} from "../src/screenshot/pipeline/screenshot-processor";
import type { AnnotationItem } from "../src/domain/screenshot-payload.ts";

describe("Screenshot Processor", () => {
  test("drawAnnotationsOnCanvas executes drawing loops for rect, arrow, privacy and text without throwing", () => {
    let rectDrawn = false;
    let privacyDrawn = false;
    let textDrawn = false;

    const mockCtx: any = {
      canvas: { width: 800, height: 600 },
      save: () => {},
      restore: () => {},
      clip: () => {},
      strokeRect: () => {
        rectDrawn = true;
      },
      fillRect: () => {
        privacyDrawn = true;
      },
      fillText: () => {
        textDrawn = true;
      },
      strokeText: () => {
        textDrawn = true;
      },
      rect: () => {
        rectDrawn = true;
      },
      roundRect: () => {
        rectDrawn = true;
        privacyDrawn = true;
      },
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      closePath: () => {},
      stroke: () => {
        rectDrawn = true;
      },
      fill: () => {
        privacyDrawn = true;
      },
      measureText: () => ({ width: 50 }),
      font: "",
      textAlign: "",
      textBaseline: "",
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
    };

    const annotations: AnnotationItem[] = [
      {
        id: "1",
        type: "rect",
        bounds: { x: 10, y: 10, width: 100, height: 100 },
      },
      {
        id: "2",
        type: "privacy",
        bounds: { x: 200, y: 200, width: 50, height: 50 },
      },
      {
        id: "3",
        type: "text",
        position: { x: 300, y: 300 },
        text: "Issue Here",
      },
    ];

    drawAnnotationsOnCanvas(mockCtx, annotations, 2);

    assert.equal(rectDrawn, true);
    assert.equal(privacyDrawn, true);
    assert.equal(textDrawn, true);
  });

  test("computeScaledCropRect uses real bitmap scale (2x) instead of emulated DPR=3 and clamps out-of-bounds crop rects", () => {
    // DevTools 模拟 iPhone: CSS 视口 375x667，window.devicePixelRatio=3，
    // 但宿主 captureVisibleTab 实际返回 2x 位图 (750x1334)
    const normal = computeScaledCropRect({
      cropBounds: { x: 20, y: 40, width: 150, height: 200 },
      imgWidth: 750,
      imgHeight: 1334,
      viewportWidth: 375,
      viewportHeight: 667,
      fallbackDpr: 3,
    });
    assert.equal(normal.scaleX, 2);
    assert.equal(normal.scaleY, 2);
    assert.equal(normal.sx, 40);
    assert.equal(normal.sy, 80);
    assert.equal(normal.sWidth, 300);
    assert.equal(normal.sHeight, 400);
    assert.equal(normal.destWidth, 300);
    assert.equal(normal.destHeight, 400);

    // 越界裁剪（左上负坐标 + 右下超出视口）应严格钳制在 [0, imgWidth] x [0, imgHeight] 内
    const partiallyOut = computeScaledCropRect({
      cropBounds: { x: -10, y: 600, width: 500, height: 200 },
      imgWidth: 750,
      imgHeight: 1334,
      viewportWidth: 375,
      viewportHeight: 667,
      fallbackDpr: 3,
    });
    assert.equal(partiallyOut.sx, 0);
    assert.equal(partiallyOut.sy, 1200);
    assert.equal(partiallyOut.sWidth, 750);
    assert.equal(partiallyOut.sHeight, 134);
    assert.ok(partiallyOut.sx + partiallyOut.sWidth <= 750);
    assert.ok(partiallyOut.sy + partiallyOut.sHeight <= 1334);

    // 完全越界时宽高至少保留 1px，且不超出位图边界
    const completelyOut = computeScaledCropRect({
      cropBounds: { x: 400, y: 700, width: 50, height: 50 },
      imgWidth: 750,
      imgHeight: 1334,
      viewportWidth: 375,
      viewportHeight: 667,
      fallbackDpr: 3,
    });
    assert.equal(completelyOut.sx, 749);
    assert.equal(completelyOut.sy, 1333);
    assert.equal(completelyOut.sWidth, 1);
    assert.equal(completelyOut.sHeight, 1);
    assert.equal(completelyOut.destWidth, 1);
    assert.equal(completelyOut.destHeight, 1);
  });

  test("computeScaledCropRect falls back to fallbackDpr when viewport dimensions are unavailable", () => {
    const fallback = computeScaledCropRect({
      cropBounds: { x: 10, y: 15, width: 100, height: 80 },
      imgWidth: 750,
      imgHeight: 1334,
      viewportWidth: 0,
      viewportHeight: 0,
      fallbackDpr: 3,
    });
    assert.equal(fallback.scaleX, 3);
    assert.equal(fallback.scaleY, 3);
    assert.equal(fallback.sx, 30);
    assert.equal(fallback.sy, 45);
    assert.equal(fallback.sWidth, 300);
    assert.equal(fallback.sHeight, 240);
  });
});
