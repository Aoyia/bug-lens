import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { probeFrameworkComponents } from "../src/screenshot/framework-probe.ts";

const ATTR = "data-bug-lens-probe-id";

function fakeEl(attrs: Record<string, string> = {}): any {
  const map = new Map(Object.entries(attrs));
  return {
    setAttribute: (name: string, value: string) => void map.set(name, value),
    getAttribute: (name: string) => map.get(name) ?? null,
    removeAttribute: (name: string) => void map.delete(name),
  };
}

describe("probeFrameworkComponents", () => {
  test("标记元素、发送主世界探针消息并合并结果", async () => {
    const el = fakeEl();
    const sent: any[] = [];
    const map = await probeFrameworkComponents([el], async (msg) => {
      sent.push(msg);
      const id = (msg as any).payload.probeIds[0];
      return {
        ok: true,
        results: {
          [id]: {
            componentName: "<ElCard>",
            componentPath: ["<ElCard>", "<App>"],
            framework: "vue",
            version: 2,
          },
        },
      };
    });

    assert.equal(map.get(el)?.componentName, "<ElCard>");
    assert.equal(sent.length, 1);
    assert.equal(sent[0].type, "screenshot/framework-probe");
    assert.equal(el.getAttribute(ATTR), null, "完成后应清理探针标记");
  });

  test("探针失败时静默降级为空 Map 并清理标记", async () => {
    const el = fakeEl();
    const map = await probeFrameworkComponents([el], async () => {
      throw new Error("executeScript denied");
    });
    assert.equal(map.size, 0);
    assert.equal(el.getAttribute(ATTR), null);
  });

  test("空元素列表直接返回空 Map 且不发送消息", async () => {
    let sentCount = 0;
    const map = await probeFrameworkComponents([], async () => {
      sentCount += 1;
      return { ok: true, results: {} };
    });
    assert.equal(map.size, 0);
    assert.equal(sentCount, 0);
  });
});
