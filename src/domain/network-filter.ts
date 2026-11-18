const STATIC_RESOURCE_TYPES = new Set([
  "script",
  "stylesheet",
  "image",
  "font",
  "media",
  "manifest",
  "other",
]);

const API_RESOURCE_TYPES = new Set([
  "xhr",
  "fetch",
  "websocket",
  "eventsource",
]);

const STATIC_MIME_PREFIXES = [
  "text/css",
  "application/javascript",
  "text/javascript",
  "application/x-javascript",
  "image/",
  "font/",
  "audio/",
  "video/",
  "application/font",
];

const STATIC_EXT_RE =
  /\.(?:m?js|cjs|css|woff2?|ttf|otf|eot|png|jpe?g|webp|avif|gif|svg|ico|mp[34]|webm|wav|map)$/i;

function extractPathname(rawUrl?: string): string {
  if (!rawUrl) return "";
  try {
    return new URL(rawUrl, "https://localhost").pathname;
  } catch {
    return rawUrl.split(/[?#]/)[0] ?? "";
  }
}

export function isStaticAssetCandidate(input: {
  url?: string;
  type?: string;
  mimeType?: string;
}): boolean {
  const typeLower = (input.type ?? "").toLowerCase();
  if (API_RESOURCE_TYPES.has(typeLower)) {
    return false;
  }
  if (
    typeLower &&
    STATIC_RESOURCE_TYPES.has(typeLower) &&
    typeLower !== "other"
  ) {
    return true;
  }

  const mimeLower = (input.mimeType ?? "").toLowerCase();
  if (
    mimeLower &&
    STATIC_MIME_PREFIXES.some((prefix) => mimeLower.startsWith(prefix))
  ) {
    return true;
  }

  const pathname = extractPathname(input.url);
  if (pathname && STATIC_EXT_RE.test(pathname)) {
    return true;
  }

  return false;
}

/**
 * 判断一条网络请求是否为“成功/缓存命中且响应体为 0B / not-present 的静态资源”。
 * 典型表现：大量 200/304 的 JS/CSS/字体/图标请求，`bodyStatus: "not-present"` 或 `byteLength: 0`。
 * 任何 4xx/5xx/超时/CORS/取消 请求绝不会被判为良性噪音。
 */
export function isBenignStaticNoBodyRequest(input: {
  url?: string;
  type?: string;
  mimeType?: string;
  status?: number;
  byteLength?: number;
  bodyStatus?: string;
  hasBody?: boolean;
  isFailure?: boolean;
}): boolean {
  if (input.isFailure) return false;
  const status = input.status ?? 0;
  if (status <= 0 || status >= 400) return false;
  if (input.hasBody) return false;

  const bytes = input.byteLength ?? 0;
  const bodyStatus = (input.bodyStatus ?? "").toLowerCase();
  const hasEmptyBodySignal =
    bytes === 0 &&
    (bodyStatus === "not-present" || status === 304 || bodyStatus === "");
  if (!hasEmptyBodySignal) return false;

  return isStaticAssetCandidate({
    url: input.url,
    type: input.type,
    mimeType: input.mimeType,
  });
}
