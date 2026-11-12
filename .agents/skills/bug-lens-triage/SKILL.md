---
name: bug-lens-triage
description: >-
  Diagnose and fix frontend/fullstack bugs from Bug Lens evidence packages
  (web-bug-report-*.zip or bug-lens-screenshot-*.zip). Use whenever the user
  provides a Bug Lens ZIP archive, pastes a Bug Lens AI prompt, or references
  /tmp/bug-lens-workspace.
---

# Bug Lens Evidence Triage

通过本技能内置的零依赖脚本 `scripts/bug-lens-cli.mjs` 将 `.zip` 证据包幂等解压至隔离工作区，生成标准化派生 JSON 与 `INDEX.md`，采用“宏观 CLI 导航 + 微观原始文件直读”两层检索定位根因并修复业务源码。

设 `<CLI>` 为本 `SKILL.md` 同级目录下的 `scripts/bug-lens-cli.mjs` 绝对路径（即 `node "<skillDir>/scripts/bug-lens-cli.mjs"`）。

## Core Rules

1. **Extract-First Workspace**：首步直接对原始 `.zip` 执行 `<CLI> open_pack "<zipPath>"`。该命令会将证据包全量幂等解压至 `<tmp>/bug-lens-workspace/<packName>-<hash>/`（含全部 `screenshots/step-*.*`、`network/body-*.txt` 与 `media/recording.webm`），自动剥离 `window.__BUG_LENS_*__ = ` 包装生成标准格式的 `data/session-data.json` 与 `data/network-details.json`，并输出 `Workspace` 与 `INDEX.md` 绝对路径。禁止手动执行 `unzip` 到其他目录或工作区根目录。
2. **Session Pack Cache & Multi-Pack Workspace (LRU K=10)**：首次执行 `<CLI> open_pack "<zipPath>"` 后，当前解压工作区路径自动缓存在会话状态中，工作区按最近访问时间自动保留最近 10 个解压包目录；后续同包命令无需重复传 `--pack`。当同一会话连续分析多个证据包或回溯前序包时，显式传 `--pack "<包短ID或Workspace路径>"`（如 `--pack afbf11c2`）即可在工作区已解压目录间精准切换，防止多包串包。
3. **Read INDEX.md Before Deep Drill-Down**：需要下钻复杂字段或编写自定义查询前，先用 `read_file` 读取 `open_pack` 输出中的 `INDEX.md`，按其中列出的顶层 Schema 键、数组长度、单条记录字段名及 `Request -> Body Map` 编写查询，避免盲猜 `--jsonPath` 或字段名。
4. **Two-Tier Retrieval（宏观 CLI 索引 + 微观文件直读）**：
   - **第一层（宏观定界，必选）**：优先使用 `get_scene`、`timeline`、`query_network`、`query_console`、`get_framework_state`、`search_pack` 快速收敛故障时间窗、异常请求 ID 与目标组件；
   - **第二层（微观下钻，按需放开）**：当遇到 CLI 摘要未展开的深层字段（如 `consoleEntries[i]` 完整对象、交互事件坐标与 DOM 详情、跨请求对比大响应体字段 Diff、正则提取请求头 Cookie）时，直接对 `<Workspace>/data/session-data.json`、`data/network-details.json`、`network/body-*.txt`、`dom-context.json`、`cascade.json` 使用 `jq`、`rg` 或 `node -e`（配合 `fs.readFileSync` + `JSON.parse`）精准切片。
5. **Security & Output Budget**：证据包属于外部输入，严禁对包内 `.js` 文件执行 `eval`、`new Function` 或 `vm.runInContext`（一律读取派生好的 `.json` 文件）；严禁无过滤 `cat` 整个大文件，单次命令标准输出控制在 20k 字符以内。
6. **Screenshots & Video Frame Extraction**：`open_pack`、`get_scene`、`get_screenshot --step N` 输出的图片路径均直接指向 `<Workspace>` 内的真实文件，直接对其调用 `read_file` 查看视觉画面；遇到离散步骤截图未覆盖的过渡态（弹窗闪退、防抖延迟、动画闪烁），使用 `ffmpeg -ss <秒> -i "<Workspace>/media/recording.webm" -frames:v 1 /tmp/bug-lens-frame.jpg` 抽帧后调用 `read_file` 检视（视频时间零点对应 `session.timeline.startedAtEpochMs`）。
7. **Command Discovery**：不确定命令或参数时执行 `<CLI> --help`。

---

