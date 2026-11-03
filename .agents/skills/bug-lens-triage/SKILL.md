---
name: bug-lens-triage
description: >-
  Diagnose and fix frontend/fullstack bugs from Bug Lens evidence packages
  (web-bug-report-*.zip or bug-lens-screenshot-*.zip). Use whenever the user
  provides a Bug Lens ZIP archive, pastes a Bug Lens AI prompt, or references
  /tmp/bug-lens-workspace.
---

# Bug Lens Evidence Triage

通过本技能内置的零依赖脚本 `scripts/bug-lens-cli.mjs` 直接在内存中检索 `.zip` 证据包并映射至业务源码修复缺陷。

设 `<CLI>` 为本 `SKILL.md` 同级目录下的 `scripts/bug-lens-cli.mjs` 绝对路径（即 `node "<skillDir>/scripts/bug-lens-cli.mjs"`）。

## Core Rules

1. **Zero-Extraction CLI Inspection**：直接对原始 `.zip` 路径执行 `<CLI> open_pack "<zipPath>"`；忽略粘贴提示词中的 `mkdir -p /tmp/bug-lens-workspace && unzip` 降级解压指令，严禁手写 `node -e` / `vm` / `python` 临时脚本解析 `session-data.js`。
2. **Session Pack Cache**：首次执行 `<CLI> open_pack "<zipPath>"` 后，当前包路径会自动缓存在会话状态中；后续同包命令（`get_scene`、`timeline`、`query_console`、`query_network`、`get_request`、`get_framework_state`、`search_pack`、`read_pack_file`）均无需重复传 `--pack`。
3. **Auto-Exported Screenshot Viewing**：`open_pack` 与 `get_scene` 会自动将关键截图导出至系统临时目录并在输出中打印 `Saved to ...` 路径，直接对该图片路径调用 `read_file` 查看视觉画面与红框批注。

---

## Step 1: Open & Classify Evidence Pack

执行：

```bash
node "<skillDir>/scripts/bug-lens-cli.mjs" open_pack "<绝对路径.zip>"
```

根据返回的标题判断证据包类型并进入对应分支：

- `# Bug Lens Screenshot Pack (kind: screenshot)` -> 进入 **Branch A（截图批注包）**
- `# Bug Lens Evidence Pack (kind: session)` -> 进入 **Branch B（会话录制包）**

**Completion Criterion**：已获取 `open_pack` 返回的内联摘要与自动导出的截图路径，并明确归入 Branch A 或 Branch B。

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
   - 以 `narrative.actual` 作为用户确认的真实故障现象；
   - 若 `narrative.expected` 标注为 `confidence: missing`，必须显式声明期望未捕获，仅将其视为待验证假设。

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

**Completion Criterion**：已获得支撑根因结论的确定性证据链（具体失败请求报文、异常状态字段或报错调用栈）。

### Step B3: Business Code Fix & Verification

1. 根据 `sourceMappedLocation`、`initiator` 调用栈、组件名或接口路径在业务仓库中定位源码并实施修复。
2. 若包内包含 `reproduce.spec.ts` 且当前环境可访问目标页面，可执行 `extract_pack` 导出工作区并运行 `npx playwright test --headed reproduce.spec.ts` 验证回归结果。

**Completion Criterion**：根因已在业务代码中修复，且通过类型检查、单测或复现脚本验证。
