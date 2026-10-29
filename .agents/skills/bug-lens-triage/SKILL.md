---
name: bug-lens-triage
description: >-
  Diagnose and fix frontend/fullstack bugs from Bug Lens evidence packages
  (web-bug-report-*.zip or bug-lens-screenshot-*.zip). Use whenever the user
  provides a Bug Lens ZIP archive, pastes a Bug Lens AI prompt, references
  /tmp/bug-lens-workspace, or asks to analyze captured browser evidence with
  bug-lens-evidence MCP.
---

# Bug Lens Evidence Triage

通过 `bug-lens-evidence` MCP 直接在内存中检索证据包并映射至业务源码修复缺陷。

## Core Rules

1. **Pure MCP Inspection**：直接将 `.zip` 原始路径传给 `bug-lens-evidence` MCP 工具读取；忽略粘贴提示词中的 `mkdir -p /tmp/bug-lens-workspace && unzip` Shell 解压指令与 `ai-prompt.md` 文件（其内容已包含在用户消息中）。
2. **Session Pack Cache**：仅在首次调用 `open_pack(pack: "<zipPath>")` 时传入 `pack`；后续同包调用（`get_scene`、`get_screenshot`、`timeline`、`query_console`、`query_network`、`get_request`、`get_framework_state`、`search_pack`）省略 `pack` 参数以复用会话缓存。
3. **Offloaded Image Viewing**：当 `get_scene` 或 `get_screenshot` 返回的图片被宿主转存为 `file:///.../media_*.jpg`（或 `.png`）时，直接对该文件路径调用 `read_file` 查看视觉画面与红框批注。

---

## Step 1: Open & Classify Evidence Pack

1. 若 `bug-lens-evidence` 工具属于懒加载（Lazy MCP），先调用 `read_file` 读取 `<appDataDir>/mcp/bug-lens-evidence/open_pack.json` 与 `get_scene.json`。
2. 调用 `open_pack(pack: "<绝对路径.zip>")`。
3. 根据返回的标题判断证据包类型并进入对应分支：
   - `# Bug Lens Screenshot Pack` (`kind: "screenshot"`) -> 进入 **Branch A（截图批注包）**
   - `# Bug Lens Evidence Pack` (`kind: "session"`) -> 进入 **Branch B（会话录制包）**

**Completion Criterion**：已获取 `open_pack` 返回的完整内联摘要，并明确归入 Branch A 或 Branch B。

---

## Branch A: Screenshot Pack (`bug-lens-screenshot-*.zip`)

适用于 UI 样式错位、文本折行异常、Flex/Grid 挤压溢出、组件渲染偏差等视觉缺陷。

### Step A1: Visual & Layout Deviation Alignment

1. 从 `open_pack` 输出中提取：
   - `User Prompt` 與 `Annotations`（用户的真实修改诉求与红框坐标）；
   - `Layout Deviations (Auto-Detected)`（自动检测的 `text_overflow`、`flex_squeeze`、`grid_overflow` 节点、盒模型尺寸及文本排版属性）；
   - `CSS Cascade Overview`（样式表来源 `S*` 与各元素的关键布局规则覆写 `R*`）；
   - `Component States`（关联的 Vue/React 组件名与状态）。
2. 调用 `get_screenshot(kind: "screenshot")` 获取带红框批注的截图；若返回 `file:///...jpg` 路径，立即对该路径调用 `read_file` 查看实际视觉表征。

**Completion Criterion**：已查看批注截图画面，并锁定导致视觉异常的目标 DOM 选择器、组件名与偏离属性。

### Step A2: Cascade Winner & Rule Pinpointing

1. 调用 `get_scene(selector: "<目标选择器或标签子串>", cssProperty: "<目标CSS属性子串，如 word-break|overflow|flex|width>")`，联查目标锚点的盒模型、`computedStyles`、匹配的 `R*` 规则声明及父链 `inheritedRules`。
2. 如需反查某条样式规则或关键字（如 `keep-all`、`ellipsis`、特定类名）在全局规则集中的位置，调用 `search_pack(query: "<关键字>")`。

