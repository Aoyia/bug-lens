import assert from "node:assert/strict";
import test from "node:test";

import {
  sanitizeHeaders,
  sanitizeResponseBody,
  sanitizeText,
  sanitizeUrl
} from "../src/domain/privacy-policy.ts";

test("safe URLs remove credentials, fragments, identifiers, and query values", () => {
  assert.equal(
    sanitizeUrl("https://alice:secret@example.test/users/550e8400-e29b-41d4-a716-446655440000?token=abc&view=full#profile", "safe"),
    "https://example.test/users/[ID]?token=[REDACTED]&view=[REDACTED]"
  );
});

test("raw URLs remain unchanged", () => {
  const value = "https://alice:secret@example.test/path?token=abc#profile";
  assert.equal(sanitizeUrl(value, "raw"), value);
});

test("safe free text removes common credentials and personal identifiers", () => {
  const value = "Bearer top.secret-value user@example.test token=my-token card 4111 1111 1111 1111 https://alice:secret@example.test/callback?code=oauth-code";
  const result = sanitizeText(value, "safe");
  assert.doesNotMatch(result, /top\.secret-value|user@example\.test|my-token|4111|oauth-code|alice:secret/);
  assert.match(result, /REDACTED/);
});

test("safe headers redact credential headers and sanitize redirect URLs", () => {
  assert.deepEqual(sanitizeHeaders({
    Authorization: "Bearer secret",
    "X-Api-Key": "api-secret",
    Location: "https://example.test/callback?code=oauth-code",
    "Content-Type": "application/json"
  }, "safe"), {
    Authorization: "[REDACTED:Authorization]",
    "X-Api-Key": "[REDACTED:X-Api-Key]",
    Location: "https://example.test/callback?code=[REDACTED]",
    "Content-Type": "application/json"
  });
});

test("safe JSON response bodies redact nested sensitive keys", () => {
  const result = sanitizeResponseBody({
    body: JSON.stringify({ user: { email: "user@example.test", accessToken: "secret" }, ok: true }),
    mimeType: "application/json",
    base64Encoded: false,
    mode: "safe"
  });

  assert.equal(result.bodyStatus, "captured");
  assert.deepEqual(JSON.parse(result.body ?? ""), {
    user: { email: "[REDACTED:email]", accessToken: "[REDACTED:accessToken]" },
    ok: true
  });
});

test("safe mode never stores Base64 response bodies", () => {
  const result = sanitizeResponseBody({
    body: "c2VjcmV0",
    mimeType: "application/octet-stream",
    base64Encoded: true,
    mode: "safe"
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
    maxBytes: 16 * 1024
  });
  assert.equal(result.truncated, true);
  assert.equal(result.originalByteLength, 32 * 1024);
  assert.equal(result.capturedByteLength, 16 * 1024);
  assert.match(result.body ?? "", /\[TRUNCATED\]$/);
});

test("safe free text redacts quoted JSON credentials", () => {
  const result = sanitizeText('{"password":"hunter2","access_token":"abc123","ok":true}', "safe");
  assert.doesNotMatch(result, /hunter2|abc123/);
  assert.match(result, /REDACTED/);
});

test("malformed URL path encoding cannot bypass query redaction", () => {
  const result = sanitizeUrl("https://alice:secret@example.test/%ZZ?code=oauth-secret#private", "safe");
  assert.equal(result, "https://example.test/%ZZ?code=[REDACTED]");
});
