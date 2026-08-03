import assert from "node:assert/strict";
import test from "node:test";

import {
  sanitizeHeaders,
  sanitizeResponseBody,
  sanitizeText,
  sanitizeUrl,
} from "../src/domain/privacy-policy.ts";

test("safe URLs remove credentials, fragments, identifiers, and query values", () => {
  assert.equal(
    sanitizeUrl(
      "https://alice:secret@example.test/users/550e8400-e29b-41d4-a716-446655440000?token=abc&view=full#profile",
      "safe"
    ),
    "https://example.test/users/[ID]?token=[REDACTED]&view=[REDACTED]"
  );
});

test("raw URLs remain unchanged", () => {
  const value = "https://alice:secret@example.test/path?token=abc#profile";
  assert.equal(sanitizeUrl(value, "raw"), value);
});

test("safe free text removes common credentials and personal identifiers", () => {
  const value =
    "Bearer top.secret-value user@example.test token=my-token card 4111 1111 1111 1111 https://alice:secret@example.test/callback?code=oauth-code";
  const result = sanitizeText(value, "safe");
  assert.doesNotMatch(
    result,
    /top\.secret-value|user@example\.test|my-token|4111|oauth-code|alice:secret/
  );
  assert.match(result, /REDACTED/);
});

test("safe headers redact credential headers and sanitize redirect URLs", () => {
  assert.deepEqual(
    sanitizeHeaders(
      {
        Authorization: "Bearer secret",
        "X-Api-Key": "api-secret",
        Location: "https://example.test/callback?code=oauth-code",
        "Content-Type": "application/json",
      },
      "safe"
    ),
    {
      Authorization: "[REDACTED:Authorization]",
      "X-Api-Key": "[REDACTED:X-Api-Key]",
      Location: "https://example.test/callback?code=[REDACTED]",
      "Content-Type": "application/json",
    }
  );
});

test("safe JSON response bodies redact nested sensitive keys", () => {
  const result = sanitizeResponseBody({
    body: JSON.stringify({
      user: { email: "user@example.test", accessToken: "secret" },
      ok: true,
    }),
    mimeType: "application/json",
    base64Encoded: false,
    mode: "safe",
  });

  assert.equal(result.bodyStatus, "captured");
  assert.deepEqual(JSON.parse(result.body ?? ""), {
    user: { email: "[REDACTED:email]", accessToken: "[REDACTED:accessToken]" },
    ok: true,
  });
});

test("safe mode never stores Base64 response bodies", () => {
  const result = sanitizeResponseBody({
    body: "c2VjcmV0",
    mimeType: "application/octet-stream",
    base64Encoded: true,
    mode: "safe",
  });

  assert.equal(result.bodyStatus, "redacted");
  assert.equal(result.body, undefined);
  assert.equal(result.redactionReason, "binary-body");
});

test("response bodies are truncated with original and retained byte counts", () => {
  const result = sanitizeResponseBody({
    body: "x".repeat(32 * 1024),
    mimeType: "text/plain",
    base64Encoded: false,
    mode: "raw",
    maxBytes: 16 * 1024,
  });
  assert.equal(result.truncated, true);
  assert.equal(result.originalByteLength, 32 * 1024);
  assert.equal(result.capturedByteLength, 16 * 1024);
  assert.match(result.body ?? "", /\[TRUNCATED\]$/);
});

test("static resource bodies are strictly capped at 4KB", () => {
  const result = sanitizeResponseBody({
    body: "console.log('test');\n" + "a".repeat(10 * 1024),
    mimeType: "application/javascript",
    resourceType: "Script",
    base64Encoded: false,
    mode: "safe",
    maxBytes: 256 * 1024,
  });
  assert.equal(result.truncated, true);
  assert.equal(result.capturedByteLength, 4 * 1024);
});

test("safe free text redacts quoted JSON credentials", () => {
  const result = sanitizeText(
    '{"password":"hunter2","access_token":"abc123","ok":true}',
    "safe"
  );
  assert.doesNotMatch(result, /hunter2|abc123/);
  assert.match(result, /REDACTED/);
});

