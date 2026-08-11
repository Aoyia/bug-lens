import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { h } from "preact";
import render from "preact-render-to-string";
import {
  RecordPanel,
  isRecordableTabUrl,
} from "../src/components/popup/RecordPanel.tsx";

function renderPanel(activeTab?: chrome.tabs.Tab): string {
  return render(
    h(RecordPanel, {
      activeSession: undefined,
      activeTab,
      active: false,
      ready: false,
      timerText: "",
      getStatusText: () => "",
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

/** 提取指定 id 按钮的开始标签（从 id 到第一个 >），便于断言属性。 */
function buttonTag(html: string, id: string): string {
  const start = html.indexOf(`id="${id}"`);
  assert.ok(start >= 0, `button #${id} must be rendered`);
  const end = html.indexOf(">", start);
  return html.slice(start, end);
}

test("isRecordableTabUrl 与 background 采集契约一致（仅 http/https）", () => {
  assert.equal(isRecordableTabUrl("https://example.com"), true);
  assert.equal(isRecordableTabUrl("http://127.0.0.1:8080/"), true);
  assert.equal(isRecordableTabUrl("http://localhost"), true);
  assert.equal(isRecordableTabUrl("chrome://newtab/"), false);
  assert.equal(isRecordableTabUrl("chrome://extensions/"), false);
  assert.equal(isRecordableTabUrl("chrome-extension://abc/popup.html"), false);
  assert.equal(isRecordableTabUrl("file:///Users/a/page.html"), false);
  assert.equal(isRecordableTabUrl("about:blank"), false);
  assert.equal(isRecordableTabUrl("edge://settings"), false);
  assert.equal(isRecordableTabUrl(""), false);
  assert.equal(isRecordableTabUrl(undefined), false);
});

test("http(s) 标签页下开始录制/截图按钮保持可用并保留快捷键提示", () => {
  const html = renderPanel({
    id: 1,
    url: "https://example.com",
  } as chrome.tabs.Tab);
  const start = buttonTag(html, "start");
  const shot = buttonTag(html, "take-screenshot");
  assert.ok(!start.includes("disabled"), "start 按钮不应禁用");
  assert.ok(!shot.includes("disabled"), "截图按钮不应禁用");
  assert.ok(
    !start.includes("captureUnavailableTab"),
    "可用态不应显示不可用提示"
  );
});

test("非 http(s) 标签页（chrome:// 等）下主操作禁用并给出原因提示", () => {
  const html = renderPanel({
    id: 1,
    url: "chrome://newtab/",
  } as chrome.tabs.Tab);
  const start = buttonTag(html, "start");
  const shot = buttonTag(html, "take-screenshot");
  assert.ok(start.includes("disabled"), "start 按钮应禁用");
  assert.ok(shot.includes("disabled"), "截图按钮应禁用");
  assert.ok(
    start.includes("captureUnavailableTab"),
    "start 应带不可用原因提示"
  );
  assert.ok(
    shot.includes("captureUnavailableTab"),
    "截图按钮应带不可用原因提示"
  );
});

test("标签页解析失败（activeTab 未就绪）时主操作同样禁用", () => {
  const html = renderPanel(undefined);
  assert.ok(buttonTag(html, "start").includes("disabled"));
  assert.ok(buttonTag(html, "take-screenshot").includes("disabled"));
});

test("captureUnavailableTab i18n 键在双 locale 中均存在且非空", () => {
  for (const file of ["en", "zh_CN"]) {
    const dict = JSON.parse(
      readFileSync(
        resolve(process.cwd(), `src/_locales/${file}/messages.json`),
        "utf8"
      )
    );
    assert.ok(
      dict.captureUnavailableTab?.message?.trim(),
      `${file} locale must define captureUnavailableTab`
    );
  }
});
