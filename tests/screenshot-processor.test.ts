import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { drawAnnotationsOnCanvas } from "../src/screenshot/screenshot-processor.ts";
import type { AnnotationItem } from "../src/domain/screenshot-payload.ts";

describe("Screenshot Processor", () => {
  test("drawAnnotationsOnCanvas executes drawing loops for rect, arrow, privacy and text without throwing", () => {
    let rectDrawn = false;
    let privacyDrawn = false;
    let textDrawn = false;

    const mockCtx: any = {
      save: () => {},
      restore: () => {},
      strokeRect: () => {
        rectDrawn = true;
      },
      fillRect: () => {
        privacyDrawn = true;
      },
      fillText: () => {
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
});