test("malformed URL path encoding cannot bypass query redaction", () => {
  const result = sanitizeUrl(
    "https://alice:secret@example.test/%ZZ?code=oauth-secret#private",
    "safe"
  );
  assert.equal(result, "https://example.test/%ZZ?code=[REDACTED]");
});

test("sanitizeInteractionRecord redacts credentials in element attributes and metadata", () => {
  const record: Parameters<
    typeof import("../src/domain/privacy-policy.ts").sanitizeInteractionRecord
  >[0] = {
    id: "int-1",
    sessionId: "sess-1",
    kind: "click",
    status: "confirmed",
    createdAt: Date.now(),
    page: {
      url: "https://example.test/page?token=secret",
      title: "User Password Title",
      frameId: 0,
    },
    input: { pointerType: "mouse", button: 0, isTrusted: true },
    coordinates: {
      clientX: 10,
      clientY: 20,
      pageX: 10,
      pageY: 20,
      scrollX: 0,
      scrollY: 0,
      devicePixelRatio: 1,
      viewport: { width: 1920, height: 1080 },
    },
    element: {
      tagName: "input",
      id: "user-password",
      classNames: ["btn", "password-class"],
      attributes: {
        href: "https://example.test/auth?code=123",
        value: "secret",
      },
      text: "Submit password",
      accessibleName: "Password Input",
      locators: [
        {
          kind: "css",
          expression: "#user-password",
          score: 1,
          reasons: ["valid id"],
        },
      ],
    },
    metadata: {
      value: "super-secret-password",
      key: "a",
      code: "KeyA",
      fromUrl: "https://example.test/from?key=val",
      toUrl: "https://example.test/to?key=val",
    },
    screenshot: { status: "disabled" },
  };

  const sanitized = import("../src/domain/privacy-policy.ts").then(
    ({ sanitizeInteractionRecord }) => {
      const res = sanitizeInteractionRecord(record, "safe");
      assert.equal(res.page.url, "https://example.test/page?token=[REDACTED]");
      assert.equal(res.metadata?.value, undefined);
      assert.equal(res.metadata?.valueRedacted, true);
      assert.equal(res.metadata?.key, "[REDACTED:key]");
      assert.equal(
        res.element.attributes.href,
        "https://example.test/auth?code=[REDACTED]"
      );

      // 快捷键应当保留 key 字符
      const shortcutRecord = {
        ...record,
        metadata: {
          ...record.metadata,
          key: "r",
          metaKey: true,
          isShortcut: true,
          shortcut: "Cmd+R",
        },
      };
      const resShortcut = sanitizeInteractionRecord(shortcutRecord, "safe");
      assert.equal(resShortcut.metadata?.key, "r");
      assert.equal(resShortcut.metadata?.shortcut, "Cmd+R");
    }
  );
  return sanitized;
});

test("sanitizeConsoleEntry and stackTrace redacts urls and stack traces", async () => {
  const { sanitizeConsoleEntry } =
    await import("../src/domain/privacy-policy.ts");
  const entry: Parameters<typeof sanitizeConsoleEntry>[0] = {
    id: "con-1",
    sessionId: "sess-1",
    timestamp: Date.now(),
    level: "error",
    text: "Uncaught Error: secret at user@example.test",
    source: "https://example.test/app.js?token=secret",
    category: "js",
    context: "window",
    stackTrace: [
      {
        functionName: "doSecretWork",
        url: "https://example.test/worker.js?key=123",
        lineNumber: 10,
        columnNumber: 5,
      },
    ],
    args: [{ type: "string", description: "token=abc12345" }],
  };

  const sanitized = sanitizeConsoleEntry(entry, "safe");
  assert.equal(
    sanitized.source,
    "https://example.test/app.js?token=[REDACTED]"
  );
  assert.equal(
    sanitized.stackTrace?.[0].url,
    "https://example.test/worker.js?key=[REDACTED]"
  );
  assert.match(sanitized.text, /REDACTED/);

  const rawEntry = sanitizeConsoleEntry(entry, "raw");
  assert.equal(rawEntry, entry);
});

