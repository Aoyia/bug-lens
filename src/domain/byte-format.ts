/**
 * 人类可读的字节大小格式化（二进制单位，B → KiB → MiB → GiB）。
 *
 * 第一性原理：界面中同一「数据大小」概念必须以同一套单位与格式呈现。
 * 此前网络面板把响应体大小分散成三种不一致的写法——表格列用
 * `(bytes / 1024).toFixed(1) KB`（除以 1024 却标注十进制 "KB"，且不向上
 * 进位，2.5 MiB 显示成 2560.0 KB）、详情头用裸字节 `2621440 B`（不可读）、
 * 小响应显示成误导性的 "0.0 KB"。同一数值在不同位置需要用户自行换算，
 * 增加认知负担。本函数统一为二进制单位，并按 100 阈值切换精度
 * （>= 100 取整、< 100 保留 1 位小数），保证大数不啰嗦、小数不丢精度。
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;

  const kib = bytes / 1024;
  if (kib < 1024) return `${trimBytes(kib)} KiB`;

  const mib = kib / 1024;
  if (mib < 1024) return `${trimBytes(mib)} MiB`;

  return `${trimBytes(mib / 1024)} GiB`;
}

function trimBytes(value: number): string {
  return value >= 100 ? String(Math.round(value)) : value.toFixed(1);
}

/**
 * 格式化网络条目的大小显示文本。
 *
 * 优先级与判定规则：
 * 1. 抓取到的完整响应体大小（byteLength != null && > 0）：
 *    说明该请求正文已入包，直接显示已存储的响应体大小（如 129 B、45.1 KiB）。
 * 2. CDP 线路传输大小（encodedDataLength != null && > 0）：
 *    优先显示真实在线路上传输的编码字节数。
 * 3. 响应头 Content-Length（兼容未抓取正文的静态资源及历史录制包）：
 *    若响应头中有合法的正整数 Content-Length，展示该大小。
 * 4. 缓存命中标识：
 *    - HTTP 304 或 revalidated：展示 "(cache)"。
 *    - 强缓存（memory / disk-cache / fromDiskCache）：展示 "(cache)"。
 * 5. 真实 0 字节：
 *    当且仅当明确记录了 0 字节 payload（如 byteLength === 0 或 encodedDataLength === 0）
 *    且非未抓取状态（如 bodyStatus === "captured"）时显示 "0 B"。
 * 6. 未抓取正文 / 协议无正文（bodyStatus === "not-present" | "unavailable" | "pending"）：
 *    展示 "—"，代表未采集正文，禁止误导性地显示为 "0 B"。
 * 7. 无响应（挂起或网络错误）：
 *    返回 ""。
 */
export function formatNetworkEntrySize(
  entry?: {
    status?: number;
    response?: {
      byteLength?: number;
      encodedDataLength?: number;
      bodyStatus?: string;
      headers?: Record<string, string>;
      fromDiskCache?: boolean;
      cache?: {
        source?: string;
        revalidated?: boolean;
      };
    };
  },
  extraResponseHeaders?: Record<string, string>
): string {
  if (!entry || !entry.response) return "";

  const resp = entry.response;

  // 1. 存在已捕获并保存的响应体体积
  if (typeof resp.byteLength === "number" && resp.byteLength > 0) {
    return formatBytes(resp.byteLength);
  }

  // 2. CDP 记录的真实网络传输编码大小
  if (
    typeof resp.encodedDataLength === "number" &&
    resp.encodedDataLength > 0
  ) {
    return formatBytes(resp.encodedDataLength);
  }

  // 3. 从响应头获取 Content-Length（不区分大小写，兼顾 extraDetail 和 entry.response.headers）
  const headers = extraResponseHeaders || resp.headers || {};
  let contentLength: number | undefined;
  for (const [key, val] of Object.entries(headers)) {
    if (key.toLowerCase() === "content-length") {
      const parsed = parseInt(String(val).trim(), 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        contentLength = parsed;
      }
      break;
    }
  }
  if (contentLength !== undefined) {
    return formatBytes(contentLength);
  }

  // 4. 缓存命中标识
  const status = entry.status ?? 0;
  const is304 = status === 304 || resp.cache?.revalidated === true;
  const isLocalCache =
    resp.fromDiskCache === true ||
    resp.cache?.source === "memory" ||
    resp.cache?.source === "disk-cache";
  if (is304 || isLocalCache) {
    return "(cache)";
  }

  // 5. 明确记录了 0 字节 payload
  if (resp.byteLength === 0 || resp.encodedDataLength === 0) {
    if (
      resp.bodyStatus === "not-present" ||
      resp.bodyStatus === "unavailable" ||
      resp.bodyStatus === "pending"
    ) {
      return "—";
    }
    return "0 B";
  }

  // 6. 未抓取正文 / 协议无正文
  if (
    resp.bodyStatus === "not-present" ||
    resp.bodyStatus === "unavailable" ||
    resp.bodyStatus === "pending"
  ) {
    return "—";
  }

  return "—";
}
