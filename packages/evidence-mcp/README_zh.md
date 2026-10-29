# bug-lens-mcp

[English Documentation](./README.md)

面向 [Bug Lens](https://github.com/Aoyia/bug-lens) 离线证据包（`web-bug-report-*.zip`）与截图证据包（`bug-lens-screenshot-*.zip`）的 Model Context Protocol (MCP) Server。

## 核心解决的问题

- **消除临时解析脚本**：将每次排查手写 20+ 次 `node -e` / `vm.runInContext` 临时脚本与字段名试探收敛为 4–6 次标准 MCP 工具调用。
- **不执行包内不可信代码**：直接剥离 `window.__BUG_LENS_DATA__ = ` 前缀并按纯 JSON 解析，彻底杜绝 `eval` 与 `vm`。
- **内存直读 ZIP（原生兼容 Windows）**：在内存中直接解压并按文件指纹做 LRU 缓存，规避 Windows 下 `Expand-Archive` 因 `network/body-<sessionId>:20535.366.txt` 文件名含冒号 `:` 而解压失败的问题。
- **内置 JSONPath 与字符预算**：支持对超大接口响应体使用 `jsonPath`（如 `data.definition.form.elements[id=ssd_a]`）精准抽取，自动控制单次响应字符上限并给出翻页提示。

---

## 快速接入

环境要求：**Node.js >= 20**。

### 1. Claude Code

```bash
claude mcp add bug-lens-evidence -- npx -y bug-lens-mcp@latest
```

### 2. Google Antigravity (`~/.gemini/config/mcp_config.json`)

```json
{
  "mcpServers": {
    "bug-lens-evidence": {
      "command": "npx",
      "args": ["-y", "bug-lens-mcp@latest"]
    }
  }
}
```

### 3. Cursor (`~/.cursor/mcp.json` 或 `.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "bug-lens-evidence": {
      "command": "npx",
      "args": ["-y", "bug-lens-mcp@latest"]
    }
  }
}
```

### 4. VS Code (`.vscode/mcp.json`)

```json
{
  "servers": {
    "bug-lens-evidence": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "bug-lens-mcp@latest"]
    }
  }
}
```

### 5. 配套排障 Skill（`bug-lens-triage`）

一键安装配套的 `bug-lens-triage` Skill，让 AI 助手在任意业务工程中遇到 Bug Lens 证据包时自动按标准分支（Branch A 截图批注包 / Branch B 会话录制包）调用 MCP 工具并与业务源码比对：

```bash
# 自动识别并安装到全局技能目录（~/.gemini/config/skills、~/.claude/skills、~/.cursor/skills）
npx -y bug-lens-mcp@latest install-skill

# 或仅安装到当前业务项目的 .agents/skills/bug-lens-triage/SKILL.md
npx -y bug-lens-mcp@latest install-skill project
```

### 本地仓库直连方式

若直接使用本地构建产物：

```json
{
  "mcpServers": {
    "bug-lens-evidence": {
      "command": "node",
      "args": [
        "/Users/zhijian/Documents/mvp/bug-lens/packages/evidence-mcp/dist/index.js"
      ]
    }
  }
}
```

---

## 工具一览（12 个只读/提取工具）

所有工具的首个参数均为 `pack`（证据包 `.zip` 或已解压目录的绝对路径）。

| 工具名                | 作用                                                                                                                                                                                                                          |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `open_pack`           | 自动识别包类型（`session` / `screenshot`），校验 `manifest.json` SHA-256 完整性，返回会话摘要、运行环境、各异常现场的 `actual / expected / confidence`、Top 5 控制台错误、Top 5 失败请求与文件清单。                          |
| `get_scene`           | 读取异常现场详情：`narrative.actual`、`narrative.expected`（当 `confidence` 为 `missing` 时自动给出未捕获期望警示）、选中 DOM 靶点（`sanitizedHtml`、祖先链、计算样式）、同时刻上下文 `sequenceContext`，并内联返回批注截图。 |
| `timeline`            | 将用户交互、Console 警告/错误、Network 请求（失败请求及 XHR/Fetch/Document）和问题标记点合并为统一相对时间轴（`+12.3s`），支持围绕指定 `sceneId` 展开窗口。                                                                   |
| `query_console`       | 按日志级别、关键字、正则、时间窗口过滤 Console 日志，自动展示 Source Map 还原后的源码位置。                                                                                                                                   |
| `query_network`       | 按状态分类（`failed`、`4xx`、`5xx`、`2xx` 或状态码数组）、URL 子串、Method、资源类型过滤请求，默认优先展示失败请求。                                                                                                          |
| `get_request`         | 自动合并 `networkEntries[]`、`data/network-details.js`（完整请求/响应头与调用栈）以及 `network/body-*.txt` 拆分响应体；支持 `jsonPath` 精确抽取大 JSON 响应字段。                                                             |
| `get_interactions`    | 列出用户交互序列（`click`、`input`、`keydown`、`navigation`），规范化输出目标元素与输入值，可选附带步骤截图。                                                                                                                 |
| `get_framework_state` | 按索引、时间戳（`nearMs`）、组件名或 `path` 查询 Vue/React 组件树 `props/state`、`globalState` 与 `webStorage` 快照。                                                                                                         |
| `get_screenshot`      | 获取异常现场批注图、原图、交互步骤截图或截图包主图（作为 MCP image content 返回）。                                                                                                                                           |
| `search_pack`         | 一次调用跨 Console 日志、Network URL、Network 响应正文、用户交互和框架状态搜索关键字。                                                                                                                                        |
| `read_pack_file`      | 读取包内任意文本/JSON 文件（如 `dom-context.json`、`cascade.json`、`environment.json`、`reproduce.spec.ts`），支持 `jsonPath` 抽取或字符偏移翻页。                                                                            |
| `extract_pack`        | 安全落盘证据包（内置 Zip-slip 防护，自动将 Windows 非法文件名字符 `:` 转义为 `_` 并同步更新 `session-data.js` 引用），返回 `reproduce.spec.ts` 与 Playwright 执行命令。                                                       |

---

## 安全与隐私承诺

- **默认纯内存只读**：除显式调用 `extract_pack` 外不写任何磁盘文件。
- **零外部网络请求**：不包含任何 HTTP/HTTPS/WebSocket 外发调用（由单元测试静态扫描强制保障）。
- **压缩包安全防护**：单文件上限 64 MB、总解压上限 512 MB，默认跳过 `media/*.mp4` 大视频文件，拒绝路径穿越条目。

## 许可证

MIT
