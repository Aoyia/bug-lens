import assert from "node:assert/strict";
import test from "node:test";
import { getLocale } from "../src/shared/i18n.ts";
import { formatSessionDate } from "../src/popup/session-date.ts";

/**
 * Popup 历史列表会话日期格式契约（纯函数，便于单测）。
 *
 * 第一性原理：界面语言一致性——项目已系统化让用户可见信息跟随扩展界面语言
 * （chrome.i18n.getUILanguage → zh-CN/en-US），历史卡片上的日期同样是用户
 * 可见信息，若用无参 toLocaleString() 会跟随宿主系统语言，与界面语言不一致
 * （例如中文界面出现 "11/15/2023, 6:13:20 AM" 英文格式日期）。本模块统一
 * 以 getLocale() 作为默认 locale 格式化日期。
 */

const FIXED_TS = 1_700_000_000_000;

test("session-date: zh-CN 与 en-US 界面语言的日期格式不同", () => {
  const zh = formatSessionDate(FIXED_TS, "zh-CN");
  const en = formatSessionDate(FIXED_TS, "en-US");
  assert.notEqual(zh, en, "不同界面语言应产生不同的日期格式");
});

test("session-date: 中文界面日期不含 AM/PM 12 小时制标记", () => {
  const zh = formatSessionDate(FIXED_TS, "zh-CN");
  assert.ok(!/AM|PM/i.test(zh), `zh-CN 日期应为 24 小时制，实际: ${zh}`);
});

test("session-date: 英文界面日期包含 AM/PM 12 小时制标记", () => {
  const en = formatSessionDate(FIXED_TS, "en-US");
  assert.ok(/AM|PM/i.test(en), `en-US 日期应为 12 小时制，实际: ${en}`);
});

test("session-date: 默认跟随扩展界面语言 getLocale()", () => {
  assert.equal(
    formatSessionDate(FIXED_TS),
    formatSessionDate(FIXED_TS, getLocale()),
    "默认 locale 应与 getLocale() 一致"
  );
});

test("session-date: 非法时间戳回退为 Invalid Date 文本而非抛错", () => {
  const out = formatSessionDate(Number.NaN, "zh-CN");
  assert.equal(typeof out, "string", "非法时间戳应返回字符串而非抛错");
});