test("sanitizeDomSnapshot and sanitizeIssueScene redacts targets and narratives", async () => {
  const { sanitizeDomSnapshot, sanitizeIssueScene } =
    await import("../src/domain/privacy-policy.ts");
  const snapshot: Parameters<typeof sanitizeDomSnapshot>[0] = {
    capturedAtEpochMs: Date.now(),
    element: {
      tagName: "div",
      classNames: ["secret-box"],
      attributes: {},
      locators: [],
    },
    sanitizedHtml: "<div>user@example.test</div>",
    ancestors: [{ tagName: "body", classNames: ["container"] }],
    computedStyle: { color: "red" },
  };

  const sanitizedSnap = sanitizeDomSnapshot(snapshot, "safe");
  assert.match(sanitizedSnap.sanitizedHtml ?? "", /REDACTED/);

  const scene: Parameters<typeof sanitizeIssueScene>[0] = {
    id: "scene-1",
    sessionId: "sess-1",
    status: "complete",
    createdAtEpochMs: Date.now(),
    page: {
      url: "https://example.test/path?secret=1",
      title: "Secret Page",
      frameId: 0,
    },
    target: snapshot,
    screenshot: { cleanAssetId: "clean-1", annotatedAssetId: "annotated-1" },
    annotation: { x: 10, y: 20, width: 30, height: 40, label: "Secret area" },
    narrative: {
      actual: "Got user@example.test error",
      expected: "Normal flow",
      note: "See token=abc",
    },
    issues: [
      {
        code: "ERR",
        message: "Failed user@example.test",
        source: "issue-scene",
        recoverable: true,
        occurredAt: Date.now(),
      },
    ],
  };

  const sanitizedScene = sanitizeIssueScene(scene, "safe");
  assert.equal(
    sanitizedScene.page.url,
    "https://example.test/path?secret=[REDACTED]"
  );
  assert.match(sanitizedScene.narrative?.actual ?? "", /REDACTED/);
});

test("safe mode preserves nested JSON structure while redacting nested.secret", () => {
  const result = sanitizeResponseBody({
    body: JSON.stringify({
      nested: {
        secret: "secret-value",
        keep: "safe-value",
      },
    }),
    mimeType: "application/json",
    base64Encoded: false,
    mode: "safe",
  });

  assert.equal(result.bodyStatus, "captured");
  const parsed = JSON.parse(result.body ?? "{}");
  assert.equal(parsed.nested.secret, "[REDACTED:secret]");
  assert.equal(parsed.nested.keep, "safe-value");
});

test("raw mode preserves JSON response body without redaction", () => {
  const input = {
    nested: {
      secret: "secret-value",
      keep: "safe-value",
    },
  };
  const result = sanitizeResponseBody({
    body: JSON.stringify(input),
    mimeType: "application/json",
    base64Encoded: false,
    mode: "raw",
  });

  assert.equal(result.bodyStatus, "captured");
  assert.deepEqual(JSON.parse(result.body ?? "{}"), input);
});

test("safe mode redacts sensitive headers while raw mode preserves them", () => {
  const headers = {
    Authorization: "Bearer secret-token",
    "X-Api-Key": "my-api-key",
    "Content-Type": "application/json",
  };

  const safeHeaders = sanitizeHeaders(headers, "safe");
  assert.equal(safeHeaders?.["Authorization"], "[REDACTED:Authorization]");
  assert.equal(safeHeaders?.["X-Api-Key"], "[REDACTED:X-Api-Key]");
  assert.equal(safeHeaders?.["Content-Type"], "application/json");

  const rawHeaders = sanitizeHeaders(headers, "raw");
  assert.deepEqual(rawHeaders, headers);
});

