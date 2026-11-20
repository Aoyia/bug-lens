function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function normalizeLocalDate(date?: Date): Date {
  if (date instanceof Date && !Number.isNaN(date.getTime())) {
    return date;
  }
  return new Date();
}

/**
 * 按电脑本地时区格式化时间戳，用于导出文件命名。
 * 不使用 toISOString()，避免 UTC 与本地时间产生日期或小时偏差；
 * 不使用冒号，保证 Windows/macOS/Linux 文件系统均合法。
 */
export function formatLocalTimestamp(
  date: Date = new Date(),
  precision: "minute" | "second" = "second"
): string {
  const safeDate = normalizeLocalDate(date);
  const datePart = `${safeDate.getFullYear()}-${pad2(safeDate.getMonth() + 1)}-${pad2(safeDate.getDate())}`;
  const timePart = `${pad2(safeDate.getHours())}-${pad2(safeDate.getMinutes())}`;
  return precision === "minute"
    ? `${datePart}_${timePart}`
    : `${datePart}_${timePart}-${pad2(safeDate.getSeconds())}`;
}

/**
 * 构建录制报告 ZIP 默认文件名：
 * `web-bug-report-<sessionId前8位>-YYYY-MM-DD_HH-MM.zip`。
 */
export function buildSessionReportFilename(
  sessionId: string,
  date: Date = new Date()
): string {
  const shortId = (sessionId || "")
    .slice(0, 8)
    .replace(/[^a-zA-Z0-9._-]/g, "_");
  return `web-bug-report-${shortId}-${formatLocalTimestamp(date, "minute")}.zip`;
}

/**
 * 构建截图证据包 ZIP 默认文件名：
 * `bug-lens-screenshot-YYYY-MM-DD_HH-MM-SS.zip`。
 */
export function buildScreenshotZipFilename(date: Date = new Date()): string {
  return `bug-lens-screenshot-${formatLocalTimestamp(date, "second")}.zip`;
}

/**
 * 解析工单模板展示的附件文件名：优先取已导出路径的文件名，未导出时回退带导出时间戳的默认名。
 */
export function resolveTicketTargetZipName(
  sessionId: string,
  zipPathOrFilename?: string,
  date: Date = new Date()
): string {
  if (zipPathOrFilename) {
    const raw = zipPathOrFilename.trim().replace(/^["']|["']$/g, "");
    const parts = raw.split(/[/\\]/);
    const basename = parts[parts.length - 1];
    if (basename) return basename;
  }
  return buildSessionReportFilename(sessionId, date);
}
