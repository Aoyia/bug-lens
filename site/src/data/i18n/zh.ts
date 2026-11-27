import type { SiteCopy } from "./types";

export const ZH_COPY: SiteCopy = {
  htmlLang: "zh-CN",
  ogLocale: "zh_CN",
  ogLocaleAlt: "en_US",
  pageTitle: "Bug Lens — 从 Bug 现场到 AI 修复，只需 3 秒",
  metaDescription:
    "Bug Lens 是一款 100% 本地运行的 Chrome 扩展：一键录制或截图标注，自动捕获操作轨迹、React/Vue 组件状态、Console 报错与网络报文，生成可直接交付 AI 编程助手的结构化提示词与离线证据包。",
  ogTitle: "Bug Lens — 从 Bug 复现到 AI 修复，只需 3 秒",
  ogDescription:
    "100% 本地捕获浏览器交互轨迹、React/Vue 组件状态、Console 报错与网络报文，一键导出结构化 AI 提示词与离线证据包。",
  twitterTitle: "Bug Lens — 从 Bug 复现到 AI 修复，只需 3 秒",
  twitterDescription:
    "专为 Cursor、Claude Code、Codex 与 Antigravity 打造的浏览器 Bug 现场录制与截图标注 Chrome 扩展。",

  navAria: "主导航",
  navWorkflow: "工作流",
  navCapabilities: "核心能力",
  navAgentSkill: "Agent Skill",
  navChangelog: "更新日志",
  navFaq: "FAQ",
  navMenuAria: "打开导航菜单",
  langSwitchLabel: "EN",
  langSwitchAria: "Switch to English",

  heroVersionBadgePrefix: "现已上线 · 查看更新日志",
  heroTitleHtml: '从 Bug 复现到 <span class="hl">AI 修复</span><br />只需 3 秒',
  heroTitlePlain: "从 Bug 复现到 AI 修复，只需 3 秒",
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
  demoPlayerTag: "20 秒全闭环演示：网页捕获 ➔ 500 报错现场 ➔ IDE 直接采纳修复",
  demoFallback: "您的浏览器暂不支持 HTML5 视频播放。",

  wfEyebrow: "4-Step Workflow",
  wfTitle: "4 步完成从现场捕获到代码修复",
  wfSubtitle:
    "无需配置后端或额外 CLI，安装扩展即可开箱完成「录制 / 截图 → 预览策展 → 粘贴 Prompt → 采纳补丁」闭环。",
  bmTagPrefix: "实操闭环",
  captureTabsAria: "捕获视图切换",
  t1Title: "Step 01. 一键录制或独立截图标注",
  t1Badge: "现场捕获",
  t1Desc:
    "录制模式下自动采集点击红圈、Console、网络请求与组件状态（Option/Alt+S 快捷标记异常现场）；无需录屏时可用独立截图工具框选测量、画箭头并添加中英批注。",
  tabShotAnnotation: "独立截图标注",
  tabShotPopup: "扩展录制配置面板",
  shotAltAnnotation: "Bug Lens 独立截图标注",
  shotCaptionAnnotation:
    "框选像素尺寸测量、箭头指示与流式发光描边文字批注，直接描述前端视觉或交互修改诉求。",
  shotAltPopup: "Bug Lens 扩展控制面板",
  shotCaptionPopup:
    "一键启动录制或截图，按需勾选视频/控制台/网络/响应体/框架状态，默认开启安全脱敏模式。",
  t2Title: "Step 02. 可视化预览策展与 ZIP 打包",
  t2Badge: "离线归档",
  t2Desc:
    "在证据预览工作区审查时间轴、删改冗余步骤或截图、生成 Playwright 复现脚本；点击导出自动下载离线 ZIP 并将 AI 提示词写入剪贴板。",
  t2ImgAlt: "Bug Lens 证据预览工作区",
  t2Caption:
    "实机证据预览工作区：左侧视频/时间轴回放可拖拽分栏，右侧展示稳定度评分的 Playwright 定位器与网络状态。",
  archiveSampleName: "web-bug-report-b3444f9a.zip",
  treeLabel: "导出离线证据包结构",
  fileTree: [
    {
      name: "AI_PROMPT.md",
      desc: "结构化 AI 诊断提示词与工作区指引",
    },
    {
      name: "report.html",
      desc: "严格 CSP 可双击打开的离线可交互报告",
    },
    {
      name: "data/session-data.js",
      desc: "交互时间轴、Console、框架状态与问题现场",
    },
    {
      name: "data/network-details.js",
      desc: "完整请求头、响应体与调用栈详情",
    },
    {
      name: "reproduce.spec.ts",
      desc: "带稳定性评分的 Playwright 自动复现脚本",
    },
  ],
  t3Title: "Step 03. 自动复制双语 Prompt 交付大模型",
  t3Badge: "AI 提示词",
  t3Desc:
    "支持精简路由（Compact，节省上下文 Token）与完整指引（Full）两种模板，中英双语与宿主系统命令自动适配，导出即写入剪贴板。",
  promptTabsAria: "Prompt 模板切换",
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
  capabilities: [
    {
      icon: "timeline",
      tag: "全维度对齐",
      title: "统一时序证据链",
      desc: "将点击红圈截图、DOM 样式、Console 错误堆栈、XHR/Fetch 报文与 Tab 录屏精准对齐至同一毫秒级时间轴。",
    },
    {
      icon: "code",
      tag: "框架源码探针",
      title: "React / Vue 源码与状态解包",
      desc: "高精度还原 Vue 2、Vue 3 与 React 组件源码文件路径与行号，深度捕获触发异常前后的 Props 与响应式 State 快照。",
    },
    {
      icon: "annotate",
      tag: "无需录屏",
      title: "独立截图标注工具",
      desc: "使用 Option/Alt+X 随时框选网页区域，支持像素尺寸测量、划线箭头与流式自动折行发光批注，快速向 AI 描述 UI 调整。",
    },
    {
      icon: "mobile",
      tag: "移动端与跨 Tab",
      title: "DevTools 仿真与多标签追踪",
      desc: "专门适配 Chrome DevTools 移动端模拟：贴边磁吸胶囊、真实缩放比裁剪与 Pointer Events；录制期间自动追踪衍生新标签页。",
    },
    {
      icon: "report",
      tag: "可控交付",
      title: "工单交互策展与离线报告",
      desc: "预览页支持删改步骤、移除截图、撤回重做、左右分栏拖拽持久化，以及在严格 CSP 下 file:// 双击即开的离线 HTML 报告。",
    },
    {
      icon: "lock",
      tag: "零外部上传",
      title: "100% 本地私密与自动脱敏",
      desc: "无任何后端服务器。所有录制与打包均在本地浏览器完成，安全模式自动脱敏 Authorization、Cookie、密码框与敏感缓存。",
      highlight: true,
    },
  ],

  skillEyebrow: "Agent Skill & Native CLI · 可选进阶",
  skillTitle: "为 AI Agent 打造的原生 Rust Triage 引擎",
  skillDesc:
    "扩展本身已可独立运行；如果你使用 Claude Code、Cursor、Codex 或 Antigravity，只需一条命令安装官方 bug-lens-triage Skill，AI 即可直接流式解压并按需索引大型 ZIP 证据包，彻底告别临时解析脚本。",
  skillPoints: [
    "2.49 MB 单一原生二进制（零外部依赖），流式防 Zip Bomb 与原子工作区切换",
    "自动生成标准 data/*.json 与 INDEX.md，完整提取顶层 requestBody 与 error",
    "5 大桌面平台预编译分发（macOS / Linux / Windows），SHA-256 校验安装",
  ],
  skillCardBadge: "一步安装",
  skillCardPlatforms: "macOS · Linux · Windows",
  skillInstallLabel:
    "全局安装诊断 Skill（支持 Claude Code / Cursor / Codex / Antigravity 等）",
  skillAutoInstallNote:
    "首次分析证据包时自动按系统下载并校验 SHA-256 原生 Rust CLI，无需手动安装第二步。",
  cliCopy: "复制",
  cliCopied: "已复制",

  perfStatusBadge: "BENCHMARK · NATIVE RUST TRIAGE ENGINE",
  perfFootnote:
    "13.5 MB 真实录屏包 · 4,843 日志 · 522 请求 · 6.20 MB JSON · 5 次中位数",
  perfKpiTitles: {
    kpi1: "网络下钻提速",
    kpi2: "时序聚合提速",
    kpi3: "查询峰值内存",
    kpi4: "AI 上下文裁剪",
  },
  perfRuntimeTitle: "运行时对比 · Rust CLI vs Node.js",
  perfLegendRust: "Rust CLI",
  perfLegendJs: "Legacy JS",
  perfMetrics: {
    m1: { name: "解压建索引峰值内存 (open_pack RSS)", gain: "-70% RAM" },
    m2: { name: "网络下钻耗时 (query_network)", gain: "4.2× 更快" },
    m3: { name: "时间轴聚合耗时 (timeline)", gain: "3.4× 更快" },
    m4: { name: "下钻查询峰值内存 (query_network RSS)", gain: "-74% RAM" },
  },
  perfContextTitle: "分层索引上下文过滤率",
  perfRingSub: "无关噪音已滤除",
  perfStepLabels: {
    open: "全局概览与索引",
    timeline: "核心时序主线",
    net: "网络摘要切片",
  },
  perfCtxBefore: "原始全量 JSON: 6.20 MB",
  perfCtxAfter: "CLI 三步合计: 24.5 KB (0.39%)",

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
  faqs: [
    {
      question: "Bug Lens 会把我的数据上传到服务器吗？",
      answer:
        "不会。Bug Lens 是一款 100% 本地运行的 Chrome 扩展，没有任何后端服务器。所有录制、日志解析与打包导出均在本地浏览器内完成；开启安全模式后还会自动脱敏 Authorization、Cookie、密码字段与敏感本地存储。",
    },
    {
      question: "导出的 ZIP 证据包包含哪些内容？",
      answer:
        "包含可直接粘贴给大模型的 AI_PROMPT.md、双击即可离线查看的 report.html、点击红圈及问题现场截图、DOM 样式与框架状态快照（data/session-data.js）、网络详情（data/network-details.js）、Playwright 复现脚本（reproduce.spec.ts）以及 WebM 录屏。",
    },
    {
      question: "一定要安装 bug-lens-triage Skill 或 Rust CLI 才能用吗？",
      answer:
        "不需要。安装 Chrome 扩展即可开箱使用全部录制、截图标注、离线报告与 AI Prompt 导出功能；bug-lens-triage Skill 与原生 Rust CLI 是可选的进阶加速组件，能让支持的 AI 编程助手更高效地流式索引大型证据包。",
    },
    {
      question: "支持哪些 AI 工具和前端技术栈？",
      answer:
        "导出提示词兼容任意 AI 编程工具与对话助手（Cursor、Claude Code、Codex、Antigravity、Windsurf 等）；网页捕获适用于所有 Web 应用，并对 Vue 2、Vue 3 与 React 提供组件源码文件路径及响应式状态深度解析。",
    },
    {
      question: "对浏览器版本有什么要求？常用快捷键是什么？",
      answer:
        "最低要求 Chrome / Edge 125+（Manifest V3）。默认快捷键：Cmd/Ctrl+Shift+Y 打开控制面板，Option/Alt+R 一键开始录制，Option/Alt+X 独立截图标注，录制中按 Option/Alt+S 快速标记异常现场（可在扩展设置页自定义）。",
    },
  ],

  footerSource: "GitHub 仓库",
  footerPrivacy: "隐私政策",
  footerDiscussions: "技术讨论",
  footerIssues: "反馈缺陷",
  footerCommunity: "微信交流群",
  footerLicense: "AGPL-3.0 开源协议",
  footerLangLinkLabel: "English",
};
