import { getLocale, onLanguagePreferenceChange } from "./i18n.ts";

const dateTimeCache = new Map<string, Intl.DateTimeFormat>();
const numberFormatCache = new Map<string, Intl.NumberFormat>();
const relativeTimeCache = new Map<string, Intl.RelativeTimeFormat>();

// 语言偏好切换时清空格式化器缓存池
onLanguagePreferenceChange(() => {
  dateTimeCache.clear();
  numberFormatCache.clear();
  relativeTimeCache.clear();
});

function getDateTimeFormatter(
  locale: string,
  options?: Intl.DateTimeFormatOptions
): Intl.DateTimeFormat {
  const key = `${locale}:${JSON.stringify(options ?? {})}`;
  let formatter = dateTimeCache.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options);
    dateTimeCache.set(key, formatter);
  }
  return formatter;
}

function getNumberFormatter(
  locale: string,
  options?: Intl.NumberFormatOptions
): Intl.NumberFormat {
  const key = `${locale}:${JSON.stringify(options ?? {})}`;
  let formatter = numberFormatCache.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, options);
    numberFormatCache.set(key, formatter);
  }
  return formatter;
}

function getRelativeTimeFormatter(
  locale: string,
  options?: Intl.RelativeTimeFormatOptions
): Intl.RelativeTimeFormat {
  const key = `${locale}:${JSON.stringify(options ?? {})}`;
  let formatter = relativeTimeCache.get(key);
  if (!formatter) {
    formatter = new Intl.RelativeTimeFormat(
      locale,
      options ?? { numeric: "auto" }
    );
    relativeTimeCache.set(key, formatter);
  }
  return formatter;
}

/**
 * 格式化绝对日期时间（如：2026/8/19 15:11:23 或 8/19/2026, 3:11:23 PM）
 */
export function formatDateTime(
  epochMsOrDate: number | Date,
  options?: Intl.DateTimeFormatOptions,
  locale: string = getLocale()
): string {
  const date =
    typeof epochMsOrDate === "number" ? new Date(epochMsOrDate) : epochMsOrDate;
  if (!date || Number.isNaN(date.getTime())) {
    return String(new Date(Number.NaN));
  }
  try {
    if (!options) {
      return date.toLocaleString(locale);
    }
    return getDateTimeFormatter(locale, options).format(date);
  } catch {
    return date.toLocaleString(locale);
  }
}

/**
 * 格式化时间（如：15:11:23 或 3:11:23 PM）
 */
export function formatTime(
  epochMsOrDate: number | Date,
  options?: Intl.DateTimeFormatOptions,
  locale: string = getLocale()
): string {
  const date =
    typeof epochMsOrDate === "number" ? new Date(epochMsOrDate) : epochMsOrDate;
  if (!date || Number.isNaN(date.getTime())) {
    return String(new Date(Number.NaN));
  }
  try {
    if (!options) {
      return date.toLocaleTimeString(locale);
    }
    const mergedOptions: Intl.DateTimeFormatOptions = {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      ...options,
    };
    return getDateTimeFormatter(locale, mergedOptions).format(date);
  } catch {
    return date.toLocaleTimeString(locale);
  }
}

/**
 * 格式化带毫秒的时间（如：15:11:23.456）
 */
export function formatTimeWithMs(
  epochMsOrDate: number | Date,
  locale: string = getLocale()
): string {
  const date =
    typeof epochMsOrDate === "number" ? new Date(epochMsOrDate) : epochMsOrDate;
  if (!date || Number.isNaN(date.getTime())) {
    return String(new Date(Number.NaN));
  }
  const baseTime = formatTime(date, undefined, locale);
  const ms = String(date.getMilliseconds()).padStart(3, "0");
  return `${baseTime}.${ms}`;
}

/**
 * 格式化相对时间（如：“刚刚”、“5 分钟前”、“昨天”）
 */
export function formatRelativeTime(
  epochMs: number,
  nowEpochMs: number = Date.now(),
  locale: string = getLocale()
): string {
  if (!Number.isFinite(epochMs)) return "";
  const diffSec = Math.round((epochMs - nowEpochMs) / 1000);
  const absSec = Math.abs(diffSec);

  const formatter = getRelativeTimeFormatter(locale, { numeric: "auto" });

  if (absSec < 60) {
    return formatter.format(diffSec, "second");
  }
  const diffMin = Math.round(diffSec / 60);
  const absMin = Math.abs(diffMin);
  if (absMin < 60) {
    return formatter.format(diffMin, "minute");
  }
  const diffHour = Math.round(diffMin / 60);
  const absHour = Math.abs(diffHour);
  if (absHour < 24) {
    return formatter.format(diffHour, "hour");
  }
  const diffDay = Math.round(diffHour / 24);
  const absDay = Math.abs(diffDay);
  if (absDay < 30) {
    return formatter.format(diffDay, "day");
  }
  const diffMonth = Math.round(diffDay / 30);
  const absMonth = Math.abs(diffMonth);
  if (absMonth < 12) {
    return formatter.format(diffMonth, "month");
  }
  const diffYear = Math.round(diffDay / 365);
  return formatter.format(diffYear, "year");
}

/**
 * 格式化数字千分位（如：1234567 -> "1,234,567"）
 */
export function formatNumber(
  value: number,
  options?: Intl.NumberFormatOptions,
  locale: string = getLocale()
): string {
  if (!Number.isFinite(value)) return String(value);
  try {
    return getNumberFormatter(locale, options).format(value);
  } catch {
    return String(value);
  }
}

/**
 * 格式化百分比（如：0.95 -> "95%"）
 */
export function formatPercent(
  value: number,
  options?: Intl.NumberFormatOptions,
  locale: string = getLocale()
): string {
  return formatNumber(value, { style: "percent", ...options }, locale);
}

/**
 * 格式化耗时（如：125ms 或 3.9s）
 */
export function formatDuration(
  durationMs: number,
  locale: string = getLocale()
): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) return "0ms";
  if (durationMs < 1000) {
    return `${Math.round(durationMs)}ms`;
  }
  const seconds = durationMs / 1000;
  if (seconds < 60) {
    const formattedSec = formatNumber(
      seconds,
      {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      },
      locale
    );
    return `${formattedSec}s`;
  }
  const mins = Math.floor(seconds / 60);
  const remSec = Math.round(seconds % 60);
  return `${mins}m ${remSec}s`;
}

/**
 * 测试/重置缓存接口
 */
export function clearIntlCacheForTesting(): void {
  dateTimeCache.clear();
  numberFormatCache.clear();
  relativeTimeCache.clear();
}
