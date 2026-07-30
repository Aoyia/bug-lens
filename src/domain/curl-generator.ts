import type { NetworkEntry } from "../shared/protocol";

/**
 * 安全转义字符串，使其嵌入在 Bash 单引号 `'...'` 内可合法解析。
 * Bash 规则：单引号内部无法包含单引号，故需将 `'` 闭合，追加 `\'` 再重新开启单引号 `'`。
 * 即：`'` -> `'\''`
 */
export function escapeBashSingleQuote(str: string): string {
  return str.replace(/'/g, "'\\''");
}

/**
 * 将 NetworkEntry 转化为合规的 cURL 命令行表达式。
 */
export function generateCurlCommand(entry: NetworkEntry): string {
  const method = (entry.method || "GET").toUpperCase();
  const safeUrl = escapeBashSingleQuote(entry.url || "");

  const parts: string[] = [];

  // 1. Method & URL
  if (method === "GET") {
    parts.push(`curl '${safeUrl}'`);
  } else {
    parts.push(`curl -X ${method} '${safeUrl}'`);
  }

  // 2. Request Headers
  if (entry.requestHeaders && typeof entry.requestHeaders === "object") {
    for (const [key, value] of Object.entries(entry.requestHeaders)) {
      // 过滤 Chrome CDP 捕获的 HTTP/2 伪头（以 ':' 开头）
      if (key.startsWith(":")) continue;
      if (value === undefined || value === null) continue;

      const headerName = escapeBashSingleQuote(key);
      const headerVal = escapeBashSingleQuote(String(value));
      parts.push(`  -H '${headerName}: ${headerVal}'`);
    }
  }

  // 3. Request Body / Payload
  if (entry.requestBody && entry.requestBody.trim().length > 0) {
    const safeBody = escapeBashSingleQuote(entry.requestBody);
    parts.push(`  --data-raw '${safeBody}'`);
  }

  return parts.join(" \\\n");
}
