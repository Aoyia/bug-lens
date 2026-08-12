import assert from "node:assert/strict";
import test from "node:test";
import { h } from "preact";
import render from "preact-render-to-string";
import { RecordPanel } from "../src/components/popup/RecordPanel.tsx";

/**
 * Popup 状态徽标 live region 契约。
 *
 * 第一性原理：role="status"（隐式 aria-live="polite"）只应播报「状态变更」
 * （如「未在录制」→「录制中」），配合 aria-atomic="true" 时区域内任一子节点
 * 变化都会触发整段播报。而录制计时器每秒 tick 一次——把计时器放进 live region
 * 会让屏幕阅读器在录制期间每秒整段播报「录制中 00:01」「录制中 00:02」……，
 * 形成持续听觉洪流，淹没真正的状态变更播报。
 *
 * 契约：
 * - live region 内只允许状态文本（dot 为纯装饰，aria-hidden）；
 * - 计时器必须位于 live region 之外（作为同层视觉兄弟），且不得用
 *   aria-hidden 隐藏——计时信息应保持可被辅助技术按需读取，只是不自动播报；
 * - 外部布局容器 .status-badge 与计时器 DOM 标识（#timer）必须保留，
 *   供样式与既有 e2e 选择器（recording-lifecycle.spec 的 #timer）稳定使用。
 */

/** 渲染带指定计时文本的 RecordPanel（录制中状态，徽标区完整呈现）。 */
function renderPanel(timerText: string): string {
  return render(
    h(RecordPanel, {
      activeSession: undefined,
      activeTab: undefined,
      active: true,
      ready: false,
      timerText,
      getStatusText: () => "REC_STATUS",
      activeEvidence: () => [],
      evidenceLabel: () => "",
      evidenceStateLabel: () => "",
      onStart: () => {},
      onStop: () => {},
      onOpenPreview: () => {},
      onStartNew: () => {},
      onError: () => {},
    })
  );
}

/**
 * 提取 role="status" 实时区域的完整内容（不含其开闭标签本身）。
 * 先回退到该元素的起始标签，再按同名标签做深度配对，鲁棒地找到闭合标签，
 * 从而能准确断言「某子节点是否位于 live region 内」。
 */
function liveRegionContent(html: string): string {
  const attrIndex = html.indexOf('role="status"');
  assert.ok(attrIndex >= 0, "must render a role=status live region");
  const openIndex = html.lastIndexOf("<", attrIndex);
  const tagNameMatch = html.slice(openIndex).match(/^<\s*([a-zA-Z0-9-]+)/);
  assert.ok(tagNameMatch, "live region element must have a tag name");
  const tagName = tagNameMatch[1];
  const contentStart = html.indexOf(">", attrIndex) + 1;
  const openTag = new RegExp(`<${tagName}(\\s|>)`, "g");
  const closeTag = new RegExp(`</${tagName}>`, "g");
  openTag.lastIndex = contentStart;
  closeTag.lastIndex = contentStart;
  // 深度从 1 起算：live region 自身的开标签已越过，首个同名闭合标签即收尾
  let depth = 1;
  let nextOpen = openTag.exec(html)?.index ?? Infinity;
  let nextClose = closeTag.exec(html)?.index ?? Infinity;
  while (nextClose !== Infinity) {
    if (nextClose < nextOpen) {
      depth -= 1;
      if (depth === 0) return html.slice(contentStart, nextClose);
      nextClose = closeTag.exec(html)?.index ?? Infinity;
    } else {
      depth += 1;
      nextOpen = openTag.exec(html)?.index ?? Infinity;
    }
  }
  assert.fail("live region must have a matching closing tag");
}

/** 提取 #timer 元素的开标签与内容（用于断言其可访问性属性）。 */
function timerElement(html: string): string {
  const start = html.indexOf('id="timer"');
  assert.ok(start >= 0, "#timer must be rendered");
  const tagStart = html.lastIndexOf("<", start);
  const end = html.indexOf(">", start);
  return html.slice(tagStart, end + 1);
}

test("record-panel-live-region: 计时器必须位于 role=status 实时区域之外", () => {
  const html = renderPanel("00:42");
  const live = liveRegionContent(html);
  assert.ok(
    !live.includes('id="timer"'),
    "ticking timer must NOT be inside the live region (it re-announces the whole region every second)"
  );
});

test("record-panel-live-region: 实时区域内只含状态文本，装饰圆点为 aria-hidden", () => {
  const html = renderPanel("00:42");
  const live = liveRegionContent(html);
  assert.ok(
    live.includes("REC_STATUS"),
    "live region must announce the recording status text"
  );
  assert.ok(
    live.includes('id="dot"') && live.includes('aria-hidden="true"'),
    "decorative dot must stay inside the live region but be aria-hidden"
  );
});

test("record-panel-live-region: 实时区域保留 polite 播报语义", () => {
  const html = renderPanel("00:42");
  assert.ok(
    html.includes('aria-live="polite"'),
    "live region must keep polite announcement semantics"
  );
});

test("record-panel-live-region: 计时器仍渲染可见，且不得用 aria-hidden 隐藏", () => {
  const html = renderPanel("00:42");
  assert.ok(html.includes("00:42"), "timer text must still be rendered");
  const timer = timerElement(html);
  assert.ok(
    !timer.includes("aria-hidden"),
    "timer must remain readable by assistive tech on demand (only auto-announcement is excluded)"
  );
});

test("record-panel-live-region: 外部徽标容器与计时器 DOM 标识保留，视觉/e2e 选择器不破坏", () => {
  const html = renderPanel("00:42");
  assert.ok(
    html.includes('class="status-badge"') ||
      html.includes('className="status-badge"'),
    "outer .status-badge container must be preserved"
  );
  assert.ok(
    html.includes('id="timer"') && html.includes('id="status"'),
    "#timer / #status ids must be preserved for e2e selectors"
  );
});

test("record-panel-live-region: 无计时文本（未录制）时不渲染计时器", () => {
  const html = renderPanel("");
  assert.ok(
    !html.includes('id="timer"'),
    "timer must be absent when timerText is empty"
  );
});
