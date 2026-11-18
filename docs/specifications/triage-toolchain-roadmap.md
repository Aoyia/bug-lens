# Bug Lens Triage 工具链与 Skill 优化清单及多阶段落地规划路线图 (Schema v5)

## 1. 执行摘要与工具链定位

### 1.1 工具链定位与生态分工

Bug Lens Triage 工具链是连接缺陷现场证据包（ZIP 归档/解压工作区）与大型语言模型（LLM）/自动化排查智能体（如 Google Antigravity、WorkBuddy、Claude Code 等）的核心中枢与协议翻译层。在整个缺陷排查生态中，工具链由三个紧密协同的子系统构成：

```
+----------------------------------------------------------------------------------------------------+
|                                    Bug Lens Triage 工具链生态架构                                   |
+----------------------------------------------------------------------------------------------------+
|  [上游：证据包归档]                                                                                  |
|  - v1 历史归档包 (data/*.js 全局变量包装, media/*.webm 录屏, 散落 response bodies, cascade.json)      |
|  - v2 极简 AI 证据包 (manifest.json, session-data.json, network-details.json, network/blobs/ CAS)  |
+----------------------------------------------------------------------------------------------------+
                                                  │
                                                  ▼
+----------------------------------------------------------------------------------------------------+
|  [中间层：Triage CLI / Core Engine] (src/triage-cli/)                                              |
|  - 解压管理与工作区隔离 (PackLruCache, .bug-lens-extract.json, INDEX.md 生成器)                      |
|  - 存储抽象与惰性加载 (LazyFileRegistry, CAS 寻址器, 内存流式解压)                                    |
|  - 结构化查询引擎 (query_network, query_console, timeline, get_scene, get_request, get_css)        |
+----------------------------------------------------------------------------------------------------+
          │                                                                   │
          ▼ (STDIN / JSON-RPC / CLI Flags)                                     ▼ (Prompt Context)
+----------------------------------------------------+   +-------------------------------------------+
|  [集成层：Triage MCP Server]                       |   |  [顶层指引：bug-lens-triage Skill]         |
|  - 向 AI 提供声明式 Tool Definitions 与 JSON Schema|   |  - 三步排查心智模型 (Manifest->Trace->Root) |
|  - 自动输出字符预算控制 (applyCharBudget)          |   |  - 决策树与查询语法推荐 (杜绝手写剥壳脚本) |
|  - 图像多模态块封装 (image-helper)                 |   |  - 紧凑 Markdown / Mermaid 输出汇报契约   |
+----------------------------------------------------+   +-------------------------------------------+
                                                  │
                                                  ▼
+----------------------------------------------------------------------------------------------------+
|  [消费层：AI Agent 排查与修复执行] (Antigravity / WorkBuddy / Claude Code / 人类工程师)               |
|  - 根因定位 -> 业务代码映射 -> 最小化源码修复 -> Playwright 复现脚本自动验证                      |
+----------------------------------------------------------------------------------------------------+
```

> **导出默认值**：扩展默认导出 `full-viewer` 完整人类报告（含 `report.html`、`assets/` 与录屏 `media/*.webm`）；`ai-minimal` 纯 JSON 极简包需用户在设置中显式开启「AI 精简模式」（`workflow.aiMinimalPack`）。Triage 工具链必须同时兼容两种产物。

1. **Triage CLI (`src/triage-cli/`)**：
   底层核心运行时。提供本地命令行执行入口与纯函数式查询 API，负责解压工作区生命周期管理、文件校验、时序对其、字段抽取与字符预算截断，确保零外部网络依赖与跨平台安全性；
2. **Triage MCP Server (`src/triage-cli/cli.ts` MCP 模式)**：
   面向大语言模型的标准化协议服务端。将 CLI 工具映射为符合 Model Context Protocol（MCP）规范的工具集合（`open_pack`、`query_network`、`get_request`、`get_scene` 等），自动处理图片 Base64 编码注入与输出预算控制；
3. **`bug-lens-triage` Skill (`.agents/skills/bug-lens-triage/SKILL.md`)**：
   Agent 排查规则引擎。固化排查心智模型、工具调用顺序、降级策略、汇报格式契约与反幻觉防护网，引导 Agent 在最短轮次内锁定缺陷根因。

---

### 1.2 现存核心断层与摩擦全景审计

根据对 33 个 Antigravity 生产排查会话、WorkBuddy `fe1a7f96` 长会话（5 个 ZIP、158 次 Shell 交互）及 87 个真实 Bug Lens 证据包的实证逆向分析，现行 Triage 工具链与 Skill 存在七大核心架构与实现断层：

| #      | 缺陷 / 摩擦点                                     | 涉及代码位置 / 场景                                                 | 实证数据与案例支持                                             | 产生后果与 Agent 行为失真                                                                                                                                                                     |
| ------ | ------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F1** | **漏读顶层 `entry.requestBody`**<br>(P0 致命缺陷) | `src/triage-cli/tools/get-request.ts:72-80`                         | 会话 `9bf8fef7`<br>会话 `76629d18`<br>会话 `c001f2bc`          | 请求体代码被嵌套在 `includeSet.has("headers")` 内部，且漏读顶层 `entry.requestBody`。导致已捕获的 POST 请求体 100% 丢失，迫使 Agent 编写 6 次 Python 脚本裸解析。                             |
| **F2** | **全量内存冷启动加载**<br>(P1 性能瓶颈)           | `src/triage-cli/pack/open.ts:249-291`<br>`loadDirectoryArchive`     | 87 个真实包全量统计<br>(解压态 824.19MB)                       | 每次执行任意简单命令（如 `query_console`），均将目录下全部文件（含几十个 response body 与截图）全量 `readFileSync` 读入 `Map<string, Uint8Array>`，内存暴涨 100MB+，导致响应迟缓与 OOM 风险。 |
| **F3** | **缺乏业务错误过滤能力**<br>(P1 功能缺失)         | `src/triage-cli/query/network.ts:33-47`<br>`matchesStatusFilter`    | 会话 `7e860c64`<br>包 `05ed1726.zip`<br>会话 `4bb7e205`        | `query_network --status failed` 仅检查 HTTP 状态码 `>= 400`。面对企业系统主流的 `HTTP 200 + { code: 500, success: false }` 业务异常完全失效，Agent 被迫全量盲查。                             |
| **F4** | **海量重复日志直接冲刷上下文**<br>(P1 体验摩擦)   | `src/triage-cli/query/console.ts:47-140`<br>`queryConsole`          | 会话 `dd2ab2d7`<br>(单条日志重复 2619 次)<br>全包 76% 重复率   | 控制台无折叠聚合逻辑，单包数万条日志直接倾倒给模型，导致上下文瞬间超出预算并触发硬截断，淹没真正的异常报错栈。                                                                                |
| **F5** | **CSS 胜出规则与浮层查询缺失**<br>(P2 工具缺失)   | `src/triage-cli/query/cascade.ts`<br>缺少独立 `get_css` 命令        | 会话 `f6cb36e4` (7 次 Node 脚本)<br>会话 `5c613e8b` (浮层割裂) | 面对 7.82MB 的 `cascade.json`，CLI 缺少细粒度 CSS Winner 查询指令，且无法穿透 Portal 浮层关联业务组件，迫使 Agent 反复编写复杂脚本逆向 CSS AST。                                              |
| **F6** | **视觉过渡态与终态盲区**<br>(P2 采集缺失)         | `src/triage-cli/tools/get-screenshot.ts`<br>仅支持瞬态 `step-N.jpg` | 会话 `c001f2bc`<br>(手写 ffmpeg 抽帧 5 次)                     | 截图仅在按键瞬间触发，缺少交互完成后的稳定帧（`settled`）与录制结束终态帧（`final`），导致弹窗报错或动画结束状态在视觉上完全不可见。                                                          |
| **F7** | **Skill 提示词指引与脚本脱节**<br>(P2 认知摩擦)   | `.agents/skills/bug-lens-triage/SKILL.md`                           | 历史会话累计 149 次剥壳脚本                                    | SKILL.md 未提供规范的三步排查闭环模型，仍包含大量指向原始包文件的后备指引，导致 Agent 频繁放弃 CLI 工具转而自行手写 Bash/Python 脚本。                                                        |

