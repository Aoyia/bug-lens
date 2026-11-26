(function (root) {
  var ns = (root.BUG_LENS_SITE = root.BUG_LENS_SITE || {});

  ns.PROMPTS = {
    compact: {
      zh: `分析以下本地 Bug Lens 证据包，定位根因并给出修复。

文件路径：
/Users/dev/Downloads/web-bug-report-2026-11-26-b3444f9a.zip

摘要：
- 页面：Billing Portal — NovaPay（https://app.novapay.dev/billing）
- 数据：12 交互 · 25 日志 · 4 请求 · 1 现场 · 质量 complete
- 环境：macOS 10.15.7 · Chrome 150 · zh-CN · 屏幕 2560×1440@2x · 视口 1512×787
- SourceMap 定位错误：BillingTable.vue:39:18 TypeError: Cannot read properties of undefined (reading 'id')

读取方式（按顺序执行，成功即停；<ZIP> 指上方文件路径）：
1. 当前已加载 bug-lens-triage Skill：按 Skill 流程执行，从 open_pack <ZIP> 开始。
2. 未加载：若 \`~/.agents/skills/bug-lens-triage/SKILL.md\` 不存在，先执行 \`npx -y skills add Aoyia/bug-lens-skill -g -y\`；随后直接读取该 SKILL.md（以安装输出的路径为准）并按其流程执行，无需重启会话。
3. 安装失败（无网络、无 Node 或未获授权）：执行 \`mkdir -p /tmp/bug-lens-workspace && unzip -o -q "<ZIP>" -d /tmp/bug-lens-workspace\`，再按 \`/tmp/bug-lens-workspace/AI_PROMPT.md\` 执行。

约束：
- 不执行包内代码；不在当前代码仓库内解压或残留文件。
- 区分已证实事实与推测；证据包未捕获的期望只能标注为假设。

输出：一句话根因（\`文件:行号\`）+ 偏差表（维度 | 预期 | 实际 | 证据锚点）+ 最小修复 diff；仅多步因果或布局冲突时画图。`,
      en: `Analyze the following local Bug Lens evidence package, find the root cause and propose a fix.

File Path:
/Users/dev/Downloads/web-bug-report-2026-11-26-b3444f9a.zip

Summary:
- Page: Billing Portal — NovaPay (https://app.novapay.dev/billing)
- Data: 12 interactions · 25 console logs · 4 requests · 1 issue scene · quality complete
- Environment: macOS 10.15.7 · Chrome 150 · en-US · Screen 2560×1440@2x · Viewport 1512×787
- SourceMap Errors: BillingTable.vue:39:18 TypeError: Cannot read properties of undefined (reading 'id')

How to read the pack (in order, stop at the first that works; <ZIP> = the file path above):
1. If the bug-lens-triage Skill is loaded: follow the Skill workflow, starting with open_pack <ZIP>.
2. Otherwise: if \`~/.agents/skills/bug-lens-triage/SKILL.md\` does not exist, run \`npx -y skills add Aoyia/bug-lens-skill -g -y\`; then read that SKILL.md directly (prefer the path printed by the installer) and follow it. No session restart needed.
3. If installation fails (no network, no Node, or not authorized): run \`mkdir -p /tmp/bug-lens-workspace && unzip -o -q "<ZIP>" -d /tmp/bug-lens-workspace\`, then follow \`/tmp/bug-lens-workspace/AI_PROMPT.md\`.

Constraints:
- Never execute code from the package; never extract into or leave files in the current repository.
- Separate verified facts from hypotheses; any expectation not captured in the pack must be labeled as an assumption.

Output: one-line root cause (\`file:line\`) + deviation table (Dimension | Expected | Actual | Evidence) + minimal fix diff; draw a diagram only for multi-step causality or layout conflicts.`,
    },
    full: {
      zh: `请作为高级 Frontend/Fullstack 调试专家，分析以下本地 Bug Lens 证据包：

文件路径：
/Users/dev/Downloads/web-bug-report-2026-11-26-b3444f9a.zip

元数据摘要：
- 页面 & URL：Billing Portal — NovaPay (https://app.novapay.dev/billing)
- 证据数据：12 次交互 | 25 条日志 | 4 个请求 | 1 个异常现场 | 质量: complete
- 运行环境：macOS 10.15.7 · Chrome 150 · zh-CN · 屏幕 2560×1440@2x · 视口 1512×787

【工作区准备（严禁解压在当前代码工程目录内，使用固定单例目录覆盖以实现 O(1) 存储占用）】
- 首选方式（已安装 \`bug-lens-triage\` Skill 时）：直接使用该技能配套的原生 \`"<skillDir>/bin/bug-lens-cli" open_pack "/Users/dev/Downloads/web-bug-report-2026-11-26-b3444f9a.zip"\` 将证据包幂等解压至隔离工作区，自动生成标准格式的 \`data/session-data.json\`、\`data/network-details.json\` 与 \`INDEX.md\`；先用 \`get_scene\`、\`timeline\`、\`query_network\`、\`get_request\`、\`get_framework_state\`、\`get_screenshot\` 宏观定位，深水区结合 \`INDEX.md\` 直接对 \`data/*.json\` 与 \`network/body-*.txt\` 使用 \`jq\` 或 \`JSON.parse\` 切片下钻。
- 降级解压命令（仅当未安装 \`bug-lens-triage\` Skill 时执行；可先执行 \`npx skills add Aoyia/bug-lens-skill -g -y\` 一键安装）：
  mkdir -p /tmp/bug-lens-workspace && unzip -o -q "/Users/dev/Downloads/web-bug-report-2026-11-26-b3444f9a.zip" -d /tmp/bug-lens-workspace

请按以下第一性链式逻辑展开排查：
1. 现场定位：优先读取 \`data/session-data.json\` 与 \`INDEX.md\` 中的 \`issueScenes[].scene.narrative.actual\`，结合 \`issues/\` 截图与 DOM 样式分析现场。
2. 期望锚点：读取 \`issueScenes[].scene.narrative.expected\`；若 \`confidence: "missing"\`，必须显式标注推断假设。
3. 异常收敛：对齐时间轴，检索交叉点附近的 Console 报错与 Network 失败请求（4xx/5xx/CORS/Timeout）。
4. 根因推导与修复：结合 \`frameworkStates[]\` 检查组件 props/state 与框架源码位置，并用 \`reproduce.spec.ts\` 进行修复回放验证。

[输出格式（结论先行、按需上图、以图替文）]
1. 一句话根因与偏差对照表（维度 | 预期表现 | 实际表现 | 关键证据锚点）
2. 按需可视化证据链（\`mermaid\` 时序图或 ASCII 盒模型对比图）
3. 建议修复方案与代码位置 (Recommended Fix)`,
      en: `Please act as a Senior Frontend/Fullstack Debugging Expert and analyze the following local Bug Lens evidence package:

File Path:
/Users/dev/Downloads/web-bug-report-2026-11-26-b3444f9a.zip

Metadata Summary:
- Page & URL: Billing Portal — NovaPay (https://app.novapay.dev/billing)
- Evidence Data: 12 interactions | 25 console logs | 4 network requests | 1 issue scene | Quality: complete
- Environment: macOS 10.15.7 · Chrome 150 · en-US · Screen 2560×1440@2x · Viewport 1512×787

[Workspace Setup (Do NOT extract into active project directory; overwrite singleton directory for O(1) storage)]
- Preferred (when \`bug-lens-triage\` Skill is installed): Run the native \`"<skillDir>/bin/bug-lens-cli" open_pack "/Users/dev/Downloads/web-bug-report-2026-11-26-b3444f9a.zip"\` to idempotently extract the pack to an isolated workspace, generate plain \`data/session-data.json\` & \`data/network-details.json\` plus \`INDEX.md\`, and query with \`get_scene\`, \`timeline\`, \`query_network\`, \`get_request\`, \`get_framework_state\`, \`get_screenshot\` or \`jq\`.
- Fallback Extraction Command (only when \`bug-lens-triage\` Skill is unavailable; install via \`npx skills add Aoyia/bug-lens-skill -g -y\`):
  mkdir -p /tmp/bug-lens-workspace && unzip -o -q "/Users/dev/Downloads/web-bug-report-2026-11-26-b3444f9a.zip" -d /tmp/bug-lens-workspace

Please follow this first-principles chain of diagnosis:
1. Scene Alignment: Prioritize reading \`data/session-data.json\` and \`INDEX.md\` for \`issueScenes[].scene.narrative.actual\`, combined with \`issues/\` screenshots and DOM styles.
2. Expected Anchor: Read \`issueScenes[].scene.narrative.expected\`; when \`confidence: "missing"\`, explicitly mark any inferred expectation as a hypothesis.
3. Anomaly Convergence: Align timeline to correlate Console errors and failed Network requests (4xx/5xx/CORS/Timeout).
4. Root Cause & Remediation: Inspect React/Vue component \`frameworkStates[]\` and verify fixes with \`reproduce.spec.ts\` via Playwright.

[Output Format (Conclusion-First, On-Demand Visuals, Replace Text with Diagrams)]
1. One-Line Root Cause & Deviation Table (Dimension | Expected | Actual | Evidence)
2. On-Demand Visual Evidence Chain (\`mermaid\` sequence/flow or ASCII box diagram)
3. Minimal Fix & File Locations`,
    },
  };

  ns.I18N = {
    zh: {
      pageTitle: "Bug Lens — 从 Bug 现场到 AI 修复，只需 3 秒",
      navWorkflow: "工作流",
      navCapabilities: "核心能力",
      navAgentSkill: "Agent Skill",
      navChangelog: "更新日志",
      navFaq: "FAQ",
      navMenuAria: "打开导航菜单",
      heroVersionBadgePrefix: "现已上线 · 查看更新日志",
      heroTitle: '从 Bug 复现到 <span class="hl">AI 修复</span><br />只需 3 秒',
      heroSub:
        "一键录制或独立截图标注，自动捕获操作轨迹、React/Vue 组件状态、Console 报错与网络报文，生成可直接交付给 Cursor、Claude Code 与 Antigravity 的结构化 Prompt 与离线证据包。",
      effOldLabel: "传统排障",
      effOldTime: "5 min",
      effOldDesc: "截屏 ➔ 翻控制台 ➔ 复制报文 ➔ 手写长 Prompt",
      effNewLabel: "Bug Lens",
      effNewTime: "3 sec",
      effNewDesc: "录制或截图 ➔ 导出并自动复制 ➔ 粘贴给 AI 秒修",
      ctaStore: "安装 Chrome 扩展",
      ctaStoreEdge: "安装 Edge 扩展",
      ctaSource: "GitHub 源码",
      altChromeStore: "Chrome 应用商店",
      altEdgeStore: "Microsoft Edge 商店",
      altOfflineZip: "离线安装包 (.zip)",
      demoPlayerTag:
        "20 秒全闭环演示：网页捕获 ➔ 500 报错现场 ➔ IDE 直接采纳修复",
      demoFallback: "您的浏览器暂不支持 HTML5 视频播放。",
      wfEyebrow: "4-Step Workflow",
      wfTitle: "4 步完成从现场捕获到代码修复",
      wfSubtitle:
        "无需配置后端或额外 CLI，安装扩展即可开箱完成「录制 / 截图 → 预览策展 → 粘贴 Prompt → 采纳补丁」闭环。",
      bmTag: "v0.7.44 实操闭环",
      t1Title: "Step 01. 一键录制或独立截图标注",
      t1Badge: "现场捕获",
      t1Desc:
        "录制模式下自动采集点击红圈、Console、网络请求与组件状态（Option/Alt+S 快捷标记异常现场）；无需录屏时可用独立截图工具框选测量、画箭头并添加中英批注。",
      tabShotAnnotation: "独立截图标注",
      tabShotPopup: "扩展录制配置面板",
      shotCaptionAnnotation:
        "框选像素尺寸测量、箭头指示与流式发光描边文字批注，直接描述前端视觉或交互修改诉求。",
      shotCaptionPopup:
        "一键启动录制或截图，按需勾选视频/控制台/网络/响应体/框架状态，默认开启安全脱敏模式。",
      t2Title: "Step 02. 可视化预览策展与 ZIP 打包",
      t2Badge: "离线归档",
      t2Desc:
        "在证据预览工作区审查时间轴、删改冗余步骤或截图、生成 Playwright 复现脚本；点击导出自动下载离线 ZIP 并将 AI 提示词写入剪贴板。",
      t2Caption:
        "实机证据预览工作区：左侧视频/时间轴回放可拖拽分栏，右侧展示稳定度评分的 Playwright 定位器与网络状态。",
      treeLabel: "导出离线证据包结构",
      ftPrompt: "结构化 AI 诊断提示词与工作区指引",
      ftReport: "严格 CSP 可双击打开的离线可交互报告",
      ftSession: "交互时间轴、Console、框架状态与问题现场",
      ftNetwork: "完整请求头、响应体与调用栈详情",
      ftRepro: "带稳定性评分的 Playwright 自动复现脚本",
      t3Title: "Step 03. 自动复制双语 Prompt 交付大模型",
      t3Badge: "AI 提示词",
      t3Desc:
        "支持精简路由（Compact，节省上下文 Token）与完整指引（Full）两种模板，中英双语与宿主系统命令自动适配，导出即写入剪贴板。",
      tabPromptCompact: "Compact 精简路由（推荐）",
      tabPromptFull: "Full 完整提示词",
      btnCopyPrompt: "复制示例 AI 提示词",
      btnCopied: "已复制到剪贴板！",
      btnCopyFailed: "复制失败，请手动复制",
      t4Title: "Step 04. 根因收敛与最小修复 Accept",
      t4Badge: "精准修复",
      t4Desc:
        "AI 依据时间戳交叉比对 500 响应报文、组件响应式状态与 SourceMap 定位到 src/components/BillingTable.vue:39，输出结论先行报告与最小化代码补丁：",
      capEyebrow: "Capabilities",
      capTitle: "面向 AI 时代的完整前端现场能力",
      capSubtitle:
        "不仅是一键录屏，而是围绕「可复现、可定位、可策展、绝对私密」构建的全链路调试证据引擎。",
      c1Tag: "全维度对齐",
      c1t: "统一时序证据链",
      c1d: "将点击红圈截图、DOM 样式、Console 错误堆栈、XHR/Fetch 报文与 Tab 录屏精准对齐至同一毫秒级时间轴。",
      c2Tag: "框架源码探针",
      c2t: "React / Vue 源码与状态解包",
      c2d: "高精度还原 Vue 2、Vue 3 与 React 组件源码文件路径与行号，深度捕获触发异常前后的 Props 与响应式 State 快照。",
      c3Tag: "无需录屏",
      c3t: "独立截图标注工具",
      c3d: "使用 Option/Alt+X 随时框选网页区域，支持像素尺寸测量、划线箭头与流式自动折行发光批注，快速向 AI 描述 UI 调整。",
      c4Tag: "移动端与跨 Tab",
      c4t: "DevTools 仿真与多标签追踪",
      c4d: "专门适配 Chrome DevTools 移动端模拟：贴边磁吸胶囊、真实缩放比裁剪与 Pointer Events；录制期间自动追踪衍生新标签页。",
      c5Tag: "可控交付",
      c5t: "工单交互策展与离线报告",
      c5d: "预览页支持删改步骤、移除截图、撤回重做、左右分栏拖拽持久化，以及在严格 CSP 下 file:// 双击即开的离线 HTML 报告。",
      c6Tag: "零外部上传",
      c6t: "100% 本地私密与自动脱敏",
      c6d: "无任何后端服务器。所有录制与打包均在本地浏览器完成，安全模式自动脱敏 Authorization、Cookie、密码框与敏感缓存。",
      skillEyebrow: "Agent Skill & Native CLI · 可选进阶",
      skillTitle: "为 AI Agent 打造的原生 Rust Triage 引擎",
      skillDesc:
        "扩展本身已可独立运行；如果你使用 Claude Code、Cursor、Codex 或 Antigravity，只需安装官方 bug-lens-triage Skill 与原生 Rust CLI，AI 即可直接流式解压并按需索引大型 ZIP 证据包，彻底告别临时解析脚本。",
      skillP1:
        "2.49 MB 单一原生二进制（零外部依赖），流式防 Zip Bomb 与原子工作区切换",
      skillP2:
        "自动生成标准 data/*.json 与 INDEX.md，完整提取顶层 requestBody 与 error",
      skillP3:
        "5 大桌面平台预编译分发（macOS / Linux / Windows），SHA-256 校验安装",
      perfStatusBadge: "BENCHMARK · NATIVE RUST TRIAGE ENGINE",
      perfFootnote:
        "13.5 MB 真实录屏包 · 4,843 日志 · 522 请求 · 6.20 MB JSON · 5 次中位数",
      perfKpi1Title: "网络下钻提速",
      perfKpi2Title: "时序聚合提速",
      perfKpi3Title: "查询峰值内存",
      perfKpi4Title: "AI 上下文裁剪",
      perfRuntimeTitle: "运行时对比 · Rust CLI vs Node.js",
      perfLegendRust: "Rust CLI",
      perfLegendJs: "Legacy JS",
      perfM1Name: "解压建索引峰值内存 (open_pack RSS)",
      perfM1Gain: "-70% RAM",
      perfM2Name: "网络下钻耗时 (query_network)",
      perfM2Gain: "4.2× 更快",
      perfM3Name: "时间轴聚合耗时 (timeline)",
      perfM3Gain: "3.4× 更快",
      perfM4Name: "下钻查询峰值内存 (query_network RSS)",
      perfM4Gain: "-74% RAM",
      perfContextTitle: "分层索引上下文过滤率",
      perfRingSub: "无关噪音已滤除",
      perfBreakOpen: "全局概览与索引",
      perfBreakTimeline: "核心时序主线",
      perfBreakNet: "网络摘要切片",
      perfCtxBefore: "原始全量 JSON: 6.20 MB",
      perfCtxAfter: "CLI 三步合计: 24.5 KB (0.39%)",
      skillOsMac: "macOS / Linux",
      skillOsWin: "Windows (PowerShell)",
      skillStep1Label:
        "1. 全局安装诊断 Skill（支持 Claude Code / Cursor / Antigravity 等）",
      skillStep2Label:
        "2. 一次性安装原生 Rust CLI（GitHub Releases 下载 + SHA-256 校验）",
      cliCopy: "复制",
      cliCopied: "已复制",
      changelogEyebrow: "Releases & Activity",
      changelogTitle: "版本演进与动态",
      changelogDesc:
        "持续高频迭代，同步适配最新前端框架、移动端仿真调试与 AI Agent 工作流。",
      changelogViewAllPrefix: "查看全部历史动态",
      changelogHistoryText: "查看全部版本",
      tagLatest: "最新",
      drawerEyebrow: "Releases & Activity",
      drawerTitle: "版本演进与动态",
      drawerHistoryLabel: "历史迭代",
      closeAria: "关闭更新日志",
      changelogMore: "在 GitHub 上查看完整发布历史 →",
      faqEyebrow: "FAQ",
      faqTitle: "常见问题",
      q1: "Bug Lens 会把我的数据上传到服务器吗？",
      a1: "不会。Bug Lens 是一款 100% 本地运行的 Chrome 扩展，没有任何后端服务器。所有录制、日志解析与打包导出均在本地浏览器内完成；开启安全模式后还会自动脱敏 Authorization、Cookie、密码字段与敏感本地存储。",
      q2: "导出的 ZIP 证据包包含哪些内容？",
      a2: "包含可直接粘贴给大模型的 AI_PROMPT.md、双击即可离线查看的 report.html、点击红圈及问题现场截图、DOM 样式与框架状态快照（data/session-data.js）、网络详情（data/network-details.js）、Playwright 复现脚本（reproduce.spec.ts）以及 WebM 录屏。",
      q3: "一定要安装 bug-lens-triage Skill 或 Rust CLI 才能用吗？",
      a3: "不需要。安装 Chrome 扩展即可开箱使用全部录制、截图标注、离线报告与 AI Prompt 导出功能；bug-lens-triage Skill 与原生 Rust CLI 是可选的进阶加速组件，能让支持的 AI 编程助手更高效地流式索引大型证据包。",
      q4: "支持哪些 AI 工具和前端技术栈？",
      a4: "导出提示词兼容任意 AI 编程工具与对话助手（Cursor、Claude Code、Codex、Antigravity、Windsurf 等）；网页捕获适用于所有 Web 应用，并对 Vue 2、Vue 3 与 React 提供组件源码文件路径及响应式状态深度解析。",
      q5: "对浏览器版本有什么要求？常用快捷键是什么？",
      a5: "最低要求 Chrome / Edge 125+（Manifest V3）。默认快捷键：Cmd/Ctrl+Shift+Y 打开控制面板，Option/Alt+R 一键开始录制，Option/Alt+X 独立截图标注，录制中按 Option/Alt+S 快速标记异常现场（可在扩展设置页自定义）。",
      footerSource: "GitHub 仓库",
      footerPrivacy: "隐私政策",
      footerDiscussions: "技术讨论",
      footerIssues: "反馈缺陷",
      footerCommunity: "微信交流群",
      footerLicense: "AGPL-3.0 开源协议",
    },
    en: {
      pageTitle: "Bug Lens — From Bug Scene to AI Fix in 3 Seconds",
      navWorkflow: "Workflow",
      navCapabilities: "Capabilities",
      navAgentSkill: "Agent Skill",
      navChangelog: "Changelog",
      navFaq: "FAQ",
      navMenuAria: "Toggle navigation menu",
      heroVersionBadgePrefix: "is Live · See Changelog",
      heroTitle:
        'From Bug Scene to <span class="hl">AI Fix</span><br />In 3 Seconds',
      heroSub:
        "Record interactions or annotate screenshots in one click — automatically capturing click trails, React/Vue component state, console stacks, and network payloads into structured AI prompts and offline evidence packs for Cursor, Claude Code, and Antigravity.",
      effOldLabel: "Old Way",
      effOldTime: "5 min",
      effOldDesc: "Screenshot ➔ Dig Console ➔ Copy Payloads ➔ Draft Prompt",
      effNewLabel: "Bug Lens",
      effNewTime: "3 sec",
      effNewDesc: "Record or Snap ➔ Export & Auto-Copy ➔ Paste to AI",
      ctaStore: "Install for Chrome",
      ctaStoreEdge: "Install for Edge",
      ctaSource: "View Source on GitHub",
      altChromeStore: "Chrome Web Store",
      altEdgeStore: "Microsoft Edge Add-ons",
      altOfflineZip: "Offline ZIP",
      demoPlayerTag:
        "20s End-to-End Demo: Browser Capture ➔ 500 Error ➔ IDE Fix Accepted",
      demoFallback: "Your browser does not support HTML5 video playback.",
      wfEyebrow: "4-Step Workflow",
      wfTitle: "From Runtime Scene to Accepted Fix in 4 Steps",
      wfSubtitle:
        "Zero backend or CLI setup required to start — install the extension for an instant capture, curate, prompt, and patch loop.",
      bmTag: "v0.7.44 End-to-End Loop",
      t1Title: "Step 01. One-Click Record or Standalone Screenshot",
      t1Badge: "Scene Capture",
      t1Desc:
        "Recording automatically captures click ripples, console logs, network traffic, and framework state (press Option/Alt+S to mark issue scenes). Or trigger standalone screenshot annotation anytime with pixel measurements, arrows, and flow-wrapped notes.",
      tabShotAnnotation: "Screenshot Annotation",
      tabShotPopup: "Extension Control Panel",
      shotCaptionAnnotation:
        "Measure bounding regions in pixels, point with arrows, and add halo-stroked notes directly on the page for UI or behavior fixes.",
      shotCaptionPopup:
        "Start recording or snap a screenshot in one click; toggle Video, Console, Network, Response Bodies, and Framework State with Safe Mode enabled by default.",
      t2Title: "Step 02. Visual Curation & Offline ZIP Export",
      t2Badge: "Evidence Archive",
      t2Desc:
        "Review the timeline in the Preview Workspace, remove or edit steps and screenshots with undo/redo, inspect Playwright locators, and export a self-contained ZIP with the AI prompt copied to your clipboard.",
      t2Caption:
        "Evidence Preview Workspace: draggable split layout pairing video/timeline playback with stability-scored Playwright locators and network state.",
      treeLabel: "Exported Archive Layout",
      ftPrompt: "Structured AI prompt & workspace setup guide",
      ftReport: "Strict-CSP offline interactive HTML report",
      ftSession: "Timeline, console, framework state & issue scenes",
      ftNetwork: "Full headers, payloads & initiator call stacks",
      ftRepro: "Stability-scored Playwright reproduction script",
      t3Title: "Step 03. Auto-Copied Bilingual Prompt for Any LLM",
      t3Badge: "AI Prompt",
      t3Desc:
        "Switch between Compact (token-saving Skill/CLI router) and Full templates with OS-aware extraction commands, copied automatically upon export.",
      tabPromptCompact: "Compact Router (Recommended)",
      tabPromptFull: "Full Prompt",
      btnCopyPrompt: "Copy Sample AI Prompt",
      btnCopied: "Copied to Clipboard!",
      btnCopyFailed: "Copy failed — select text manually",
      t4Title: "Step 04. Root-Cause Pinpointing & Minimal Fix Diff",
      t4Badge: "Bug Fixed",
      t4Desc:
        "Correlating the HTTP 500 payload, reactive component state, and SourceMap stack, the AI pinpoints src/components/BillingTable.vue:39 and produces a minimal patch:",
      capEyebrow: "Capabilities",
      capTitle: "Built for High-Signal AI Debugging",
      capSubtitle:
        "More than a screen recorder — a deterministic, inspectable, and privacy-first runtime evidence engine.",
      c1Tag: "Unified Timeline",
      c1t: "Millisecond-Aligned Evidence",
      c1d: "Correlates red-ring click screenshots, DOM styles, console stacks, XHR/Fetch traffic, and tab video on a single chronological timeline.",
      c2Tag: "Framework Probes",
      c2t: "React & Vue Source Unboxing",
      c2d: "Resolves exact Vue 2, Vue 3, and React component file paths and line numbers while capturing props and reactive state snapshots.",
      c3Tag: "No Recording Needed",
      c3t: "Standalone Screenshot Annotator",
      c3d: "Press Option/Alt+X on any page to crop regions, inspect pixel dimensions, draw arrows, and add high-contrast halo-stroked labels.",
      c4Tag: "Mobile & Multi-Tab",
      c4t: "DevTools Emulation & Derived Tabs",
      c4d: "Tailored for Chrome DevTools mobile emulation with edge-docked pills, physical scale cropping, Pointer Events, and automatic derived-tab tracking.",
      c5Tag: "Curated Delivery",
      c5t: "Interactive Ticket Curation & CSP Reports",
      c5d: "Edit descriptions, drop noisy steps or screenshots with undo/redo, drag-resize split panes, and open offline reports via file:// under strict CSP.",
      c6Tag: "Zero Telemetry",
      c6t: "100% Local & Auto-Sanitized",
      c6d: "Zero backend servers. All capture and ZIP packaging run strictly in-browser with automatic masking of Authorization headers, Cookies, and passwords.",
      skillEyebrow: "Agent Skill & Native CLI · Optional Power-Up",
      skillTitle: "Native Rust Triage Engine for AI Agents",
      skillDesc:
        "The Chrome extension works standalone out of the box. For Claude Code, Cursor, Codex, or Antigravity users, installing the bug-lens-triage Skill unlocks a native Rust CLI so agents stream-extract and query large evidence packs without ad-hoc scripts.",
      skillP1:
        "Single 2.49 MB native binary (zero runtime deps) with streaming zip-bomb protection & atomic swaps",
      skillP2:
        "Generates clean data/*.json and INDEX.md with full top-level requestBody & error extraction",
      skillP3:
        "Prebuilt binaries for 5 desktop targets (macOS / Linux / Windows) with SHA-256 verified installers",
      perfStatusBadge: "BENCHMARK · NATIVE RUST TRIAGE ENGINE",
      perfFootnote:
        "13.5 MB real pack · 4,843 logs · 522 requests · 6.20 MB JSON · 5-run median",
      perfKpi1Title: "Network Query Speedup",
      perfKpi2Title: "Timeline Speedup",
      perfKpi3Title: "Query Peak RAM",
      perfKpi4Title: "AI Context Cut",
      perfRuntimeTitle: "Runtime · Rust CLI vs. Node.js",
      perfLegendRust: "Rust CLI",
      perfLegendJs: "Legacy JS",
      perfM1Name: "Extract & Index Peak RAM (open_pack RSS)",
      perfM1Gain: "-70% RAM",
      perfM2Name: "Network Query Latency (query_network)",
      perfM2Gain: "4.2× faster",
      perfM3Name: "Timeline Latency (timeline)",
      perfM3Gain: "3.4× faster",
      perfM4Name: "Query Peak RAM (query_network RSS)",
      perfM4Gain: "-74% RAM",
      perfContextTitle: "Scoped Context Filtering Ratio",
      perfRingSub: "Noise filtered out",
      perfBreakOpen: "Overview & INDEX.md",
      perfBreakTimeline: "Chronological spine",
      perfBreakNet: "Network slice",
      perfCtxBefore: "Raw full JSON: 6.20 MB",
      perfCtxAfter: "3-step CLI total: 24.5 KB (0.39%)",
      skillOsMac: "macOS / Linux",
      skillOsWin: "Windows (PowerShell)",
      skillStep1Label:
        "1. Install the triage Skill globally (Claude Code / Cursor / Antigravity, etc.)",
      skillStep2Label:
        "2. Install the native Rust CLI once (GitHub Releases + SHA-256 verification)",
      cliCopy: "Copy",
      cliCopied: "Copied!",
      changelogEyebrow: "Releases & Activity",
      changelogTitle: "Changelog & Activity",
      changelogDesc:
        "Iterating relentlessly across modern web frameworks, mobile emulation, and AI agent workflows.",
      changelogViewAllPrefix: "View All Release History",
      changelogHistoryText: "View All Releases",
      tagLatest: "Latest",
      drawerEyebrow: "Releases & Activity",
      drawerTitle: "Release Notes & Milestones",
      drawerHistoryLabel: "Historical Releases",
      closeAria: "Close Changelog",
      changelogMore: "View Complete Release History on GitHub →",
      faqEyebrow: "FAQ",
      faqTitle: "Frequently Asked Questions",
      q1: "Does Bug Lens upload my data to any server?",
      a1: "No. Bug Lens runs 100% locally inside your browser with zero backend servers. Safe Mode also automatically masks sensitive tokens such as Authorization headers, Cookies, password fields, and storage entries.",
      q2: "What is included in the exported ZIP evidence pack?",
      a2: "It includes AI_PROMPT.md for LLMs, an interactive offline report.html, red-ring click & issue screenshots, DOM/framework snapshots (data/session-data.js), full network details (data/network-details.js), a Playwright script (reproduce.spec.ts), and WebM video.",
      q3: "Do I have to install the bug-lens-triage Skill or Rust CLI?",
      a3: "No. The extension works completely standalone with zero CLI setup. The bug-lens-triage Skill and native Rust CLI are an optional power-up for AI coding agents to inspect large ZIP archives faster with lower memory and token overhead.",
      q4: "Which AI assistants and web frameworks are supported?",
      a4: "Exported prompts work with Cursor, Claude Code, Codex, Antigravity, Windsurf, and any LLM chat. Capture works on all websites, with dedicated component source path and reactive state probes for Vue 2, Vue 3, and React.",
      q5: "What Chrome version and shortcuts are supported?",
      a5: "Requires Chrome / Edge 125 or newer (Manifest V3). Default shortcuts: Cmd/Ctrl+Shift+Y opens the popup, Option/Alt+R starts recording, Option/Alt+X triggers standalone screenshot annotation, and Option/Alt+S marks an issue scene during recording (customizable in Options).",
      footerSource: "GitHub Repository",
      footerPrivacy: "Privacy Policy",
      footerDiscussions: "Discussions",
      footerIssues: "Report Issue",
      footerCommunity: "WeChat Group",
      footerLicense: "AGPL-3.0 License",
    },
  };
})(window);
