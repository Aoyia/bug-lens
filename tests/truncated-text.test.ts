import assert from "node:assert/strict";
import test from "node:test";
import { TruncatedText } from "../src/shared/components/truncated-text.ts";

test("TruncatedText: renders text and manages tooltip safely without recursion", () => {
  assert.equal(typeof TruncatedText, "function");
  assert.deepEqual(TruncatedText.observedAttributes, [
    "text",
    "title",
    "no-tooltip",
  ]);

  // 模拟自定义元素生命周期测试
  const attrs = new Map<string, string>();
  const span = {
    textContent: "",
    title: "",
    scrollWidth: 100,
    removeAttribute(name: string) {
      if (name === "title") this.title = "";
    },
  };

  const el = Object.create(TruncatedText.prototype);
  (el as any).spanEl = span;
  (el as any).clientWidth = 50; // 容器 50px，span 100px -> 发生溢出
  (el as any).scrollWidth = 100;
  (el as any).getAttribute = (name: string) => attrs.get(name) ?? null;
  (el as any).hasAttribute = (name: string) => attrs.has(name);
  (el as any).toggleAttribute = (name: string, force?: boolean) => {
    if (force === undefined ? !attrs.has(name) : force) {
      attrs.set(name, "");
    } else {
      attrs.delete(name);
    }
  };
  (el as any).setAttribute = (name: string, val: string) => {
    const old = attrs.get(name) ?? null;
    const sVal = String(val);
    if (old === sVal) return;
    attrs.set(name, sVal);
    el.attributeChangedCallback(name, old, sVal);
  };
  (el as any).removeAttribute = (name: string) => {
    const old = attrs.get(name) ?? null;
    if (old === null) return;
    attrs.delete(name);
    el.attributeChangedCallback(name, old, null);
  };

  // 1. 设置 text（发生溢出时设置 data-overflowed 和 tooltip）
  (el as any).setAttribute("text", "超长文本发生了截断省略");
  assert.equal(span.textContent, "超长文本发生了截断省略");
  assert.equal(el.checkOverflow(), true);
  assert.equal((el as any).hasAttribute("data-overflowed"), true);
  assert.equal(span.title, "超长文本发生了截断省略");

  // 2. 自定义 title
  (el as any).setAttribute("title", "自定义提示");
  assert.equal(span.title, "自定义提示");

  // 3. no-tooltip 模式清除 tooltip 与 host 的 title
  (el as any).setAttribute("no-tooltip", "");
  assert.equal(span.title, "");
  assert.equal((el as any).hasAttribute("title"), false);

  // 4. 未发生溢出时的测试（短文本）
  (el as any).removeAttribute("no-tooltip");
  span.scrollWidth = 30;
  (el as any).clientWidth = 100; // 容器 100px，文本 30px -> 未发生溢出
  (el as any).scrollWidth = 30;
  el.updateOverflowState();
  assert.equal(el.checkOverflow(), false);
  assert.equal((el as any).hasAttribute("data-overflowed"), false);
  assert.equal(span.title, ""); // 未溢出时不展示 tooltip

  // 5. textContent 赋值不被空 text 属性抹除
  (el as any).removeAttribute("text");
  el.textContent = "通过 textContent 直接写入的文本";
  assert.equal(el.textContent, "通过 textContent 直接写入的文本");
  assert.equal(span.textContent, "通过 textContent 直接写入的文本");

  // 6. text 属性存在时，通过 textContent 赋值正确同步属性，且不被 render 抹除
  (el as any).setAttribute("text", "初始属性文本");
  assert.equal(el.textContent, "初始属性文本");
  el.textContent = "后续覆盖写入的文本";
  assert.equal(el.textContent, "后续覆盖写入的文本");
  assert.equal(span.textContent, "后续覆盖写入的文本");
  assert.equal((el as any).getAttribute("text"), "后续覆盖写入的文本");

  // 7. innerText 与 textContent 表现一致
  el.innerText = "通过 innerText 写入的文本";
  assert.equal(el.innerText, "通过 innerText 写入的文本");
  assert.equal(el.textContent, "通过 innerText 写入的文本");
  assert.equal(span.textContent, "通过 innerText 写入的文本");
});