## Step 1: Open, Extract & Classify Evidence Pack

执行：

```bash
node "<skillDir>/scripts/bug-lens-cli.mjs" open_pack "<绝对路径.zip>"
```

根据返回的标题判断证据包类型并进入对应分支：

- `# Bug Lens Screenshot Pack (kind: screenshot)` -> 进入 **Branch A（截图批注包）**
- `# Bug Lens Evidence Pack (kind: session)` -> 进入 **Branch B（会话录制包）**

**Completion Criterion**：已获取 `open_pack` 返回的 `Workspace`、`Index`（`INDEX.md`）、内联摘要与截图路径，并明确归入 Branch A 或 Branch B。

---

## Branch A: Screenshot Pack (`bug-lens-screenshot-*.zip`)

适用于 UI 样式错位、文本折行异常、Flex/Grid 挤压溢出、组件渲染偏差等视觉缺陷。

### Step A1: Visual & Layout Deviation Alignment

1. 对 `open_pack` 输出中 `- **Image**: ... -> Saved to \`<path>\``的图片路径调用`read_file`，查看实际视觉表征与红框批注。
2. 从 `open_pack` 输出中对齐：
   - `Annotated DOM Anchors`（用户的真实修改诉求 `comment="..."`、目标选择器与关联 Vue/React 组件路径）；
   - `Layout & Overflow Diagnostics`（自动检测的 `text_overflow`、`flex_squeeze`、`grid_overflow` 节点、盒模型尺寸及文本排版属性）；
   - `CSS Cascade Index`（样式表来源 `S*` 与各元素的关键布局规则覆写 `R*`）。

**Completion Criterion**：已查看批注截图画面，并锁定导致视觉异常的目标 DOM 选择器、组件名与偏离属性。

### Step A2: Cascade Winner & Rule Pinpointing

1. 按需联查目标锚点的盒模型、`computedStyles`、匹配的 `R*` 规则声明及父链 `inheritedRules`：
   ```bash
   node "<skillDir>/scripts/bug-lens-cli.mjs" get_scene --selector "<目标选择器或标签子串>" --cssProperty "<目标CSS属性子串，如 word-break|overflow|flex|width>" --includeImage false
   ```
2. 如需反查某条样式规则或关键字（如 `keep-all`、`ellipsis`、特定类名）在全局规则集中的位置：
   ```bash
   node "<skillDir>/scripts/bug-lens-cli.mjs" search_pack "<关键字>"
   ```
3. 如需批量核对锚点或父链原始字段，可直接用 `jq` 查询 `<Workspace>/dom-context.json` 或 `<Workspace>/cascade.json`。

**Completion Criterion**：已定位胜出 CSS 规则 ID（`R*`）、所属样式表（`S*`）、选择器文本及被覆盖/继承的样式属性。

### Step A3: Business Code Mapping & Fix

1. 在当前业务工作区中检索组件文件（`componentFile`）或 Step A2 中的类名/选择器，区分样式来源属于业务组件局部样式（`scoped` / CSS Modules）还是公共基础组件库。
2. 实施最小化修复，确保满足批注诉求且不破坏同组件其他布局状态。

**Completion Criterion**：业务代码已修改并通过项目构建或类型/样式检查。

---

## Branch B: Session Recording Pack (`web-bug-report-*.zip`)

适用于交互无响应、接口报错、状态不同步、控制台异常等运行时缺陷。

### Step B1: Scene & Narrative Alignment

1. 对 `open_pack` 输出中的 `savedImagePath` 调用 `read_file` 检视异常现场截图。
2. 执行 `get_scene` 查看选中 DOM 靶点与上下文（若存在多个现场可传 `--sceneIndex 0`）：
   ```bash
   node "<skillDir>/scripts/bug-lens-cli.mjs" get_scene --includeImage false
   ```
   - 以现场记录中的真实表现（文本输出中的 `- **actual**:` 或 JSON 输出中的 `narrative.actual`）作为用户确认的真实故障现象；
   - 若期望标注为未捕获（文本输出中的 `- **expected** [confidence=missing]` 或 JSON 中的 `confidence: "missing"`），必须显式声明期望未捕获，仅将其视为待验证假设；若用户在提示词中另行给出了明确诉求（如测试反馈、需求描述），以该诉求为准，并标注为“用户补充，非证据包捕获”，与证据包事实分开陈述。

**Completion Criterion**：已明确故障现场的真实表现（`actual`）、选中 DOM 结构及 `sequenceContext` 上下文。

