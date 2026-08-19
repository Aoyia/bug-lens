import assert from "node:assert/strict";
import test from "node:test";
import {
  formatDateTime,
  formatTime,
  formatTimeWithMs,
  formatRelativeTime,
  formatNumber,
  formatPercent,
  formatDuration,
  clearIntlCacheForTesting,
} from "../src/shared/intl-formatter.ts";

const FIXED_TS = 1_700_000_000_000; // 2023-11-14T22:13:20.000Z

test("intl-formatter: formatDateTime 支持 zh-CN 与 en-US 区分", () => {
  const zh = formatDateTime(FIXED_TS, undefined, "zh-CN");
  const en = formatDateTime(FIXED_TS, undefined, "en-US");
  assert.notEqual(zh, en, "zh-CN 与 en-US 日期输出应不同");
  assert.ok(!/AM|PM/i.test(zh), "中文日期默认不包含 AM/PM");
  assert.ok(/AM|PM/i.test(en), "英文日期默认包含 AM/PM");
});

test("intl-formatter: formatDateTime 处理无效时间戳不抛异常", () => {
  const result = formatDateTime(Number.NaN, undefined, "zh-CN");
  assert.equal(typeof result, "string");
  assert.ok(result.includes("Invalid"));
});

test("intl-formatter: formatTime 与 formatTimeWithMs 带毫秒输出", () => {
  const time = formatTime(FIXED_TS, { hour12: false }, "zh-CN");
  assert.ok(time.includes(":"), "时间应包含时分秒冒号");

  const timeWithMs = formatTimeWithMs(FIXED_TS + 456, "zh-CN");
  assert.ok(timeWithMs.endsWith(".456"), "应包含 .456 毫秒后缀");
});

test("intl-formatter: formatRelativeTime 相对时间格式化", () => {
  const now = 1_700_000_000_000;

  // 10 秒前
  const zh10s = formatRelativeTime(now - 10_000, now, "zh-CN");
  const en10s = formatRelativeTime(now - 10_000, now, "en-US");
  assert.match(zh10s, /10.*前/);
  assert.match(en10s, /10 seconds ago/);

  // 5 分钟前
  const zh5m = formatRelativeTime(now - 5 * 60_000, now, "zh-CN");
  const en5m = formatRelativeTime(now - 5 * 60_000, now, "en-US");
  assert.match(zh5m, /5.*前/);
  assert.match(en5m, /5 minutes ago/);

  // 2 小时前
  const zh2h = formatRelativeTime(now - 2 * 3600_000, now, "zh-CN");
  const en2h = formatRelativeTime(now - 2 * 3600_000, now, "en-US");
  assert.match(zh2h, /2.*前/);
  assert.match(en2h, /2 hours ago/);

  // 1 天前 / 昨天
  const zh1d = formatRelativeTime(now - 24 * 3600_000, now, "zh-CN");
  const en1d = formatRelativeTime(now - 24 * 3600_000, now, "en-US");
  assert.ok(zh1d.includes("天") || zh1d.includes("昨"));
  assert.ok(en1d.includes("day") || en1d.includes("yesterday"));
});

test("intl-formatter: formatNumber 数字千分位格式化", () => {
  assert.equal(formatNumber(1234567, undefined, "en-US"), "1,234,567");
  assert.equal(formatNumber(1234567, undefined, "zh-CN"), "1,234,567");
  assert.equal(formatNumber(0, undefined, "zh-CN"), "0");
  assert.equal(formatNumber(Number.NaN, undefined, "zh-CN"), "NaN");
});

test("intl-formatter: formatPercent 百分比格式化", () => {
  assert.equal(formatPercent(0.95, undefined, "zh-CN"), "95%");
  assert.equal(formatPercent(0.95, undefined, "en-US"), "95%");
});

test("intl-formatter: formatDuration 持续时间格式化", () => {
  assert.equal(formatDuration(125, "zh-CN"), "125ms");
  assert.equal(formatDuration(3900, "zh-CN"), "3.9s");
  assert.equal(formatDuration(65000, "zh-CN"), "1m 5s");
  assert.equal(formatDuration(-10, "zh-CN"), "0ms");
});

test("intl-formatter: clearIntlCacheForTesting 清空缓存无异常", () => {
  formatDateTime(FIXED_TS);
  formatNumber(100);
  formatRelativeTime(FIXED_TS);
  clearIntlCacheForTesting();
  assert.ok(true);
});
