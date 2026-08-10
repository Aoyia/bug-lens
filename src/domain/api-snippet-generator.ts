import type { NetworkEntry } from "../shared/protocol.ts";
import {
  escapeBashSingleQuote,
  generateCurlCommand,
} from "./curl-generator.ts";

export type ApiSnippetTarget =
  "curl" | "fetch" | "axios" | "python" | "postman";

export interface ApiSnippetTargetOption {
  key: ApiSnippetTarget;
  label: string;
  language: string;
  icon: string;
}

export const API_SNIPPET_TARGETS: ApiSnippetTargetOption[] = [
  { key: "curl", label: "cURL (Bash)", language: "bash", icon: "📋" },
  {
    key: "fetch",
    label: "JavaScript (Fetch)",
    language: "javascript",
    icon: "⚡",
  },
  {
    key: "axios",
    label: "JavaScript (Axios)",
    language: "javascript",
    icon: "🚀",
  },
  { key: "python", label: "Python (Requests)", language: "python", icon: "🐍" },
  {
    key: "postman",
    label: "Postman (Collection v2.1)",
    language: "json",
    icon: "📮",
  },
];

/**
 * 将过滤后的 HTTP 请求 Headers 转为 Key-Value 对象字典（排除 HTTP/2 伪头）
 */
function cleanHeaders(
  headers?: Record<string, string>
): Record<string, string> {
  const result: Record<string, string> = {};
  if (!headers || typeof headers !== "object") return result;

  for (const [key, value] of Object.entries(headers)) {
    if (!key || key.startsWith(":") || value === undefined || value === null)
      continue;
    result[key] = String(value);
  }
  return result;
}

/**
 * 尝试解析 JSON Payload
 */
function tryParseJson(bodyStr?: string): unknown | null {
  if (!bodyStr || !bodyStr.trim()) return null;
  try {
    return JSON.parse(bodyStr);
  } catch {
    return null;
  }
}

/**
 * 生成 JavaScript Fetch 代码段
 */
export function generateFetchSnippet(entry: NetworkEntry): string {
  const method = (entry.method || "GET").toUpperCase();
  const url = entry.url || "";
  const headers = cleanHeaders(entry.requestHeaders);
  const body = entry.requestBody;

  const options: Record<string, unknown> = {
    method,
  };

  if (Object.keys(headers).length > 0) {
    options.headers = headers;
  }

  const jsonBody = tryParseJson(body);
  if (jsonBody !== null) {
    options.body = "__JSON_BODY_PLACEHOLDER__";
  } else if (body && body.trim()) {
    options.body = body;
  }

  let jsonStr = JSON.stringify(options, null, 2);
  if (jsonBody !== null) {
    const formattedBody = `JSON.stringify(${JSON.stringify(jsonBody, null, 4)})`;
    jsonStr = jsonStr.replace('"__JSON_BODY_PLACEHOLDER__"', formattedBody);
  }

  return `const response = await fetch(${JSON.stringify(url)}, ${jsonStr});
const data = await response.json();
console.log(data);`;
}

/**
 * 生成 JavaScript Axios 代码段
 */
export function generateAxiosSnippet(entry: NetworkEntry): string {
  const method = (entry.method || "GET").toUpperCase();
  const url = entry.url || "";
  const headers = cleanHeaders(entry.requestHeaders);
  const body = entry.requestBody;

  const config: Record<string, unknown> = {
    method,
    url,
  };

  if (Object.keys(headers).length > 0) {
    config.headers = headers;
  }

  const jsonBody = tryParseJson(body);
  if (jsonBody !== null) {
    config.data = jsonBody;
  } else if (body && body.trim()) {
    config.data = body;
  }

  return `import axios from "axios";

const response = await axios(${JSON.stringify(config, null, 2)});
console.log(response.data);`;
}

/**
 * 生成 Python 3 (Requests) 代码段
 */
export function generatePythonRequestsSnippet(entry: NetworkEntry): string {
  const method = (entry.method || "GET").toUpperCase();
  const url = entry.url || "";
  const headers = cleanHeaders(entry.requestHeaders);
  const body = entry.requestBody;

  const lines: string[] = ["import requests", ""];
  lines.push(`url = ${JSON.stringify(url)}`);

  if (Object.keys(headers).length > 0) {
    lines.push(`headers = ${JSON.stringify(headers, null, 4)}`);
  } else {
    lines.push("headers = {}");
  }

  const jsonBody = tryParseJson(body);
  if (jsonBody !== null) {
    lines.push(`payload = ${JSON.stringify(jsonBody, null, 4)}`);
    lines.push(
      `response = requests.${method.toLowerCase()}(url, headers=headers, json=payload)`
    );
  } else if (body && body.trim()) {
    lines.push(`data = ${JSON.stringify(body)}`);
    lines.push(
      `response = requests.${method.toLowerCase()}(url, headers=headers, data=data)`
    );
  } else {
    lines.push(
      `response = requests.${method.toLowerCase()}(url, headers=headers)`
    );
  }

  lines.push("print(response.status_code)");
  lines.push("print(response.text)");

  return lines.join("\n");
}

/**
 * 生成 Postman Collection v2.1 (JSON)
 */
export function generatePostmanCollectionSnippet(entry: NetworkEntry): string {
  const method = (entry.method || "GET").toUpperCase();
  const url = entry.url || "";
  const headers = cleanHeaders(entry.requestHeaders);
  const body = entry.requestBody;

  const headerList = Object.entries(headers).map(([key, value]) => ({
    key,
    value,
    type: "text",
  }));

  const jsonBody = tryParseJson(body);
  let requestBody: Record<string, unknown> | undefined = undefined;

  if (jsonBody !== null) {
    requestBody = {
      mode: "raw",
      raw: JSON.stringify(jsonBody, null, 2),
      options: {
        raw: {
          language: "json",
        },
      },
    };
  } else if (body && body.trim()) {
    requestBody = {
      mode: "raw",
      raw: body,
    };
  }

  const collection = {
    info: {
      name: `BugLens API Request - ${method} ${entry.url || ""}`,
      schema:
        "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    item: [
      {
        name: `${method} ${entry.url || ""}`,
        request: {
          method,
          header: headerList,
          body: requestBody,
          url: {
            raw: url,
          },
        },
      },
    ],
  };

  return JSON.stringify(collection, null, 2);
}

/**
 * 统一多语言 API 代码段生成调度函数
 */
export function generateApiSnippet(
  entry: NetworkEntry,
  target: ApiSnippetTarget
): string {
  switch (target) {
    case "curl":
      return generateCurlCommand(entry);
    case "fetch":
      return generateFetchSnippet(entry);
    case "axios":
      return generateAxiosSnippet(entry);
    case "python":
      return generatePythonRequestsSnippet(entry);
    case "postman":
      return generatePostmanCollectionSnippet(entry);
    default:
      return generateCurlCommand(entry);
  }
}
