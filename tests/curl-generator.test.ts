import assert from "node:assert/strict";
import { test } from "node:test";
import {
  escapeBashSingleQuote,
  generateCurlCommand,
} from "../src/domain/curl-generator.ts";
import type { NetworkEntry } from "../src/shared/protocol";

test("escapeBashSingleQuote correctly escapes single quotes for bash", () => {
  assert.equal(escapeBashSingleQuote("simple"), "simple");
  assert.equal(escapeBashSingleQuote("it's cool"), "it'\\''s cool");
  assert.equal(escapeBashSingleQuote("foo'bar'baz"), "foo'\\''bar'\\''baz");
});

test("generateCurlCommand formats basic GET request without headers or body", () => {
  const entry: NetworkEntry = {
    id: "test:1",
    sessionId: "test",
    createdAt: 1000,
    url: "https://api.example.com/v1/users?id=123&type=admin",
    method: "GET",
  };

  const curl = generateCurlCommand(entry);
  assert.equal(
    curl,
    "curl 'https://api.example.com/v1/users?id=123&type=admin'"
  );
});

test("generateCurlCommand formats POST request with headers, body, and pseudo-header filtering", () => {
  const entry: NetworkEntry = {
    id: "test:2",
    sessionId: "test",
    createdAt: 1000,
    url: "https://api.example.com/v1/login",
    method: "POST",
    requestHeaders: {
      ":authority": "api.example.com",
      ":method": "POST",
      "Content-Type": "application/json",
      Authorization: "Bearer token123",
      "User-Agent": "Mozilla/5.0 ('Special' OS)",
    },
    requestBody: '{"username":"admin\'s_user","password":"secret"}',
  };

  const curl = generateCurlCommand(entry);
  const expected = [
    "curl -X POST 'https://api.example.com/v1/login'",
    "  -H 'Content-Type: application/json'",
    "  -H 'Authorization: Bearer token123'",
    "  -H 'User-Agent: Mozilla/5.0 ('\\''Special'\\'' OS)'",
    '  --data-raw \'{"username":"admin\'\\\'\'s_user","password":"secret"}\'',
  ].join(" \\\n");

  assert.equal(curl, expected);
});

test("generateCurlCommand handles URL with single quotes and special characters", () => {
  const entry: NetworkEntry = {
    id: "test:3",
    sessionId: "test",
    createdAt: 1000,
    url: "https://api.example.com/search?q=o'reilly",
    method: "GET",
  };

  const curl = generateCurlCommand(entry);
  assert.equal(curl, "curl 'https://api.example.com/search?q=o'\\''reilly'");
});