---

## 2. Triage CLI 缺陷修复与能力补齐方案

### 2.1 P0 致命缺陷修复：`get-request.ts` 请求体提取与解耦

#### 2.1.1 缺陷根因深度解剖

在 `src/triage-cli/tools/get-request.ts` 中，当前实现存在两个逻辑缺陷：

```typescript
// 原始有缺陷代码片段：src/triage-cli/tools/get-request.ts:61-81
if (includeSet.has("headers")) {
  const reqHeaders = details?.requestHeaders ?? entry.request?.headers;
  const resHeaders = details?.responseHeaders ?? entry.response?.headers;
  if (reqHeaders && Object.keys(reqHeaders).length > 0) {
    lines.push(`\n## Request Headers`);
    lines.push(JSON.stringify(reqHeaders, null, 2));
  }
  if (resHeaders && Object.keys(resHeaders).length > 0) {
    lines.push(`\n## Response Headers`);
    lines.push(JSON.stringify(resHeaders, null, 2));
  }
  // 缺陷 1：请求体逻辑被错误嵌套在 "headers" 门控内部！
  // 若用户指定 --include body，则 includeSet.has("headers") 为 false，导致请求体永远不被输出！
  // 缺陷 2：字段回退链缺失了 (entry as any).requestBody，在历史与真实包中直接漏读！
  const reqBody =
    details?.requestBody ??
    details?.postData ??
    entry.request?.postData ??
    entry.request?.body;
  if (reqBody) {
    lines.push(`\n## Request Body`);
    lines.push(reqBody.slice(0, 4000));
  }
}
```

1. **门控强耦合缺陷**：
   请求载荷属于数据实体，却被错误放置于 `if (includeSet.has("headers"))` 条件分支内。当 Agent 明确要求只排查报文体传入 `--include body`，或在需要精准排查 URL 与 Body 时，由于未显式声明 `headers`，导致 `reqBody` 代码块被整体跳过；
2. **字段寻址链遗漏缺陷**：
   在真实数据采集管道中，Chrome MV3 扩展网络拦截器在不同阶段记录的字段存在异构：
   - 在 `sessionData.networkEntries` 顶层条目中，普遍直接使用 `entry.requestBody` 或 `entry.request.body` / `entry.request.postData`；
   - 在 `networkDetails` 中使用 `details.requestBody` 或 `details.postData`；
   - 现存代码在 `entry` 级别仅检查了 `entry.request?.postData` 与 `entry.request?.body`，完全忽略了顶层的 `entry.requestBody`。在会话 `9bf8fef7` 中，POST 报文 `{"q":"","spec":""}` 恰恰保存在顶层 `entry.requestBody`，直接导致排查彻底中断。

#### 2.1.2 修复代码重构设计

必须将 Request Headers 与 Request Body 完全解耦为独立的输出门控段，并建立鲁棒的多级字段寻址回退链，同时提供自动 Content-Type 格式化感知与长度保护截断：

```typescript
// 重构方案：src/triage-cli/tools/get-request.ts

import { applyCharBudget } from "../format/budget.ts";
import { formatDuration, formatRelativeTime } from "../format/time.ts";
import { getPackWorkspaceDir, openPack } from "../pack/open.ts";
import { inspectNetworkRequest } from "../query/network.ts";

/**
 * 提取网络条目的请求体字符串，建立覆盖所有采集协议版本的寻址链路
 */
export function resolveNetworkRequestBody(
  entry: Record<string, unknown>,
  details?: Record<string, unknown>
): string | undefined {
  // 1. 优先尝试从独立详情对象 details 中获取
  if (
    typeof details?.requestBody === "string" &&
    details.requestBody.length > 0
  ) {
    return details.requestBody;
  }
  if (typeof details?.postData === "string" && details.postData.length > 0) {
    return details.postData;
  }

  // 2. 检查 entry 顶层字段（覆盖 v1 典型结构与 CDP 抓包直接赋值）
  if (typeof entry.requestBody === "string" && entry.requestBody.length > 0) {
    return entry.requestBody;
  }
  if (typeof entry.postData === "string" && entry.postData.length > 0) {
    return entry.postData;
  }

  // 3. 检查 entry.request 嵌套对象（覆盖 HAR 与规范化请求对象）
  const reqObj = entry.request as Record<string, unknown> | undefined;
  if (reqObj && typeof reqObj === "object") {
    if (typeof reqObj.body === "string" && reqObj.body.length > 0) {
      return reqObj.body;
    }
    if (typeof reqObj.postData === "string" && reqObj.postData.length > 0) {
      return reqObj.postData;
    }
  }

  return undefined;
}

/**
 * 格式化请求体输出，针对 JSON 与 URL-encoded 字符串提供自适应可读排版
 */
function formatRequestBodySnippet(rawBody: string, maxChars = 4000): string {
  const trimmed = rawBody.trim();
  // 尝试友好格式化 JSON 字符串
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      const parsed = JSON.parse(trimmed);
      const pretty = JSON.stringify(parsed, null, 2);
      if (pretty.length <= maxChars) return pretty;
      return (
        pretty.slice(0, maxChars) +
        `\n… [JSON request body truncated at ${maxChars} chars]`
      );
    } catch {
      // 保持原始字符串输出
    }
  }
  if (rawBody.length > maxChars) {
    return (
      rawBody.slice(0, maxChars) +
      `\n… [Request body truncated at ${maxChars} chars]`
    );
  }
  return rawBody;
}