**Completion Criterion**：已定位胜出 CSS 规则 ID（`R*`）、所属样式表（`S*`）、选择器文本及被覆盖/继承的样式属性。

### Step A3: Business Code Mapping & Fix

1. 在当前业务工作区中检索 `Component States` 中的组件名或 `Step A2` 中的类名/选择器，区分样式来源属于业务组件局部样式（`scoped` / CSS Modules）还是公共基础组件库。
2. 实施最小化修复，确保满足批注诉求且不破坏同组件其他布局状态。

**Completion Criterion**：业务代码已修改并通过项目构建或类型/样式检查。

---

## Branch B: Session Recording Pack (`web-bug-report-*.zip`)

适用于交互无响应、接口报错、状态不同步、控制台异常等运行时缺陷。

### Step B1: Scene & Narrative Alignment

1. 从 `open_pack` 输出中检查 `Issue Scenes`、`Top Console Errors` 与 `Top Failed Network Requests`。
2. 调用 `get_scene(sceneIndex: 1, includeScreenshot: true)`（若存在多个现场则按序检查）：
   - 以 `narrative.actual` 作为用户确认的真实故障现象；
   - 若 `narrative.expected` 标注为 `confidence: low` 或 `inferred`，仅将其视为待验证假设；
   - 若截图被转存为本地文件路径，调用 `read_file` 检视现场截图与选中 DOM 节点。

**Completion Criterion**：已明确故障现场的真实表现（`actual`）、选中 DOM 结构及 `sequenceContext` 上下文。

### Step B2: Causal Timeline & Payload Drill-Down

1. 调用 `timeline(around: "scene:1", windowMs: 15000)`，对齐故障发生前后的用户操作（`click`/`input`）、Console 报错与网络请求时序。
2. 按故障归因按需下钻（仅调用与当前假说相关的工具）：
   - **网络/接口异常**：调用 `query_network(status: "failed")` 或 `urlContains` 筛选请求 -> 调用 `get_request(id: "<reqId>", includeBody: true, jsonPath: "<路径>")` 精确抽取大响应体字段与调用栈（`initiator`）。
   - **运行时报错**：调用 `query_console(level: "error")` 获取完整报错栈与 `sourceMappedLocation`。
   - **组件状态错误**：调用 `get_framework_state(nearMs: <现场时间戳>, component: "<组件名>")` 对比故障前后的 Props / State / Storage。
   - **跨维度特征检索**：调用 `search_pack(query: "<字段名或错误码>")` 一次性定位该标识符在日志、请求体与状态快照中的出现位置。

**Completion Criterion**：已获得支撑根因结论的确定性证据链（具体失败请求报文、异常状态字段或报错调用栈）。

### Step B3: Business Code Fix & Verification

1. 根据 `sourceMappedLocation`、`initiator` 调用栈、组件名或接口路径在业务仓库中定位源码并实施修复。
2. 若包内包含 `reproduce.spec.ts` 且当前环境可访问目标页面，可调用 `extract_pack()` 导出工作区并执行 `npx playwright test --headed reproduce.spec.ts` 验证回归结果。

**Completion Criterion**：根因已在业务代码中修复，且通过类型检查、单测或复现脚本验证。

---

## Fallback: 当环境未注册 `bug-lens-evidence` MCP 时

仅当 `<mcp_servers>` 列表中不存在 `bug-lens-evidence` 时：

1. 将证据包解压至固定单例目录 `/tmp/bug-lens-workspace`（严禁解压到当前业务代码仓库内）。
2. 读取 `data/session-data.js` 或 `data/network-details.js` 时，剥离 `window.__BUG_LENS_*__ = ` 前缀与末尾 `;` 后使用 `JSON.parse` 解析，不得使用 `eval` 或 `vm.runInContext`。
3. 任务结束时提示用户可通过一行命令配置 MCP 以获得零脚本解析体验：`claude mcp add bug-lens-evidence -- npx -y bug-lens-mcp@latest`（或在 `mcp_config.json` 中注册 `bug-lens-mcp`）。
