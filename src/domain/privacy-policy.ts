import type {
  ConsoleEntry,
  DiagnosticStackFrame,
  InteractionRecord,
  IssueScene,
  RecordingOptions,
  TargetDomSnapshot,
} from "../shared/protocol";

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
const SENSITIVE_JSON_KEY =
  /(?:password|passwd|passcode|token|authorization|secret|cookie|session|email|phone|address|card|cvv|ssn|dateofbirth|dob|apikey|xapikey|xauthtoken)/i;
const OPAQUE_PATH_SEGMENT =
  /^(?:[0-9a-f]{8}-[0-9a-f-]{27,}|[^@/]+@[^@/]+\.[^@/]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|\d{8,}|[A-Za-z0-9_-]{24,})$/i;

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
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
          /* preserve malformed segment, but keep URL redaction */
        }
        return OPAQUE_PATH_SEGMENT.test(decoded) ? "[ID]" : segment;
      })
      .join("/");
    const queryKeys: string[] = [];
    parsed.searchParams.forEach((_value, key) => {
      if (!queryKeys.includes(key)) queryKeys.push(key);
    });
    const query = queryKeys
      .map((key) => `${encodeURIComponent(key)}=[REDACTED]`)
      .join("&");
    return `${parsed.protocol}//${parsed.host}${pathname}${query ? `?${query}` : ""}`;
  } catch {
    const withoutFragment = value.split("#", 1)[0];
    const withoutCredentials = withoutFragment.replace(
      /^(https?:\/\/)(?:[^/@\s]+@)/i,
      "$1"
    );
    return withoutCredentials
      .replace(/([?&][^=&#\s]+)=([^&#\s]*)/g, "$1=[REDACTED]")
      .slice(0, 2_048);
  }
}

export function sanitizeText(
  value: string,
  mode: PrivacyMode,
  maxLength = 8_192,
  sanitizeUrls = true
): string {
  if (mode === "raw") return value;
  let result = String(value ?? "");
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
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED:email]")
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, "[REDACTED:card]");
  if (result.length > maxLength)
    result = `${result.slice(0, maxLength)}\n[TRUNCATED]`;
  return result;
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
}): SanitizedResponseBody {
  const byteLength = input.base64Encoded
    ? Math.max(
        0,
        Math.floor((input.body.length * 3) / 4) -
          (input.body.endsWith("==") ? 2 : input.body.endsWith("=") ? 1 : 0)
      )
    : new TextEncoder().encode(input.body).byteLength;
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
    value: string
  ): { value: string; truncated: boolean; byteLength: number } => {
    const bytes = new TextEncoder().encode(value);
    if (bytes.byteLength <= maxBytes)
      return { value, truncated: false, byteLength: bytes.byteLength };
    const marker = "\n[TRUNCATED]";
    return {
      value: `${new TextDecoder().decode(bytes.slice(0, Math.max(0, maxBytes - marker.length)))}${marker}`,
      truncated: true,
      byteLength: maxBytes,
    };
  };
  if (input.mode === "raw") {
    if (input.base64Encoded) {
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
    const body = truncate(input.body);
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
  if (input.mimeType?.includes("json") || /^[\s]*[\[{]/.test(input.body)) {
    try {
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
            result[key] = SENSITIVE_JSON_KEY.test(normalizeName(key))
              ? `[REDACTED:${key}]`
              : redactValue(child, depth + 1);
          }
          return result;
        }
        return typeof value === "string"
          ? sanitizeText(value, "safe", 8_192)
          : value;
      };
      body = JSON.stringify(redactValue(JSON.parse(input.body)));
    } catch {
      body = sanitizeText(input.body, "safe", maxBytes);
    }
  } else {
    body = sanitizeText(input.body, "safe", maxBytes);
  }
  const captured = truncate(body);
  return {
    bodyStatus: "captured",
    body: captured.value,
    base64Encoded: false,
    byteLength,
    originalByteLength: byteLength,
    capturedByteLength: captured.byteLength,
    truncated: captured.truncated,
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
  const attributes = Object.fromEntries(
    Object.entries(record.element.attributes).map(([key, value]) => {
      const normKey = normalizeName(key);
      let sanitizedValue: string;
      if (normKey === "value" || SENSITIVE_JSON_KEY.test(normKey)) {
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
          key:
            record.metadata.isShortcut ||
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
      text: isPasswordInput
        ? "[REDACTED]"
        : record.element.text
          ? sanitizeText(record.element.text, mode, 256)
          : undefined,
      accessibleName: isPasswordInput
        ? "[REDACTED]"
        : record.element.accessibleName
          ? sanitizeText(record.element.accessibleName, mode, 256)
          : undefined,
      locators: record.element.locators.map((locator) => ({
        ...locator,
        expression: isPasswordInput
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
          expected: scene.narrative.expected
            ? sanitizeText(scene.narrative.expected, mode, 8_192)
            : undefined,
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