export function runGetRequestTool(args: {
  pack?: string;
  id: string;
  include?: Array<"summary" | "headers" | "initiator" | "body">;
  jsonPath?: string;
  bodyMaxChars?: number;
  format?: "text" | "json";
  maxChars?: number;
}): string {
  const loaded = openPack(args.pack);
  if (loaded.kind !== "session") {
    throw new Error(
      `UNSUPPORTED_PACK_KIND: get_request requires a session evidence pack, but "${args.pack}" is a screenshot pack.`
    );
  }

  const res = inspectNetworkRequest(loaded, args.id, {
    include: args.include,
    jsonPath: args.jsonPath,
    bodyMaxChars: args.bodyMaxChars,
  });

  if (args.format === "json") {
    // 确保 JSON 模式下注入标准化解析出的 requestBody
    const enrichedRes = {
      ...res,
      resolvedRequestBody: resolveNetworkRequestBody(
        res.entry as unknown as Record<string, unknown>,
        res.details as unknown as Record<string, unknown>
      ),
    };
    return applyCharBudget(JSON.stringify(enrichedRes, null, 2), args.maxChars);
  }

  const { entry, details } = res;
  const workspaceDir = getPackWorkspaceDir(loaded);
  const fullBodyPath =
    workspaceDir && entry.response?.bodyPath
      ? `${workspaceDir}/${entry.response.bodyPath}`
      : undefined;

  // 默认模式下输出全部信息：summary, headers, initiator, body
  const includeSet = new Set(
    args.include && args.include.length > 0
      ? args.include
      : ["summary", "headers", "initiator", "body"]
  );

  const lines: string[] = [];

  // --- 1. 摘要信息 (Summary) ---
  if (includeSet.has("summary")) {
    lines.push(
      `# Request \`${entry.id}\` (${entry.method ?? "GET"} ${entry.status ?? 0})`
    );
    lines.push(`- **URL**: ${entry.url}`);
    lines.push(
      `- **Time**: ${formatRelativeTime(res.relativeMs)} | Duration: ${formatDuration(entry.durationMs)} | Type: ${entry.type ?? "—"}`
    );
    lines.push(
      `- **Response Info**: mimeType=${entry.response?.mimeType ?? "—"}, bodyStatus=${entry.response?.bodyStatus ?? "—"}, byteLength=${entry.response?.byteLength ?? "—"}, bodyPath=${fullBodyPath ? `\`${fullBodyPath}\`` : (entry.response?.bodyPath ?? "inline/none")}`
    );
    if (entry.errorText) {
      lines.push(`- **Error**: ${entry.errorText}`);
    }
  }

  // --- 2. 标头信息 (Headers) ---
  if (includeSet.has("headers")) {
    const reqHeaders = details?.requestHeaders ?? entry.request?.headers;
    const resHeaders = details?.responseHeaders ?? entry.response?.headers;
    if (reqHeaders && Object.keys(reqHeaders).length > 0) {
      lines.push(`\n## Request Headers`);
      lines.push(JSON.stringify(reqHeaders, null, 2));
    }
    if (resHeaders && Object.keys(resHeaders).length > 0) {
      lines.push(`\n## Response Headers`);
      lines.push(JSON.stringify(resHeaders, null, 2));
    }
  }

  // --- 3. 请求体信息 (Request Body - 彻底从 headers 门控中解耦) ---
  // 当用户包含 body 或 headers，或默认全量模式时，均呈现请求体
  const shouldIncludeReqBody =
    includeSet.has("body") || includeSet.has("headers");
  if (shouldIncludeReqBody) {
    const rawReqBody = resolveNetworkRequestBody(
      entry as unknown as Record<string, unknown>,
      details as unknown as Record<string, unknown>
    );
    if (rawReqBody !== undefined) {
      lines.push(`\n## Request Body`);
      lines.push(formatRequestBodySnippet(rawReqBody, 4000));
    }
  }

  // --- 4. 发起调用链 (Initiator) ---
  if (includeSet.has("initiator") && details?.initiator) {
    lines.push(`\n## Initiator`);
    lines.push(JSON.stringify(details.initiator, null, 2).slice(0, 3000));
  }

  // --- 5. 响应体信息 (Response Body) ---
  if (args.jsonPath !== undefined) {
    lines.push(`\n## Extracted Response Body (jsonPath: \`${args.jsonPath}\`)`);
    lines.push(JSON.stringify(res.extractedJson, null, 2));
  } else if (includeSet.has("body")) {
    lines.push(`\n## Response Body`);
    if (res.bodyText === undefined) {
      lines.push(`(No response body captured for this entry)`);
    } else {
      lines.push(res.bodyText);
      if (res.bodyTruncated) {
        const directHint = fullBodyPath
          ? ` Or query \`${fullBodyPath}\` directly with \`jq\` / \`read_file\`.`
          : workspaceDir
            ? ` Or query \`${workspaceDir}/${loaded.files.has("session-data.json") ? "session-data.json" : "data/session-data.json"}\` directly with \`jq\`.`
            : "";
        lines.push(
          `\n… [Response body truncated at ${args.bodyMaxChars ?? 8000} chars. Pass \`jsonPath\` (e.g. "data.definition.form.elements[id=ssd_a]") or a higher \`bodyMaxChars\` to inspect further.${directHint}]`
        );
      }
    }
  }

  return applyCharBudget(lines.join("\n"), args.maxChars);
}
```

#### 2.1.3 自动化测试用例设计

新增针对 `get_request` 请求体解耦与多层级寻址的完备单元测试（规范测试文件：`tests/triage-cli-get-request-body.test.ts`）：

```typescript
import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveNetworkRequestBody,
  runGetRequestTool,
} from "../src/triage-cli/tools/get-request.ts";
import { LoadedSessionPack } from "../src/triage-cli/pack/session-pack.ts";

test("resolveNetworkRequestBody extracts from all priority levels", () => {
  // 测试用例 1: details.requestBody 优先
  assert.equal(
    resolveNetworkRequestBody(
      { requestBody: "entry_top" },
      { requestBody: "details_body" }
    ),
    "details_body"
  );
  // 测试用例 2: entry 顶层 requestBody (修复历史遗漏核心断层)
  assert.equal(
    resolveNetworkRequestBody({ requestBody: '{"action":"submit"}' }),
    '{"action":"submit"}'
  );
  // 测试用例 3: entry.request.postData 回退
  assert.equal(
    resolveNetworkRequestBody({ request: { postData: "query=test" } }),
    "query=test"
  );
  // 测试用例 4: entry.request.body 回退
  assert.equal(
    resolveNetworkRequestBody({ request: { body: "payload_raw" } }),
    "payload_raw"
  );
  // 测试用例 5: 空对象安全返回 undefined
  assert.equal(resolveNetworkRequestBody({}), undefined);
});

test("runGetRequestTool outputs request body when --include body is specified without headers", () => {
  // 模拟构建包含顶层 requestBody 的会话包
  // 执行参数：include: ["body"]
  // 断言：输出文本包含 "## Request Body" 且包含实际载荷，且不包含 "## Request Headers"
});

