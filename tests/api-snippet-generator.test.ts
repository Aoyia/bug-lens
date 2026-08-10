import test from "node:test";
import assert from "node:assert";
import {
  generateApiSnippet,
  API_SNIPPET_TARGETS,
} from "../src/domain/api-snippet-generator.ts";
import type { NetworkEntry } from "../src/shared/protocol.ts";

const mockEntry: NetworkEntry = {
  id: "req-101",
  url: "https://api.example.com/v1/users?page=1",
  method: "POST",
  status: 200,
  requestHeaders: {
    "Content-Type": "application/json",
    Authorization: "Bearer mock-token-123",
  },
  requestBody: JSON.stringify({ name: "Alice", role: "admin" }),
  timestamp: 1600000000000,
};

test("API Snippet Generator - 支持完整的语言目标定义", () => {
  assert.strictEqual(API_SNIPPET_TARGETS.length >= 5, true);
  const keys = API_SNIPPET_TARGETS.map((t) => t.key);
  assert.deepStrictEqual(keys, ["curl", "fetch", "axios", "python", "postman"]);
});

test("generateApiSnippet - 生成正确的 cURL 指令", () => {
  const curl = generateApiSnippet(mockEntry, "curl");
  assert.match(curl, /curl -X POST/);
  assert.match(curl, /'https:\/\/api\.example\.com\/v1\/users\?page=1'/);
  assert.match(curl, /-H 'Content-Type: application\/json'/);
  assert.match(curl, /--data-raw/);
});

test("generateApiSnippet - 生成正确的 JavaScript Fetch API 代码", () => {
  const jsFetch = generateApiSnippet(mockEntry, "fetch");
  assert.match(jsFetch, /await fetch\(/);
  assert.match(jsFetch, /"method": "POST"/);
  assert.match(jsFetch, /"Content-Type": "application\/json"/);
  assert.match(jsFetch, /"name": "Alice"/);
});

test("generateApiSnippet - 生成正确的 JavaScript Axios 代码", () => {
  const axiosCode = generateApiSnippet(mockEntry, "axios");
  assert.match(axiosCode, /import axios from "axios";/);
  assert.match(axiosCode, /"method": "POST"/);
  assert.match(
    axiosCode,
    /"url": "https:\/\/api\.example\.com\/v1\/users\?page=1"/
  );
  assert.match(axiosCode, /"data": {/);
});

test("generateApiSnippet - 生成正确的 Python Requests 代码", () => {
  const pythonCode = generateApiSnippet(mockEntry, "python");
  assert.match(pythonCode, /import requests/);
  assert.match(pythonCode, /requests\.post\(/);
  assert.match(pythonCode, /headers=headers/);
  assert.match(pythonCode, /json=payload/);
});

test("generateApiSnippet - 生成符合 Postman v2.1 Schema 的 JSON", () => {
  const postmanJsonStr = generateApiSnippet(mockEntry, "postman");
  const parsed = JSON.parse(postmanJsonStr);
  assert.strictEqual(parsed.info.schema.includes("v2.1.0"), true);
  assert.strictEqual(parsed.item[0].request.method, "POST");
  assert.strictEqual(
    parsed.item[0].request.url.raw,
    "https://api.example.com/v1/users?page=1"
  );
});