test("password interactions never retain plaintext password in safe or raw mode", async () => {
  const { sanitizeInteractionRecord } =
    await import("../src/domain/privacy-policy.ts");
  const baseRecord: Parameters<typeof sanitizeInteractionRecord>[0] = {
    id: "int-pwd-1",
    sessionId: "sess-1",
    kind: "input",
    status: "confirmed",
    createdAt: Date.now(),
    page: { url: "https://example.test/login", title: "Login", frameId: 0 },
    input: { pointerType: "mouse", button: 0, isTrusted: true },
    coordinates: {
      clientX: 10,
      clientY: 20,
      pageX: 10,
      pageY: 20,
      scrollX: 0,
      scrollY: 0,
      devicePixelRatio: 1,
      viewport: { width: 1920, height: 1080 },
    },
    element: {
      tagName: "input",
      id: "password",
      classNames: ["form-control"],
      attributes: { type: "password", name: "password" },
      text: "",
      accessibleName: "Password",
      locators: [],
    },
    metadata: {
      value: "my-secret-password-123",
      inputType: "password",
    },
    screenshot: { status: "disabled" },
  };

  const safeRes = sanitizeInteractionRecord(baseRecord, "safe");
  assert.equal(safeRes.metadata?.value, undefined);
  assert.equal(safeRes.metadata?.valueRedacted, true);
  assert.equal(safeRes.element.text, "[REDACTED]");

  // Test uppercase / lowercase tagName normalization
  const uppercaseRecord = {
    ...baseRecord,
    element: { ...baseRecord.element, tagName: "INPUT" },
  };
  const upperRes = sanitizeInteractionRecord(uppercaseRecord, "safe");
  assert.equal(upperRes.element.text, "[REDACTED]");
  assert.equal(upperRes.metadata?.value, undefined);
});

test("raw mode retains normal input value but omits password plaintext in interaction metadata", async () => {
  const { sanitizeInteractionRecord } =
    await import("../src/domain/privacy-policy.ts");
  const normalInput: Parameters<typeof sanitizeInteractionRecord>[0] = {
    id: "int-email-1",
    sessionId: "sess-1",
    kind: "input",
    status: "confirmed",
    createdAt: Date.now(),
    page: { url: "https://example.test/login", title: "Login", frameId: 0 },
    input: { pointerType: "mouse", button: 0, isTrusted: true },
    coordinates: {
      clientX: 10,
      clientY: 20,
      pageX: 10,
      pageY: 20,
      scrollX: 0,
      scrollY: 0,
      devicePixelRatio: 1,
      viewport: { width: 1920, height: 1080 },
    },
    element: {
      tagName: "input",
      id: "email",
      classNames: [],
      attributes: { type: "email" },
      locators: [],
    },
    metadata: {
      value: "user@example.test",
    },
    screenshot: { status: "disabled" },
  };

  const rawRes = sanitizeInteractionRecord(normalInput, "raw");
  assert.equal(rawRes.metadata?.value, "user@example.test");

  const passwordInput: Parameters<typeof sanitizeInteractionRecord>[0] = {
    id: "int-password-1",
    sessionId: "sess-1",
    kind: "input",
    status: "confirmed",
    createdAt: Date.now(),
    page: { url: "https://example.test/login", title: "Login", frameId: 0 },
    input: { pointerType: "mouse", button: 0, isTrusted: true },
    coordinates: {
      clientX: 10,
      clientY: 20,
      pageX: 10,
      pageY: 20,
      scrollX: 0,
      scrollY: 0,
      devicePixelRatio: 1,
      viewport: { width: 1920, height: 1080 },
    },
    element: {
      tagName: "input",
      id: "password",
      classNames: [],
      attributes: { type: "password", value: "secret-password" },
      text: "secret-password",
      locators: [],
    },
    metadata: {
      value: "secret-password",
      inputType: "password",
    },
    screenshot: { status: "disabled" },
  };

  const rawPasswordRes = sanitizeInteractionRecord(passwordInput, "raw");
  assert.equal(rawPasswordRes.metadata?.value, undefined);
  assert.equal(rawPasswordRes.metadata?.valueRedacted, true);
  assert.equal(rawPasswordRes.element.text, "[REDACTED]");
  assert.equal(rawPasswordRes.element.attributes.value, "[REDACTED]");
});