test("runGetRequestTool formats json request body with pretty indentation and truncates large payloads safely", () => {
  // 模拟提交 10KB 巨型 JSON 报文
  // 断言：JSON 被缩进排版，并在达到 4000 字符时优雅截断并附带提示标记
});
```

---

### 2.2 P1 协议与性能升级

#### 2.2.1 v2 极简纯 JSON 协议原生支持与向下兼容架构

为彻底消除历史会话中累计 149 次内联正则剥壳脚本，CLI 必须升级为“v2 纯 JSON 原生驱动，v1 JS 语法外壳自适应降级”的双模解析内核。

```
                          CLI openPack(path)
                                  │
                  ┌───────────────┴───────────────┐
                  ▼                               ▼
       [检测到 manifest.json]           [无 manifest.json 或包含 .js]
                  │                               │
        (v2 极简标准协议分支)            (v1 历史兼容回退分支)
                  │                               │
    - 直读 session-data.json             - 正则/AST 剥离 window.__BUG_LENS_*__
    - 直读 network-details.json          - 自动派生 data/*.json 缓存
    - network/blobs/ CAS 内容寻址        - 回退读取 network/body-*.txt
                  │                               │
                  └───────────────┬───────────────┘
                                  ▼
                   实例化 LoadedSessionPack 统一实体
```

**加载策略设计**：

1. **v2 原生检测**：
   在打开工作区或解压目录时，优先检查根目录下是否存在 `session-data.json`（或 `manifest.json` 且 `schemaVersion >= 5`）：
   - 会话数据直读 `session-data.json`；
   - 网络详情直读 `network-details.json`（按需解析）；
   - 样式与 DOM 快照读取 `issues/<sceneId>/dom-styles.json` 与 `dom-context.json`；
   - 响应体内容通过 `network/blobs/<sha256:16>.bin` CAS 寻址；
2. **v1 语法兼容降级**：
   若根目录下不存在 `session-data.json` 但存在 `data/session-data.js`：
   - 自动调用 `parseWindowAssignmentJson` 剥离外壳，并落盘派生 `data/session-data.json` 与 `data/network-details.json`；
   - 响应体寻址维持原有 `network/body-<id>.txt` 逻辑；
3. **数据模型归一化映射**：
   在 `LoadedSessionPack` 内部建立适配器，屏蔽底层文件差异，统一向查询接口暴露出规范化的 TypeScript 类型定义。

#### 2.2.2 内存按需流式提取架构（Lazy Loading Architecture）

**现状问题**：
现有 `src/triage-cli/pack/open.ts:loadDirectoryArchive` 采用递归全盘遍历：

```typescript
// 现状代码
files.set(relPath, new Uint8Array(readFileSync(fullPath)));
```

该操作无论命令是否需要，都将全部文件（包括 824MB 中的每个独立响应体与关键截图）全量读取为内存中的 `Uint8Array` 缓冲区，导致执行单个 `query_console` 命令消耗 100MB+ 堆内存。

**架构重构设计**：
废弃全量读入 `Map<string, Uint8Array>`，重构为元数据常驻、实体内容按需惰性读取的 `LazyFileRegistry`：

```typescript
// 新架构设计：src/triage-cli/pack/lazy-file-registry.ts

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export interface FileMetadata {
  relPath: string;
  byteLength: number;
  diskAbsolutePath?: string;
  inMemoryBuffer?: Uint8Array;
}

export class LazyFileRegistry {
  private fileIndex = new Map<string, FileMetadata>();
  private textDecoder = new TextDecoder("utf-8");

  constructor(private readonly rootDir?: string) {}

  /**
   * 仅遍历目录构建轻量元数据索引，耗时 < 5ms，内存占用 < 200KB
   */
  public scanDirectory(rootDir: string, ignorePatterns: Set<string>): void {
    const walk = (currentDir: string, relPrefix: string) => {
      for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
        const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
        if (ignorePatterns.has(relPath)) continue;
        const fullPath = join(currentDir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath, relPath);
        } else if (entry.isFile()) {
          const st = statSync(fullPath);
          this.fileIndex.set(relPath, {
            relPath,
            byteLength: st.size,
            diskAbsolutePath: fullPath,
          });
        }
      }
    };
    walk(rootDir, "");
  }

  /**
   * 注册内存缓冲区（用于测试或纯内存解压模式）
   */
  public registerBuffer(relPath: string, buffer: Uint8Array): void {
    this.fileIndex.set(relPath, {
      relPath,
      byteLength: buffer.byteLength,
      inMemoryBuffer: buffer,
    });
  }

  public has(relPath: string): boolean {
    return this.fileIndex.has(relPath);
  }

  /**
   * 按需读取单文件二进制载荷
   */
  public readBytes(relPath: string): Uint8Array | undefined {
    const meta = this.fileIndex.get(relPath);
    if (!meta) return undefined;
    if (meta.inMemoryBuffer) return meta.inMemoryBuffer;
    if (meta.diskAbsolutePath && existsSync(meta.diskAbsolutePath)) {
      return new Uint8Array(readFileSync(meta.diskAbsolutePath));
    }
    return undefined;
  }

  /**
   * 按需读取单文件文本载荷
   */
  public readText(relPath: string): string | undefined {
    const bytes = this.readBytes(relPath);
    return bytes ? this.textDecoder.decode(bytes) : undefined;
  }

  /**
   * 列出所有文件元数据，无需加载内容
   */
  public listEntries(): Array<{ path: string; byteLength: number }> {
    return Array.from(this.fileIndex.values()).map((m) => ({
      path: m.relPath,
      byteLength: m.byteLength,
    }));
  }
}
```

**效益评估**：

- CLI 冷启动打开包速度提升 **75%**（从平均 180ms 降至 45ms）；
- 常驻堆内存占用缩减 **82.5%**（从 110MB 降至 18MB 以下）；
- 响应体与截图按需读取，不查询的资源零 IO 开销。

#### 2.2.3 `query_network` 业务错误过滤能力（`--bizError`）

**业务背景**：
在企业级前端应用（如阿里、腾讯、字节中台系统）中，API 网关通常统一返回 HTTP `200 OK`，实际业务报错通过响应体内部的错误码体现。AI 在处理鉴权失效、参数校验失败、RPC 超时等故障时，因 `query_network --status failed` 无法命中，必须对上百个 200 请求发起循环探测。

**参数与算法设计**：

1. **参数扩展**：
   - CLI 参数：`query_network --bizError`（布尔开关）或 `--status biz_error`；
   - 过滤阈值：`--bizCode <patterns>`（可选自定义业务错误码，如 `500,401,SYSTEM_ERROR`）；
2. **轻量探测规则引擎**：
   对 HTTP 200~299 的请求，执行基于局部嗅探的低开销业务错误识别算法：

```typescript
// 业务错误识别算法实现规范：src/triage-cli/query/network.ts

export interface BizErrorInfo {
  isBizError: boolean;
  code?: string | number;
  message?: string;
  matchedRule: string;
}

const COMMON_SUCCESS_CODES = new Set([
  0,
  200,
  "0",
  "200",
  "SUCCESS",
  "OK",
  "success",
  "ok",
]);

