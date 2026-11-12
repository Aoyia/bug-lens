import type {
  ConsoleEntry,
  DiagnosticStackFrame,
  ExpectedStatement,
  InteractionRecord,
  IssueScene,
  RecordingOptions,
  TargetDomSnapshot,
} from "../shared/protocol";
import { normalizeExpected } from "./issue-scene";
import { utf8ByteLength } from "./storage-policy";

export type PrivacyMode = RecordingOptions["privacyMode"];

export type SanitizedResponseBody = {
  bodyStatus: "captured" | "redacted";
  body?: string;
  base64Encoded?: boolean;
  byteLength: number;
  redactionReason?: "binary-body";
  truncated?: boolean;
  originalByteLength?: number;
  capturedByteLength?: number;
};

const SENSITIVE_HEADER_NAMES = new Set([
  "authorization",
  "proxyauthorization",
  "cookie",
  "setcookie",
  "xapikey",
  "apikey",
  "xauthtoken",
  "token",
  "xcsrftoken",
  "xxsrftoken",
  "secret",
  "password",
]);

const URL_HEADER_NAMES = new Set(["location", "referer", "referrer", "origin"]);
export const SENSITIVE_JSON_KEY =
  /(?:password|passwd|passcode|token|authorization|secret|cookie|session|email|phone|address|card|cvv|ssn|dateofbirth|dob|apikey|xapikey|xauthtoken|credential)/i;
const COMPOUND_SENSITIVE_KEY =
  /^(?:api[_-]?key|secret[_-]?key|access[_-]?key|private[_-]?key|app[_-]?key|auth[_-]?token|access[_-]?token|refresh[_-]?token|oauth[_-]?token|oauth[_-]?code|auth[_-]?code|verify[_-]?code|sms[_-]?code|vcode|captcha|id[_-]?card|credit[_-]?card|bank[_-]?card|key|code|ticket|signature|sig|auth)$/i;
const OPAQUE_PATH_SEGMENT =
  /^(?:[0-9a-f]{8}-[0-9a-f-]{27,}|[^@/]+@[^@/]+\.[^@/]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|\d{8,}|[A-Za-z0-9_-]{24,})$/i;

export function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function isSensitiveKeyName(name: string): boolean {
  if (!name) return false;
  const rawLower = name.trim().toLowerCase();
  const normalized = normalizeName(name);
  if (SENSITIVE_JSON_KEY.test(normalized)) return true;
  if (
    COMPOUND_SENSITIVE_KEY.test(rawLower) ||
    COMPOUND_SENSITIVE_KEY.test(normalized)
  )
    return true;
  return false;
}

export function containsSensitiveData(
  value: string | undefined | null
): boolean {
  if (!value) return false;
  const str = String(value);
  if (/-----BEGIN [^-]+-----/.test(str)) return true;
  if (/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(str))
    return true;
  if (/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/i.test(str)) return true;
  if (/\b(?:\d[ -]*?){13,19}\b/.test(str)) return true;
  return false;
}

export function isSensitiveInputElement(element: {
  tagName?: string;
  id?: string;
  attributes?: Record<string, string>;
}): boolean {
  if ((element.tagName || "").toUpperCase() === "INPUT") {
    const type = (element.attributes?.type || "").toLowerCase();
    if (type === "password") return true;
  }
  const attrs = element.attributes || {};
  const namesToCheck = [
    attrs.name,
    element.id,
    attrs.id,
    attrs.autocomplete,
    attrs["aria-label"],
    attrs.placeholder,
  ];
  for (const name of namesToCheck) {
    if (name && isSensitiveKeyName(name)) {
      return true;
    }
  }
  return false;
}