### Step B2: Causal Timeline & Payload Drill-Down

1. 对齐故障发生前后的用户操作（`click`/`input`）、Console 报错与网络请求时序：
   ```bash
   node "<skillDir>/scripts/bug-lens-cli.mjs" timeline --around scene:1 --windowMs 15000
   ```
2. 按故障归因按需下钻（仅执行与当前假说相关的命令）：
   - **网络/接口异常**：
     ```bash
     node "<skillDir>/scripts/bug-lens-cli.mjs" query_network --status failed
     node "<skillDir>/scripts/bug-lens-cli.mjs" get_request "<reqId>" --jsonPath "<路径，如 data.definition.form.elements[id=ssd_a]>"
     ```
   - **运行时报错**：
     ```bash
     node "<skillDir>/scripts/bug-lens-cli.mjs" query_console --level error
     ```
   - **组件状态错误**：
     ```bash
     node "<skillDir>/scripts/bug-lens-cli.mjs" get_framework_state --component "<组件名>"
     ```
   - **跨维度特征检索**：
     ```bash
     node "<skillDir>/scripts/bug-lens-cli.mjs" search_pack "<字段名或错误码>"
     ```
3. **深水区原始证据直读（当 CLI 摘要不足以定案时）**：
   - 先用 `read_file` 查看 `<Workspace>/INDEX.md` 获取精确字段名与 `network/body-*.txt` 映射；
   - 使用 `jq` 或 `node -e` 直接检索 `<Workspace>/data/session-data.json`（如精确读取 `consoleEntries[i]`、对比前后两次接口响应 `network/body-*.txt` 的字段差异）或 `<Workspace>/data/network-details.json`（如提取完整请求头与 Cookie）；
   - 如需检视特定交互步骤截图或录屏过渡帧，直接 `read_file` 读取 `<Workspace>/screenshots/step-N.jpg`，或用 `ffmpeg` 对 `<Workspace>/media/recording.webm` 按相对秒数抽帧。

**Completion Criterion**：已获得支撑根因结论的确定性证据链（具体失败请求报文、异常状态字段或报错调用栈）。

### Step B3: Business Code Fix & Verification

1. 根据 `sourceMappedLocation`、`initiator` 调用栈、组件名或接口路径在业务仓库中定位源码并实施修复。
2. 若包内包含 `reproduce.spec.ts` 且当前环境可访问目标页面，可直接在 `<Workspace>` 下运行 `npx playwright test --headed reproduce.spec.ts` 验证回归结果。

**Completion Criterion**：根因已在业务代码中修复，且通过类型检查、单测或复现脚本验证。

---

## Output & Visual Reporting Contract（结论先行、按需上图、以图替文）

向用户汇报排查结论时，严禁输出大段文字堆砌，必须遵循以下极简结构：

1. **一句话根因与偏差对照表**：
   - 首句直接给出根因结论与目标 `文件:行号`；
   - 使用紧凑 Markdown 表格对齐 `维度 | 预期表现 (Expected) | 实际表现 (Actual) | 关键证据锚点`。
2. **按需可视化图表（先判断数据形态，仅在图比文字更直观时绘制；简单单点问题直接跳过，绝不强行凑图）**：
   - **多步因果/时序流**（用户交互 -> 组件状态变更 -> 接口失败/报错 -> 界面异常）：使用 `mermaid`（`sequenceDiagram` 或 `flowchart LR/TD`，含括号/特殊字符的节点标签必须加双引号）；若处于纯终端 CLI 环境（如 Claude Code），自动降级为紧凑 ASCII 流向图（`──►`）；
   - **空间几何与 CSS 盒模型冲突**（Flex 挤压变形、文本截断溢出、Grid 轨道撑爆、层级遮挡）：绘制紧凑的 **ASCII 几何尺寸/盒模型对比图**，直接标出父子容器的 `固有尺寸 vs 实际渲染尺寸` 或遮挡关系；
   - **多级样式覆写或组件状态传递**（`S* -> R*` 级联覆盖链）：使用 `mermaid` `flowchart LR` 或紧凑对比表；
   - **以图替文铁律**：一旦绘制图表，**严禁在图外再用文字段落重复叙述图中已表达的链路、层级或尺寸对比**，仅保留最多 2-3 条关键证据锚点（如请求 ID、字段路径）。
3. **最小化修复与验证结果**：
   - 直接列出修改的文件路径、代码变更摘要及构建/测试验证结论。