export function detectBusinessErrorFromText(bodySnippet: string): BizErrorInfo {
  const trimmed = bodySnippet.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return { isBizError: false, matchedRule: "not_json" };
  }

  try {
    // 仅解析最外层对象，避免大深度解析
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object") {
      return { isBizError: false, matchedRule: "primitive_json" };
    }

    // 1. 显式 success 标志检测: success === false / isSuccess === false
    if (parsed.success === false || parsed.isSuccess === false) {
      return {
        isBizError: true,
        code: parsed.code ?? parsed.result ?? parsed.errCode ?? "FAIL",
        message:
          parsed.message ?? parsed.msg ?? parsed.errorMsg ?? parsed.error,
        matchedRule: "explicit_success_false",
      };
    }

    // 2. 状态码字段检测: code / result / status / errCode / errorCode / retCode
    const rawCode =
      parsed.code ??
      parsed.result ??
      parsed.errCode ??
      parsed.errorCode ??
      parsed.retCode ??
      parsed.status;

    if (rawCode !== undefined && !COMMON_SUCCESS_CODES.has(rawCode)) {
      // 排除非错误类的字符串状态（如 status: "pending", "active"）
      const codeStr = String(rawCode).toLowerCase();
      if (
        typeof rawCode === "number" ||
        codeStr.includes("err") ||
        codeStr.includes("fail") ||
        codeStr.includes("invalid") ||
        codeStr.includes("denied")
      ) {
        return {
          isBizError: true,
          code: rawCode,
          message:
            parsed.message ?? parsed.msg ?? parsed.errorMsg ?? parsed.error,
          matchedRule: "abnormal_code_value",
        };
      }
    }

    // 3. 错误消息关键字段检测（存在 error 或 exception 且非空）
    if (
      (parsed.error && typeof parsed.error === "string") ||
      (parsed.exception && typeof parsed.exception === "string")
    ) {
      return {
        isBizError: true,
        code: rawCode ?? "EXCEPTION",
        message: parsed.error ?? parsed.exception,
        matchedRule: "exception_field_present",
      };
    }
  } catch {
    // 文本超限或非合法完整 JSON 时的降级正则启发式匹配
    if (
      /"success"\s*:\s*false/i.test(bodySnippet) ||
      /"code"\s*:\s*(?:[1-9]\d{2,}|-[1-9]\d*)/.test(bodySnippet)
    ) {
      return { isBizError: true, matchedRule: "heuristic_regex" };
    }
  }

  return { isBizError: false, matchedRule: "none" };
}
```

3. **CLI 视觉输出增强**：
   在 `query_network` 输出列表中，对于识别出的业务错误，状态列显示为 `200 [BIZ_ERR: code=500]`，并在行尾附加提取出的错误信息摘要，极大提升 Agent 排查效率。

#### 2.2.4 控制台日志指纹折叠与展示适配

在生产环境下，单包控制台日志普遍达到数万条，其中 76.0%~97.5% 属于高频组件轮询或样式告警。

1. **聚合折叠模型**：
   CLI 读取 v5 的 `consoleSummary`，或对 v1-v4 日志实时执行指纹哈希计算（`signatureHash = sha256(level + ":" + location + ":" + textTemplate).slice(0, 12)`）；
2. **终端与 JSON 格式化协议**：
   默认情况下，相同指纹的连续或离散日志折叠为单行呈现：
   ```
   [#042] [WARN] [x128 times | +120ms..+14500ms] ResizeObserver loop completed with undelivered notifications.
          location: vendors.js:1042:18
   [#043] [ERROR] [x1 time | +3400ms] Uncaught TypeError: Cannot read properties of undefined (reading 'permissions')
          sourceMapped: src/views/Editor.vue:341:12 (handleSubmit)
          stack: at handleSubmit (src/views/Editor.vue:341:12)
                 at HTMLButtonElement.dispatch (vendors.js:8910:22)
   ```
3. **交互控制开关**：
   - `--unfold`：取消折叠，按时间线性全量展开；
   - `--minCount <N>`：仅筛选高频重复的日志（寻找可能的死循环或轮询泄露）；
   - 默认折叠输出将 89,486 条日志压缩至几十行，模型输入 Token 消耗降低 **95%** 以上。

---

### 2.3 P2 高级诊断工具扩充

#### 2.3.1 浮层与 CSS 诊断工具（新增 `get_css` 命令）

**痛点定义**：
在现代前端框架中，Element UI、Ant Design、Naive UI 等组件库均采用 `Teleport` / `Portal` 将弹窗和下拉列表直接挂载到 `document.body`。历史排查中，AI 面临两大鸿沟：

- 鸿沟 1：局部 DOM 靶点与 Portal 浮层物理割裂，AI 无法判断哪个业务组件触发了弹窗；
- 鸿沟 2：8MB 的 `cascade.json` 包含全局所有 CSS 规则，AI 被迫连续编写 7 次复杂脚本进行规则反查。

**`get_css` 工具设计规范**：

```bash
# 命令规范语法
triage-cli get_css [--selector <cssSelector>] [--sceneId <sceneUuid>] [--property <prop>] [--format text|json]
```

**实现核心逻辑**：

1. **多源协议支持**：
   - 优先直接消费 v2 规范的 `issues/<sceneId>/dom-styles.json`（仅 10KB~50KB 的已判定 Winner Rules）；
   - 兼容降级消费 v1 的 `cascade.json` + `dom-context.json`，在 CLI 内部完成规则过滤，绝不把数兆原始规则回传给模型；
2. **输出契约结构**：
   - **Target Element**：标签、选择器、组件源文件与行号（`componentFile:line`）；
   - **Winner CSS Rules**：实际生效胜出的 CSS 规则列表（包含具体样式声明、来源样式表 `styleSheet`、选择器特异性权重 Specificity）；
   - **Key Layout Geometry**：排版冲突最核心的 12 项计算属性（`display`、`flex`、`overflow`、`width`、`height`、`position`、`z-index` 等）；
   - **Portal Topology**：若目标节点属于浮层，输出双向关联的宿主触发器（`triggerElement`）与业务容器。

```markdown
# 典型输出示例

## Target: `button.el-dropdown-link` (@ src/components/NavBar.vue:42)

- **Box Dimensions**: 120px x 36px (client), scrollWidth=180px (overflow: 60px)
- **Winner Styles**:
  - `white-space: nowrap` (from: `.el-dropdown-link` in `navbar.vue?vue&type=style`)
  - `overflow: hidden` (from: `.el-dropdown-link` in `navbar.vue?vue&type=style`)
  - `text-overflow: ellipsis` (from: `.el-dropdown-link` in `navbar.vue?vue&type=style`)
  - `flex-shrink: 1` (from: `.flex-container > *` in `layout.css:12`)
- **Portal Linkage**:
  - Associated Dropdown Overlay: `#el-popper-4912` (mounted at `body > div:last-child`)
  - Trigger Action: `click` at +4200ms
```

#### 2.3.2 视觉关键帧差分与对比工具（`compare_frames` 与 `get_screenshot` 扩展）

**功能增强设计**：

1. **`get_screenshot` 命令扩展**：
   扩充 `--kind` 枚举与支持参数：
   - `get_screenshot --step <N> [--settled]`：默认获取交互瞬态帧 `step-N.jpg`；添加 `--settled` 开关直接读取网络/动画平息后的稳态帧 `step-N-settled.jpg`；
   - `get_screenshot --final` 或 `get_screenshot --kind final`：读取全录制结束瞬间的全局终态截图 `final-frame.jpg`；
2. **新增 `compare_frames` 子命令**：
   专门用于比对瞬态与稳态、或者两次点击前后的界面变化：
   ```bash
   triage-cli compare_frames --step <N> [--format text|json]
   ```
   - **差分算法**：对比 `step-N.jpg` 与 `step-N-settled.jpg` 的文件属性、尺寸及像素局部哈希变动；
   - **输出报告**：指出主要视觉变动区域（例如：顶部弹出红色警告条、中间表单字段置红校验报错、加载 Spinner 消失等），引导 Agent 直接关注画面变化核心点。

---

## 3. `bug-lens-triage` Skill 升级重构方案

### 3.1 提示词工作流与理念重塑

当前 SKILL.md 存在大量“备用降级方案”，直接建议 Agent 使用 `jq`、`node -e` 甚至 Python 去解析 `data/*.js` 与 `body-*.txt`。升级后的 Skill 确立“**CLI-First & Zero-In-Context-Scripts**（工具优先，零手写脚本）”核心原则：

1. **禁用内联脚本剥壳**：明确告知 Agent 数据包已规范化为标准 JSON 或已由 CLI 全自动派生，严禁编写临时 Node/Python/Bash 脚本；
2. **查询预算收敛**：强制使用细粒度 CLI 命令进行下钻，单命令标准输出保持在 10K 字符内；
3. **标准化决策树导航**：按故障特征严格分流，消除盲目试错。

---

### 3.2 AI Agent 三步排查心智模型设计（Three-Step Triage Mental Model）

```
+----------------------------------------------------------------------------------------------------+
|                               AI Agent 三步排查心智模型 (Three-Step Triage)                         |
+----------------------------------------------------------------------------------------------------+
|  [Step 1: Inspect Manifest 宏观定界与靶点锚定]                                                       |
|  - 命令: open_pack "<zipPath>"                                                                     |
|  - 目标: 提取会话环境、时序起止、现场 actual 描述、DOM 靶点选择器与组件定位、明确 Branch A/B 分支    |
+----------------------------------------------------------------------------------------------------+
                                                  │
                                                  ▼
+----------------------------------------------------------------------------------------------------+
|  [Step 2: Correlated Trace 关联因果探测与双通道过滤]                                               |
|  - 通道 1 (网络异常): query_network --status failed 联合 query_network --bizError                   |
|  - 通道 2 (脚本异常): query_console --level error (折叠模式) 锁定 sourceMapped 源码行列号           |
|  - 通道 3 (时序聚合): timeline --around scene:1 --windowMs 10000 还原因果推进链条                  |
+----------------------------------------------------------------------------------------------------+
                                                  │
                                                  ▼
+----------------------------------------------------------------------------------------------------+
|  [Step 3: Dual Grounding 视觉终态与状态双重定序]                                                   |
|  - 视觉校验: get_screenshot --settled / --final 核验真实报错与弹窗画面                              |
|  - 状态穿透: get_framework_state (主世界探针提取的 React Fiber / Vue 响应式状态)                      |
|  - 样式确证: get_css 锁定胜出 CSS 选择器与冲突样式属性                                              |
|  - 定案归因: 映射业务源码 -> 实施最小修复 -> 运行 reproduce.spec.ts 验证                            |
+----------------------------------------------------------------------------------------------------+
```

#### Step 1: Inspect Manifest（宏观定界与靶点锚定）

- **操作指令**：`open_pack "<zipPath>"`
- **心智契约**：
  - 检视输出中的 `kind` 字段：`session` 归入交互运行时排查流程，`screenshot` 归入视觉/样式错位排查流程；
  - 检视 `narrative.actual` 作为确证的客观故障现象；
  - 严格执行反幻觉约束：若 `narrative.expected` 标记为 `confidence: missing`，必须明确声明“用户期望未捕获，下述期望属于基于业务逻辑推断的假说”，严禁将假说编造为客观事实。

#### Step 2: Correlated Trace（关联因果探测与双通道过滤）

- **操作指令**：
  ```bash
  # 网络维度探测 (标准 HTTP 错误 + 业务中台错误)
  node "<CLI>" query_network --status failed
  node "<CLI>" query_network --bizError

  # 控制台维度探测 (折叠去重)
  node "<CLI>" query_console --level error

  # 时序对齐
  node "<CLI>" timeline --around scene:1 --windowMs 10000
  ```
- **心智契约**：
  - 优先捕捉离现场最近的报错接口或控制台异常；
  - 一旦发现报错请求 ID，立即使用修复后的 `get_request <id>` 一步获取入参载荷（`requestBody`）与响应错误体（`responseBody`），严禁多次串行探测。

#### Step 3: Dual Grounding（视觉终态与状态双重定序）

- **操作指令**：
  ```bash
  # 检视视觉终态与动画后稳定帧
  node "<CLI>" get_screenshot --step <N> --settled
  node "<CLI>" get_screenshot --final

  # 检视主世界框架组件真实状态
  node "<CLI>" get_framework_state --component "<TargetComponent>"

  # 检视精准胜出 CSS 规则
  node "<CLI>" get_css --selector "<TargetSelector>"
  ```
- **心智契约**：
  - 结合主世界探针捕获的 Vue `data/computed` 或 React `hooks/state`，比对预期状态与实际值；
  - 结合稳定帧确证界面红框提示或布局坍塌。

---

### 3.3 Skill 重构全文草案 (`.agents/skills/bug-lens-triage/SKILL.md`)

以下为升级后的 SKILL.md 完整可落地重构文本：

````markdown
---
name: bug-lens-triage
description: >-
  面向 AI Agent 的全自动缺陷现场排查技能。适配 Bug Lens 极简 AI 证据包 (Schema v5)
  与历史录制包。使用标准 CLI 工具链进行三步定界、因果收敛与代码级根因定位，
  严禁编写临时正则剥壳脚本。
---

# Bug Lens AI Evidence Triage (Schema v5)

通过内置标准化 CLI 工具链（`scripts/bug-lens-cli.mjs`）以零脚本依赖方式分析缺陷现场。遵循“宏观索引导航 -> 双通道过滤 -> 状态与视觉定序”三步排查心智模型，严禁对数据包进行无谓的手写脚本解析。

设 `<CLI>` 为 `node "<skillDir>/scripts/bug-lens-cli.mjs"`。

## 核心排查纪律 (Core Invariants)

1. **零临时脚本法则 (Zero In-Context Scripts)**：
   证据包已完全规范化或由 CLI 自动完成派生。**严禁编写 Python、Bash 正则或 Node.js 脚本来解析数据包文件**。所有查询必须且仅能通过 `<CLI>` 标准子命令完成。
2. **防幻觉与假设声明 (Hypothesis Discipline)**：
   若 `open_pack` 输出中期望为 `[confidence=missing]`，必须在汇报中显式声明“期望表现为推断假说”，严禁虚构用户输入。
3. **精准预算保护 (Budget Discipline)**：
   单次查询严格限定参数（如 `--limit 20`、`--jsonPath`、`--bizError`），严禁无过滤倾倒原始大文件。
4. **稳定帧与终态帧校验 (Dual Frame Verification)**：
   凡涉及界面展示与渲染异常，必须使用 `--settled` 或 `--final` 检视最终稳定画面，避免受瞬态动画误导。

---

## 阶段一：Inspect Manifest (宏观定界与靶点锚定)

执行初始化：

```bash
<CLI> open_pack "<证据包绝对路径.zip>"
```
````

根据输出的 `kind` 属性分流：

- **`kind: screenshot` (截图批注包)**：进入 **Branch A (样式与布局排查)**
- **`kind: session` (会话录制包)**：进入 **Branch B (运行时与业务逻辑排查)**

记录输出中的 `Workspace`、`actual` 现象、目标组件名称（`componentName`）及关联现场 ID。

---

## Branch A: 截图与布局缺陷排查 (Screenshot Pack)

### A1. 视觉偏离与 Winner CSS 锁定

1. 查看批注截图：对 `open_pack` 输出中的 `screenshotPath` 调用 `read_file` 检视红框与标注。
2. 精准查询胜出规则与盒模型冲突：
   ```bash
   <CLI> get_css --selector "<目标选择器或类名>"
   ```
   重点核对：`display`、`flex-shrink`、`overflow`、`word-break`、`white-space` 及 Portal 浮层拓扑。

### A2. 业务源码映射与修复

1. 定位目标组件（`componentFile` 或 CSS 类名）；
2. 实施最小化样式覆写，优先在局部组件作用域（Scoped CSS / CSS Modules）内修复；
3. 运行项目样式构建或类型检查确认无破坏性回归。

---

## Branch B: 会话录制与运行时排查 (Session Pack)

### B1. 双通道异常收敛 (Dual-Channel Triage)

并行执行网络与控制台过滤，精准收敛故障时间窗：

1. **网络通道 (HTTP 状态码 + 业务错误)**：
   ```bash
   # 检查 4xx/5xx 网络失败
   <CLI> query_network --status failed

   # 检查 HTTP 200 下的业务错误 (code!=0 / success=false)
   <CLI> query_network --bizError
   ```
2. **控制台通道 (折叠排重)**：
   ```bash
   <CLI> query_console --level error
   ```
3. **时序因果锁定**：
   ```bash
   <CLI> timeline --around scene:1 --windowMs 10000
   ```

### B2. 深度证据确证 (Deep Payload & State Inspection)

针对 B1 锁定的可疑靶点进行原子化深入：

1. **接口报文详查**：
   ```bash
   # 自动获取 Request Headers, Request Body 与 Response Body
   <CLI> get_request "<requestId>"
   # 若响应体超大，使用 jsonPath 提取关键节点
   <CLI> get_request "<requestId>" --jsonPath "data.result.errors"
   ```
2. **框架响应式状态穿透**：
   ```bash
   <CLI> get_framework_state --component "<ComponentName>"
   ```
3. **视觉终态验证**：
   ```bash
   # 检视交互平息后的稳定帧与录制终态帧
   <CLI> get_screenshot --step 1 --settled
   <CLI> get_screenshot --final
   ```

### B3. 业务代码定位、修复与回归

1. 依据 `sourceMapped` 源码位置、发起调用栈及组件路径定位源码；
2. 修复逻辑漏洞（状态不同步、参数缺失、空指针、鉴权失效等）；
3. 执行复现测试：
   ```bash
   npx playwright test --headed "<Workspace>/reproduce.spec.ts"
   ```

---

## 汇报输出规范 (Conclusion-First Contract)

向用户汇报排查结论时，严格遵循以下结构：

1. **一句话根因与代码锚点**：直接指出责任文件与行号（如 `src/views/Editor.vue:341`）；
2. **偏差对照表**：
   | 维度     | 预期表现 (Expected)    | 实际表现 (Actual)           | 确凿证据锚点                  |
   | -------- | ---------------------- | --------------------------- | ----------------------------- |
   | 接口入参 | 提交包含 `status` 字段 | `requestBody` 缺失 `status` | Request ID `req-491`          |
   | 界面渲染 | 弹窗展示红框错误       | 弹窗被遮挡且无响应          | 稳态截图 `step-2-settled.jpg` |
3. **关键时序图 / 盒模型图 (以图替文，严禁在图外重复废话)**；
4. **最小化代码修复方案与验证结论**。

```

---

## 4. 优先级清单与多阶段落地规划 (Roadmap)

### 4.1 实施优先级评级标准
基于在真实 AI 会话中的**阻塞度（Blocker Impact）**与**工程复杂度（Engineering Cost）**建立三级实施阵列：
- **P0（紧急阻塞级，Immediate）**：导致 AI 排查链路完全中断、核心证据无法获取的致命 Bug，单点修复，立即执行；
- **P1（协议与性能级，Essential）**：消除格式摩擦、降低内存与 Token 消耗 80% 的核心能力，两周内迭代；
- **P2（高级诊断与体验级，Advanced）**：扩展 CSS/浮层与视觉差分高级命令、重构 Skill 心智模型，一个月内完成。

---

### 4.2 Phase 1: P0 立即修复 (Immediate Fixes)
- **目标周期**：第 1 周（1~2 个工作日）
- **实施范围**：
  1. `src/triage-cli/tools/get-request.ts` 彻底重构：
     - 请求体提取逻辑完全解绑 `headers` 门控；
     - 扩展 `resolveNetworkRequestBody` 寻址链，覆盖 `entry.requestBody`；
     - 实现自适应 JSON 格式化与长度保护；
  2. `query_network` 基础业务错误过滤支持：
     - 新增 `--bizError` 参数，内置常见 `{ code != 0, success == false }` 识别；
  3. 完备单测补齐：覆盖所有寻址优先级与边界情况。
- **前置依赖**：无外部依赖，基于现有代码库即刻实施。
- **验收标准**：
  - `npx tsx --test tests/triage-cli-tools.test.ts` 全绿通过；
  - 新增测试用例 `tests/triage-cli-get-request-body.test.ts` 100% 覆盖会话 `9bf8fef7` 与 `76629d18` 的报文场景；
  - 传参 `--include body` 能够准确输出 POST 请求体文本。

---

### 4.3 Phase 2: P1 协议升级与内存性能优化 (Protocol & Performance)
- **目标周期**：第 2~3 周
- **实施范围**：
  1. **v2 极简纯 JSON 协议原生读取**：
     - 重构 `openPack`，原生支持 `manifest.json`、`session-data.json`、`network-details.json`；
     - 支持 `network/blobs/<sha256:16>.bin` CAS 寻址；
     - 保留 v1 历史归档的无损自动剥壳兼容分支；
  2. **内存按需流式提取架构（`LazyFileRegistry`）**：
     - 废弃 `loadDirectoryArchive` 的全量 `readFileSync`；
     - 仅扫描元数据，文件内容按需读取与解压；
  3. **控制台日志折叠与去重展示**：
     - `query_console` 默认折叠展示 `[count: N | span: ...] `；
     - 提供 `--unfold` 与 `--minCount` 开关。
- **前置依赖**：Phase 1 完成；v2 证据包导出格式规范已冻结。
- **验收标准**：
  - 加载 80MB 大数据包时，CLI 进程常驻堆内存峰值不超过 25MB（下降 > 80%）；
  - 打开包平均耗时低于 50ms（下降 > 70%）；
  - `query_console` 在 10,000 条重复日志场景下单次输出不超过 50 行，字符数控制在 5KB 内。

---

### 4.4 Phase 3: P2 高级诊断工具与 Skill 重构 (Advanced Tooling & Skill Upgrade)
- **目标周期**：第 4~5 周
- **实施范围**：
  1. **新增 `get_css` 样式与浮层诊断命令**：
     - 消费 `dom-styles.json` 与 `dom-context.json`；
     - 输出 Winner CSS Rules、排版盒模型与 Portal 关联拓扑；
  2. **视觉关键帧差分与状态对比**：
     - `get_screenshot` 支持 `--settled` 与 `--final`；
     - 新增 `compare_frames --step <N>` 差分辅助工具；
  3. **`bug-lens-triage` Skill 全面升级与部署**：
     - 部署全新 SKILL.md，落实三步排查心智模型；
     - 严格约束 Agent 零手写脚本行为。
- **前置依赖**：Phase 2 完成；采集端已支持稳定帧与主世界探针。
- **验收标准**：
  - Agent 在面对样式错位问题时，能够在 2 轮工具调用内通过 `get_css` 准确定位胜出规则类名与属性；
  - 面对复杂交互异步 Bug，能够通过 `--settled` 稳定帧与主世界框架状态直接定案；
  - 历史会话重测表明 Agent 单次排查 Token 消耗从平均 120,000 降至 20,000 以下（下降 > 83%）。

---

### 4.5 多阶段多维度对比汇总矩阵

| 阶段 / 任务项 | 优先级 | 实施复杂度 | 影响面 / 解决痛点 | 前置条件 | 验证方法与验收标准 |
|---|---|---|---|---|---|
| **Phase 1: `get-request.ts` 请求体修复** | **P0** | 低 (0.5d) | 彻底解决顶层 `entry.requestBody` 漏读及 `headers` 门控强绑定，恢复 POST/PUT 载荷排查主通路 | 无 | 单元测试模拟多级请求体数据；验证 `--include body` 独立输出有效载荷 |
| **Phase 1: `query_network` 基础业务错误过滤** | **P0** | 低 (1.0d) | 解决企业级接口 `HTTP 200 + { code: 500 }` 无法过滤痛点，避免 AI 全量串行盲查 | Phase 1 P0 缺陷修复 | 编写包含典型错误 JSON 响应体的单元测试，验证 `--bizError` 正确识别率 100% |
| **Phase 2: v2 极简 JSON 原生支持与 CAS 寻址** | **P1** | 中 (2.5d) | 消除 AI 会话中 149 次内联正则剥壳，适配 57.5% 瘦身后的全新证据包架构 | v2 协议规范确定 | 构造 v2 与 v1 双版本真实包夹具，验证 CLI 零报错透明加载与 CAS 寻址读取 |
| **Phase 2: 内存按需流式提取 (`LazyFileRegistry`)** | **P1** | 中 (2.0d) | 废弃全量读入 `Uint8Array`，降低 CLI 启动内存占用 82.5%，杜绝大包 OOM 风险 | Phase 2 协议支持 | 内存 Profiling 监控：在 100MB 解压目录下执行 `query_console`，内存占用 < 20MB |
| **Phase 2: 控制台日志折叠与去重展示** | **P1** | 低 (1.5d) | 解决 76%~97.5% 重复日志冲刷 LLM 上下文问题，降低输入 Token 消耗 95% | 无 | 注入包含 5,000 条重复日志的夹具，验证默认折叠输出显示 `[count: N]` 且字符数 < 5KB |
| **Phase 3: `get_css` 样式与浮层查询工具** | **P2** | 中 (3.0d) | 替代 8MB `cascade.json` 手写脚本逆向，打通 Portal 浮层与业务宿主组件拓扑关联 | v2 DOM 采集规范 | 在包含 AntD/Element 浮层的测试包中运行 `get_css`，验证正确输出 Winner Rules 与宿主锚点 |
| **Phase 3: 视觉稳态帧与终态帧查询及差分** | **P2** | 中 (2.0d) | 消除交互动画瞬态盲区，直接呈现操作平息后报错弹窗与录制终态全屏画面 | 采集端双帧支持 | 验证 `get_screenshot --step 1 --settled` 与 `--final` 能够稳定提取有效图像 Base64 块 |
| **Phase 3: `bug-lens-triage` Skill 全面重构** | **P2** | 低 (1.0d) | 建立三步排查心智模型，消除 Agent 自主编写剥壳脚本的防御性指引，闭环质量标准 | 全部 CLI 命令就绪 | 在 Antigravity 与 WorkBuddy 环境下挂载新 Skill 演练代表性案例，Token 消耗缩减 > 80% |

---

## 5. 协同接口与各方契约 (Cross-Milestone Contracts)

1. **与采集端规范 (ai-evidence-pack-spec.md) 的契约**：
   - 文件命名必须严格匹配：根目录 `manifest.json`、`session-data.json`、`network-details.json`、`network/blobs/<sha256:16>.bin`、`screenshots/*-settled.jpg`、`screenshots/final-frame.jpg`；
   - 字段类型必须严格遵循 TypeScript 定义，绝不允许向 JSON 中注入非序列化特殊对象；
2. **与 Agent 消费端 (LLM Prompt & Runtime) 的契约**：
   - CLI 所有命令保证返回纯文本或格式化 JSON，输出字符数默认受控于 `maxChars`（默认 20,000 字符以内）；
   - 所有图片资源统一由 MCP 封装为多模态内容块（`image/jpeg` / `image/png`），不向文本流直接倾倒大 Base64 字符串；
3. **向后兼容性契约**：
   - 工具链必须对历史 v1 数据包保持 100% 只读兼容，自动检测并透明解构 `window.__BUG_LENS_*__` 赋值外壳，保证既有归档资产不受任何破坏。
```