export function sanitizeUrl(value: string, mode: PrivacyMode): string {
  if (mode === "raw" || !value) return value;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      return "[REDACTED:url]";
    const pathname = parsed.pathname
      .split("/")
      .map((segment) => {
        let decoded = segment;
        try {
          decoded = decodeURIComponent(segment);
        } catch {
          /* 保留畸形分段，但仍执行 URL 脱敏 */
        }
        return OPAQUE_PATH_SEGMENT.test(decoded) ? "[ID]" : segment;
      })
      .join("/");

    if (mode === "strict") {
      const queryKeys: string[] = [];
      parsed.searchParams.forEach((_value, key) => {
        if (!queryKeys.includes(key)) queryKeys.push(key);
      });
      const query = queryKeys
        .map((key) => `${encodeURIComponent(key)}=[REDACTED]`)
        .join("&");
      return `${parsed.protocol}//${parsed.host}${pathname}${query ? `?${query}` : ""}`;
    }

    const queryEntries: string[] = [];
    parsed.searchParams.forEach((val, key) => {
      const isKeySensitive = isSensitiveKeyName(key);
      const isValSensitive = containsSensitiveData(val);
      const sanitizedVal =
        isKeySensitive || isValSensitive
          ? "[REDACTED]"
          : encodeURIComponent(val);
      queryEntries.push(`${encodeURIComponent(key)}=${sanitizedVal}`);
    });
    const query = queryEntries.join("&");
    return `${parsed.protocol}//${parsed.host}${pathname}${query ? `?${query}` : ""}`;
  } catch {
    const withoutFragment = value.split("#", 1)[0];
    const withoutCredentials = withoutFragment.replace(
      /^(https?:\/\/)(?:[^/@\s]+@)/i,
      "$1"
    );
    if (mode === "strict") {
      return withoutCredentials
        .replace(/([?&][^=&#\s]+)=([^&#\s]*)/g, "$1=[REDACTED]")
        .slice(0, 2_048);
    }
    return withoutCredentials
      .replace(/([?&][^=&#\s]+)=([^&#\s]*)/g, (_match, prefix, val) => {
        const key = prefix.slice(1);
        if (isSensitiveKeyName(key) || containsSensitiveData(val)) {
          return `${prefix}=[REDACTED]`;
        }
        return `${prefix}=${val}`;
      })
      .slice(0, 2_048);
  }
}

export interface SanitizedTextResult {
  text: string;
  truncated: boolean;
}

export function sanitizeTextWithDetails(
  value: string,
  mode: PrivacyMode,
  maxLength = 8_192,
  sanitizeUrls = true
): SanitizedTextResult {
  if (mode === "raw") return { text: value, truncated: false };
  let result = String(value ?? "");
  let preTruncated = false;
  const safeWindow =
    maxLength < 1_000_000
      ? Math.max(maxLength * 4, maxLength + 32_768)
      : Number.MAX_SAFE_INTEGER;
  if (result.length > safeWindow && !result.includes("-----BEGIN ")) {
    result = result.slice(0, safeWindow);
    preTruncated = true;
  }
  if (sanitizeUrls) {
    result = result.replace(/https?:\/\/[^\s<>"']+/gi, (url) =>
      sanitizeUrl(url, mode)
    );
  }
  result = result
    .replace(
      /-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g,
      "[REDACTED:pem]"
    )
    .replace(/data:[^\s,;]+(?:;[^\s,]*)?,[^\s]+/gi, "[REDACTED:data-url]")
    .replace(
      /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi,
      (match) => `${match.split(/\s/, 1)[0]} [REDACTED]`
    )
    .replace(
      /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
      "[REDACTED:jwt]"
    )
    .replace(
      /\b(password|passwd|passcode|token|access[_-]?token|refresh[_-]?token|secret|api[_-]?key|x[_-]?api[_-]?key|x[_-]?auth[_-]?token|apikey)(\s*[:=]\s*)[^\s,;&]+/gi,
      (_match, key: string, separator: string) => `${key}${separator}[REDACTED]`
    )
    .replace(
      /(["'])(password|passwd|passcode|token|access[_-]?token|refresh[_-]?token|secret|api[_-]?key|x[_-]?api[_-]?key|x[_-]?auth[_-]?token|apikey|authorization|cookie|session|email|phone|address|card|cvv|ssn)(\1\s*:\s*)(["'])(?:\\.|(?!\4).)*\4/gi,
      (
        _match,
        quote: string,
        key: string,
        separator: string,
        valueQuote: string
      ) => `${quote}${key}${separator}${valueQuote}[REDACTED]${valueQuote}`
    )
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, "[REDACTED:card]");
  if (result.includes("@")) {
    result = result.replace(
      /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
      "[REDACTED:email]"
    );
  }
  const truncated = preTruncated || result.length > maxLength;
  if (truncated) result = `${result.slice(0, maxLength)}\n[TRUNCATED]`;
  return { text: result, truncated };
}

export function sanitizeText(
  value: string,
  mode: PrivacyMode,
  maxLength = 8_192,
  sanitizeUrls = true
): string {
  return sanitizeTextWithDetails(value, mode, maxLength, sanitizeUrls).text;
}

export function sanitizeHeaders(
  headers: Record<string, unknown> | undefined,
  mode: PrivacyMode
): Record<string, string> | undefined {
  if (!headers) return undefined;
  return Object.fromEntries(
    Object.entries(headers).map(([key, rawValue]) => {
      const value = String(rawValue);
      if (mode === "raw") return [key, value];
      const normalized = normalizeName(key);
      if (SENSITIVE_HEADER_NAMES.has(normalized))
        return [key, `[REDACTED:${key}]`];
      if (URL_HEADER_NAMES.has(normalized))
        return [key, sanitizeUrl(value, mode)];
      return [key, sanitizeText(value, mode, 4_096)];
    })
  );
}

export function sanitizeResponseBody(input: {
  body: string;
  mimeType?: string;
  resourceType?: string;
  base64Encoded: boolean;
  mode: PrivacyMode;
  maxBytes?: number;
  captureFullResponseBody?: boolean;
}): SanitizedResponseBody {
  const byteLength = input.base64Encoded
    ? Math.max(
        0,
        Math.floor((input.body.length * 3) / 4) -
          (input.body.endsWith("==") ? 2 : input.body.endsWith("=") ? 1 : 0)
      )
    : utf8ByteLength(input.body);
  const isFullCapture = Boolean(input.captureFullResponseBody);
  const resType = (input.resourceType || "").toLowerCase();
  const mime = (input.mimeType || "").toLowerCase();
  const isStaticResource =
    [
      "script",
      "stylesheet",
      "image",
      "media",
      "font",
      "other",
      "manifest",
    ].includes(resType) ||
    mime.includes("javascript") ||
    mime.includes("css") ||
    mime.startsWith("image/") ||
    mime.startsWith("font/") ||
    mime.startsWith("audio/") ||
    mime.startsWith("video/");
  const defaultCap = isStaticResource ? 4 * 1024 : Number.MAX_SAFE_INTEGER;
  const maxBytes = Math.max(
    1 * 1024,
    Math.min(input.maxBytes ?? Number.MAX_SAFE_INTEGER, defaultCap)
  );
  const truncate = (
    value: string,
    knownByteLength?: number
  ): { value: string; truncated: boolean; byteLength: number } => {
    const actualByteLength = knownByteLength ?? utf8ByteLength(value);
    if (isFullCapture || actualByteLength <= maxBytes)
      return { value, truncated: false, byteLength: actualByteLength };
    const bytes = new TextEncoder().encode(value);
    const marker = "\n[TRUNCATED]";
    return {
      value: `${new TextDecoder().decode(bytes.slice(0, Math.max(0, maxBytes - marker.length)))}${marker}`,
      truncated: true,
      byteLength: maxBytes,
    };
  };
  if (input.mode === "raw") {
    if (input.base64Encoded) {
      if (isFullCapture) {
        return {
          bodyStatus: "captured",
          body: input.body,
          base64Encoded: true,
          byteLength,
          originalByteLength: byteLength,
          capturedByteLength: byteLength,
          truncated: false,
        };
      }
      const maxCharacters = Math.max(4, Math.floor((maxBytes * 4) / 3 / 4) * 4);
      const body =
        input.body.length > maxCharacters
          ? input.body.slice(0, maxCharacters)
          : input.body;
      return {
        bodyStatus: "captured",
        body,
        base64Encoded: true,
        byteLength,
        originalByteLength: byteLength,
        capturedByteLength: Math.floor((body.length * 3) / 4),
        truncated: body.length < input.body.length,
      };
    }
    const body = truncate(input.body, byteLength);
    return {
      bodyStatus: "captured",
      body: body.value,
      base64Encoded: false,
      byteLength,
      originalByteLength: byteLength,
      capturedByteLength: body.byteLength,
      truncated: body.truncated,
    };
  }
  if (input.base64Encoded) {
    return {
      bodyStatus: "redacted",
      byteLength,
      originalByteLength: byteLength,
      capturedByteLength: 0,
      redactionReason: "binary-body",
    };
  }

  let body: string;
  let fieldTruncated = false;
  if (input.mimeType?.includes("json") || /^[\s]*[\[{]/.test(input.body)) {
    try {
      const fieldMaxLength = isFullCapture ? Number.MAX_SAFE_INTEGER : 8_192;
      const redactValue = (value: unknown, depth = 0): unknown => {
        if (depth > 30) return "[REDACTED:depth-limit]";
        if (Array.isArray(value))
          return value.map((item) => redactValue(item, depth + 1));
        if (value && typeof value === "object") {
          const result: Record<string, unknown> = {};
          for (const [key, child] of Object.entries(
            value as Record<string, unknown>
          )) {
            if (["__proto__", "prototype", "constructor"].includes(key))
              continue;
            result[key] = isSensitiveKeyName(key)
              ? `[REDACTED:${key}]`
              : redactValue(child, depth + 1);
          }
          return result;
        }
        if (typeof value === "string") {
          const sanitized = sanitizeTextWithDetails(
            value,
            "safe",
            fieldMaxLength
          );
          if (!isFullCapture && sanitized.truncated) {
            fieldTruncated = true;
          }
          return sanitized.text;
        }
        return value;
      };
      body = JSON.stringify(redactValue(JSON.parse(input.body)));
    } catch {
      const maxTextLength = isFullCapture ? Number.MAX_SAFE_INTEGER : maxBytes;
      const sanitized = sanitizeTextWithDetails(
        input.body,
        "safe",
        maxTextLength
      );
      body = sanitized.text;
      if (!isFullCapture && sanitized.truncated) {
        fieldTruncated = true;
      }
    }
  } else {
    const maxTextLength = isFullCapture ? Number.MAX_SAFE_INTEGER : maxBytes;
    const sanitized = sanitizeTextWithDetails(
      input.body,
      "safe",
      maxTextLength
    );
    body = sanitized.text;
    if (!isFullCapture && sanitized.truncated) {
      fieldTruncated = true;
    }
  }
  const captured = truncate(body);
  return {
    bodyStatus: "captured",
    body: captured.value,
    base64Encoded: false,
    byteLength,
    originalByteLength: byteLength,
    capturedByteLength: captured.byteLength,
    truncated: captured.truncated || fieldTruncated,
  };
}

export function sanitizeInteractionRecord(
  record: InteractionRecord,
  mode: PrivacyMode
): InteractionRecord {
  const isPasswordInput =
    (record.element.tagName || "").toUpperCase() === "INPUT" &&
    (record.element.attributes.type === "password" ||
      record.metadata?.inputType === "password");

  if (mode === "raw") {
    if (!isPasswordInput) return record;
    return {
      ...record,
      metadata: record.metadata
        ? {
            ...record.metadata,
            value: undefined,
            valueRedacted:
              record.metadata.value != null ||
              record.metadata.valueRedacted ||
              undefined,
            valueLength:
              record.metadata.valueLength ??
              (record.metadata.value != null
                ? record.metadata.value.length
                : undefined),
          }
        : undefined,
      element: {
        ...record.element,
        attributes: record.element.attributes
          ? {
              ...record.element.attributes,
              ...(record.element.attributes.value != null
                ? { value: "[REDACTED]" }
                : {}),
            }
          : record.element.attributes,
        text: "[REDACTED]",
        accessibleName: "[REDACTED]",
      },
    };
  }

  const isSensitiveElement =
    isPasswordInput || isSensitiveInputElement(record.element);
  const isValSensitive = containsSensitiveData(record.metadata?.value);
  const shouldRedactValue =
    mode === "strict" || isSensitiveElement || isValSensitive;

  const attributes = Object.fromEntries(
    Object.entries(record.element.attributes).map(([key, value]) => {
      const normKey = normalizeName(key);
      let sanitizedValue: string;
      if (normKey === "value") {
        sanitizedValue = shouldRedactValue
          ? "[REDACTED]"
          : sanitizeText(value, mode, 512);
      } else if (isSensitiveKeyName(key) || isSensitiveKeyName(normKey)) {
        sanitizedValue = "[REDACTED]";
      } else if (/^(?:href|src|action|formaction)$/i.test(key)) {
        sanitizedValue = sanitizeUrl(value, mode);
      } else {
        sanitizedValue = sanitizeText(value, mode, 512);
      }
      return [key, sanitizedValue];
    })
  );

  return {
    ...record,
    page: {
      ...record.page,
      url: sanitizeUrl(record.page.url, mode),
      title: sanitizeText(record.page.title, mode, 256),
    },
    metadata: record.metadata
      ? {
          ...record.metadata,
          inputType: record.metadata.inputType
            ? sanitizeText(record.metadata.inputType, mode, 128, false)
            : undefined,
          value: shouldRedactValue
            ? undefined
            : record.metadata.value != null
              ? sanitizeText(record.metadata.value, mode, 2_048)
              : undefined,
          valueRedacted: shouldRedactValue
            ? record.metadata.value != null ||
              record.metadata.valueRedacted ||
              true
            : undefined,
          valueLength:
            record.metadata.valueLength ??
            (record.metadata.value != null
              ? record.metadata.value.length
              : undefined),
          key: shouldRedactValue
            ? record.metadata.isShortcut ||
              record.metadata.metaKey ||
              record.metadata.ctrlKey ||
              record.metadata.altKey
              ? record.metadata.key
                ? sanitizeText(record.metadata.key, mode, 64, false)
                : undefined
              : record.metadata.key?.length === 1
                ? "[REDACTED:key]"
                : record.metadata.key
                  ? sanitizeText(record.metadata.key, mode, 64, false)
                  : undefined
            : record.metadata.key
              ? sanitizeText(record.metadata.key, mode, 64, false)
              : undefined,
          code: record.metadata.code
            ? sanitizeText(record.metadata.code, mode, 64, false)
            : undefined,
          shortcut: record.metadata.shortcut
            ? sanitizeText(record.metadata.shortcut, mode, 64, false)
            : undefined,
          formMethod: record.metadata.formMethod
            ? sanitizeText(record.metadata.formMethod, mode, 16, false)
            : undefined,
          formAction: record.metadata.formAction
            ? sanitizeUrl(record.metadata.formAction, mode)
            : undefined,
          navigationType: record.metadata.navigationType
            ? sanitizeText(record.metadata.navigationType, mode, 64, false)
            : undefined,
          transitionQualifiers: record.metadata.transitionQualifiers
            ?.slice(0, 12)
            .map((value) => sanitizeText(value, mode, 64, false)),
          fromUrl: record.metadata.fromUrl
            ? sanitizeUrl(record.metadata.fromUrl, mode)
            : undefined,
          toUrl: record.metadata.toUrl
            ? sanitizeUrl(record.metadata.toUrl, mode)
            : undefined,
        }
      : undefined,
    element: {
      ...record.element,
      id: record.element.id
        ? sanitizeText(record.element.id, mode, 128)
        : undefined,
      classNames: record.element.classNames.map((value) =>
        sanitizeText(value, mode, 128)
      ),
      attributes,
      text: shouldRedactValue
        ? "[REDACTED]"
        : record.element.text
          ? sanitizeText(record.element.text, mode, 256)
          : undefined,
      accessibleName: shouldRedactValue
        ? "[REDACTED]"
        : record.element.accessibleName
          ? sanitizeText(record.element.accessibleName, mode, 256)
          : undefined,
      locators: record.element.locators.map((locator) => ({
        ...locator,
        expression: shouldRedactValue
          ? locator.expression.replace(/['"][^'"]+['"]/g, "'[REDACTED]'")
          : sanitizeText(locator.expression, mode, 512),
        reasons: locator.reasons.map((reason) =>
          sanitizeText(reason, mode, 256)
        ),
      })),
    },
  };
}

function sanitizeStackTrace(
  stackTrace: DiagnosticStackFrame[] | undefined,
  mode: PrivacyMode
): DiagnosticStackFrame[] | undefined {
  if (!stackTrace) return undefined;
  return stackTrace.slice(0, 50).map((frame) => ({
    functionName: frame.functionName
      ? sanitizeText(frame.functionName, mode, 256, false)
      : undefined,
    url: frame.url ? sanitizeUrl(frame.url, mode) : undefined,
    lineNumber: frame.lineNumber,
    columnNumber: frame.columnNumber,
  }));
}

export function sanitizeDomSnapshot(
  snapshot: TargetDomSnapshot,
  mode: PrivacyMode
): TargetDomSnapshot {
  const sanitizeElement = sanitizeInteractionRecord(
    {
      id: "dom-snapshot",
      sessionId: "dom-snapshot",
      kind: "click",
      status: "confirmed",
      createdAt: snapshot.capturedAtEpochMs,
      page: { url: "", title: "", frameId: 0 },
      input: { pointerType: "unknown", button: 0, isTrusted: false },
      coordinates: {
        clientX: 0,
        clientY: 0,
        pageX: 0,
        pageY: 0,
        scrollX: 0,
        scrollY: 0,
        devicePixelRatio: 1,
        viewport: { width: 1, height: 1 },
      },
      element: snapshot.element,
      screenshot: { status: "disabled" },
    },
    mode
  ).element;
  return {
    ...snapshot,
    element: sanitizeElement,
    sanitizedHtml: snapshot.sanitizedHtml
      ? sanitizeText(snapshot.sanitizedHtml, mode, 32_768, false)
      : undefined,
    ancestors: snapshot.ancestors.slice(0, 5).map((ancestor) => ({
      ...ancestor,
      id: ancestor.id ? sanitizeText(ancestor.id, mode, 128, false) : undefined,
      classNames: ancestor.classNames.map((value) =>
        sanitizeText(value, mode, 128, false)
      ),
      role: ancestor.role
        ? sanitizeText(ancestor.role, mode, 128, false)
        : undefined,
      accessibleName: ancestor.accessibleName
        ? sanitizeText(ancestor.accessibleName, mode, 256)
        : undefined,
    })),
    computedStyle: Object.fromEntries(
      Object.entries(snapshot.computedStyle)
        .slice(0, 20)
        .map(([key, value]) => [key, sanitizeText(value, mode, 512, false)])
    ),
  };
}

/**
 * 脱敏"期望陈述"：先经 normalizeExpected 归一化（兼容旧版 string 形态），
 * 再对 text 与 tags 逐项走 sanitizeText，保留 confidence 语义。
 */
export function sanitizeExpectedStatement(
  expected: string | ExpectedStatement | undefined,
  mode: PrivacyMode
): ExpectedStatement | undefined {
  const normalized = normalizeExpected(expected);
  if (!normalized) return undefined;
  const text = sanitizeText(normalized.text, mode, 8_192).trim();
  if (!text) return undefined;
  const tags = normalized.tags
    ?.map((tag) => sanitizeText(tag, mode, 256).trim())
    .filter((tag) => tag.length > 0)
    .slice(0, 8);
  return {
    text,
    ...(tags && tags.length > 0 ? { tags } : {}),
    confidence: normalized.confidence === "explicit" ? "explicit" : "missing",
  };
}

export function sanitizeIssueScene(
  scene: IssueScene,
  mode: PrivacyMode
): IssueScene {
  return {
    ...scene,
    page: {
      ...scene.page,
      url: sanitizeUrl(scene.page.url, mode),
      title: sanitizeText(scene.page.title, mode, 256),
    },
    target: sanitizeDomSnapshot(scene.target, mode),
    narrative: scene.narrative
      ? {
          actual: sanitizeText(scene.narrative.actual, mode, 8_192),
          expected: sanitizeExpectedStatement(scene.narrative.expected, mode),
          note: scene.narrative.note
            ? sanitizeText(scene.narrative.note, mode, 8_192)
            : undefined,
        }
      : undefined,
    annotation: {
      ...scene.annotation,
      label: scene.annotation.label
        ? sanitizeText(scene.annotation.label, mode, 80)
        : undefined,
    },
    issues: scene.issues.map((item) => ({
      ...item,
      message: sanitizeText(item.message, mode, 2_048),
    })),
  };
}

export function sanitizeConsoleEntry(
  entry: ConsoleEntry,
  mode: PrivacyMode
): ConsoleEntry {
  if (mode === "raw") return entry;
  return {
    ...entry,
    text: sanitizeText(entry.text, mode, 8_192),
    source: entry.source ? sanitizeUrl(entry.source, mode) : undefined,
    url: entry.url ? sanitizeUrl(entry.url, mode) : undefined,
    category: entry.category
      ? sanitizeText(entry.category, mode, 128, false)
      : undefined,
    context: entry.context
      ? sanitizeText(entry.context, mode, 256, false)
      : undefined,
    stackTrace: sanitizeStackTrace(entry.stackTrace, mode),
    args: entry.args?.slice(0, 20).map((argument) => ({
      ...argument,
      type: sanitizeText(argument.type, mode, 64, false),
      subtype: argument.subtype
        ? sanitizeText(argument.subtype, mode, 64, false)
        : undefined,
      description: argument.description
        ? sanitizeText(argument.description, mode, 1_024)
        : undefined,
      valuePreview: argument.valuePreview
        ? sanitizeText(argument.valuePreview, mode, 4_096)
        : undefined,
    })),
  };
}

export const SENSITIVE_STATE_KEY_REGEX =
  /(password|passwd|pwd|token|secret|apikey|api_key|access_key|private_key|auth|authorization|credential|session_id|cookie|creditcard|card_number|cvv|ssn|idcard|id_card|phone|mobile|jwt|bearer|private)/i;

/**
 * 统一组件状态树 / 全局 Store 脱敏与防环深拷贝（React / Vue / SSR 全局状态共用）。
 */
export function redactAndSanitizeState(
  obj: any,
  currentDepth = 0,
  maxDepth = 3,
  visited = new WeakSet<object>(),
  keyPattern: RegExp = SENSITIVE_STATE_KEY_REGEX
): any {
  if (obj === null || obj === undefined) return undefined;
  const type = typeof obj;
  if (type === "number" || type === "boolean" || type === "string") return obj;
  if (type !== "object") return undefined;
  const objectValue = obj as object;
  if (
    (typeof HTMLElement !== "undefined" &&
      objectValue instanceof HTMLElement) ||
    (typeof Node !== "undefined" && objectValue instanceof Node)
  ) {
    return undefined;
  }
  if (visited.has(objectValue)) return "[CIRCULAR]";
  if (currentDepth >= maxDepth) return "[MAX_DEPTH]";
  visited.add(objectValue);

  if (Array.isArray(objectValue)) {
    return objectValue
      .slice(0, 10)
      .map((item) =>
        redactAndSanitizeState(
          item,
          currentDepth + 1,
          maxDepth,
          visited,
          keyPattern
        )
      );
  }

  const result: Record<string, any> = {};
  const keys = Object.keys(objectValue).slice(0, 20);
  for (const key of keys) {
    if (keyPattern.test(key)) {
      result[key] = "[REDACTED:sensitive-store-key]";
    } else {
      try {
        const val = redactAndSanitizeState(
          (objectValue as Record<string, unknown>)[key],
          currentDepth + 1,
          maxDepth,
          visited,
          keyPattern
        );
        if (val !== undefined) result[key] = val;
      } catch {
        result[key] = "[UNSERIALIZABLE]";
      }
    }
  }
  return result;
}
