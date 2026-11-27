import type { Locale } from "./site";

export interface ReleaseHighlight {
  title: string;
  desc: string;
}

export interface ReleaseEntry {
  version: string;
  date: string;
  cliCommand?: string;
  highlights: Record<Locale, ReleaseHighlight[]>;
}

export const RELEASES: ReleaseEntry[] = [
  {
    version: "0.7.44",
    date: "2026-11-26",
    cliCommand: "npx skills add Aoyia/bug-lens-skill -g -y",
    highlights: {
      zh: [
        {
          title: "原生 Rust Triage CLI 与跨平台安全分发：",
          desc: "以原生编译的 Rust 二进制（bin/bug-lens-cli）全面替代旧 JS 脚本，具备流式防 Zip Bomb 解压、原子目录切换、低内存无损分页与扩展顶层 requestBody/error 完整提取，配套 5 平台 GitHub Releases 二进制与 SHA-256 校验安装脚本。",
        },
        {
          title: "工单交互策展与渐进式快捷导出引导：",
          desc: "重构图文预览弹窗，支持模块删除、截图移除、内联编辑、撤回重做、原子合并步骤排除及 URL 协议白名单加固；新增阶段式快捷导出引导与老用户平滑迁移，修复枚举配置回切缺陷并优化交互语义分组。",
        },
      ],
      en: [
        {
          title: "Native Rust Triage CLI & Cross-Platform Distribution: ",
          desc: "Replaces the legacy JS script with a native Rust binary (bin/bug-lens-cli) featuring streaming zip-bomb protection, atomic extraction swaps, lossless pagination, full requestBody/error extraction, and 5-target GitHub Releases binaries with SHA-256 verified installers.",
        },
        {
          title: "Interactive Ticket Curation & Progressive Quick Export: ",
          desc: "Rebuilds the ticket preview modal with module deletion, screenshot removal, inline editing, undo/redo, atomic merged-step exclusion, and http/https URL allowlisting; introduces staged quick-export onboarding with seamless legacy migration, fixes enum reset locks, and refines interaction grouping.",
        },
      ],
    },
  },
  {
    version: "0.7.43",
    date: "2026-11-21",
    highlights: {
      zh: [
        {
          title: "移动端仿真交互与桌面端零回归重构：",
          desc: "全新贴边磁吸胶囊与桌面级紧凑侧边菜单（占屏面积直降 44.7%），彻底消除移动端底部 TabBar 遮挡；严格模式隔离机制保障 PC 桌面端 100% 保持原样并完全移除多余折叠按钮。",
        },
        {
          title: "问题现场与截图标注全链路修复：",
          desc: "IssueEditor 三段式零遮挡布局与 Service Worker 视口物理缩放比精准裁剪（红框 0% 偏移）；SelectionOverlay 选区联动滚屏与智能贴底换位；ScreenshotOverlay 放大镜释手隐藏与防溢底增强。",
        },
      ],
      en: [
        {
          title: "Mobile Emulation UX Redesign & Zero PC Regression: ",
          desc: "Redesigns mobile recording controls with edge-docked pills and desktop-grade compact side menus (reducing screen coverage by 44.7%) to eliminate bottom TabBar overlap; strict mode isolation ensures PC desktop experience remains 100% pristine with redundant collapse toggles removed.",
        },
        {
          title: "Issue Scene & Screenshot Overlay Hardening: ",
          desc: "Zero-overlap three-tier IssueEditor layout with physical Tab scale viewport screenshot cropping (eliminating coordinate drift); SelectionOverlay scrolling synchronization and bottom smart flipping; ScreenshotOverlay magnifier release-hide and bottom overflow prevention.",
        },
      ],
    },
  },
  {
    version: "0.7.42",
    date: "2026-11-20",
    highlights: {
      zh: [
        {
          title: "移动端模拟全链路适配与工作区自由分栏：",
          desc: "全面适配桌面 Chrome DevTools 移动端模拟：录制悬浮条、独立截图工具栏、选区提示条与问题编辑器支持窄屏折行、Pointer Events 触控交互、真实缩放比例裁剪及宿主 macOS 快捷键识别；预览页与离线报告新增左右工作区可拖拽分隔栏并支持比例持久化。",
        },
        {
          title: "离线报告严格 CSP 零报错与导出时间戳命名：",
          desc: "将离线报告 i18n 字典外链至 assets/i18n-data.js，并将 truncated-text 组件切换为 Constructable Stylesheets，在严格 CSP 下消除内联脚本与样式拦截（确保 file:// 双击离线报告正常渲染中文）；导出录制与截图 ZIP 自动注入本地时间戳并对齐 Session ID 居中格式。",
        },
      ],
      en: [
        {
          title: "Mobile Emulation Adaptation & Resizable Workspace: ",
          desc: "Adapts the recording widget, screenshot overlay, selection bar, and issue editor for Chrome DevTools mobile emulation with responsive wrapping, unified Pointer Events touch controls, real bitmap-scale cropping, and host platform shortcut detection; adds a draggable horizontal split resizer with persisted ratio to both Preview and offline reports.",
        },
        {
          title: "Strict-CSP Offline Reports & Timestamped Exports: ",
          desc: "Externalizes offline report localization into assets/i18n-data.js and migrates truncated-text to Constructable Stylesheets to satisfy strict CSP without inline script/style violations on file:// opens; embeds readable local timestamps into exported session and screenshot ZIP filenames.",
        },
      ],
    },
  },
  {
    version: "0.7.41",
    date: "2026-11-12",
    highlights: {
      zh: [
        {
          title: "统一解压工作区与两层排查架构：",
          desc: "open_pack 全量幂等解压至独立工作区并落盘录屏与完整截图，自动生成标准 data/*.json 与 INDEX.md 索引，融合 CLI 宏观过滤与 jq/ffmpeg 微观深潜；内置定长 LRU 自动淘汰机制。",
        },
        {
          title: "结构化提示词路由与模块解耦重构：",
          desc: "新增精简（Compact）剪贴板提示词与自适应安装路由；独立工单与 Playwright 预览弹窗体验升级，收敛空间几何探测与焦点防护底层模块。",
        },
      ],
      en: [
        {
          title: "Unified Extract-First Workspace & Two-Tier Triage: ",
          desc: "open_pack idempotently extracts archives to an isolated workspace with recording media and full step screenshots, auto-generates data/*.json and INDEX.md, pairs macro CLI filtering with jq/ffmpeg deep dives, and introduces LRU pack eviction.",
        },
        {
          title: "Compact Prompt Routing & Architecture Decoupling: ",
          desc: "Introduces compact clipboard prompts with adaptive install fallback; refactors ticket and Playwright modals while unifying spatial geometry probes and focus/scroll shields.",
        },
      ],
    },
  },
  {
    version: "0.7.40",
    date: "2026-11-06",
    highlights: {
      zh: [
        {
          title: "问题场景编辑器与工单系统升级：",
          desc: "深度优化缺陷标记与速记卡交互体验，支持富文本批注、DOM 锚点高亮与多场景切换；结构化工单模态框适配全新设计系统 Tokens。",
        },
        {
          title: "隐私脱敏策略与端侧构建优化：",
          desc: "解耦 Content 注入脚本与冗余资源暴露，优化产物包体积；强化 LocalStorage/Cookie 脱敏与安全模式感知，完善交互聚合与回放性能。",
        },
      ],
      en: [
        {
          title: "Enhanced Issue Scene Editor & Ticket Modal: ",
          desc: "Streamlined defect marking and quick-card interactions with rich-text annotations, DOM anchor highlighting, and multi-scene switching; ticket modal upgraded to modern design tokens.",
        },
        {
          title: "Refined Privacy Sanitization & Bundle Optimization: ",
          desc: "Decouples injected content scripts, trims redundant resources, strengthens LocalStorage/Cookie masking with safe mode perception, and polishes interaction grouping.",
        },
      ],
    },
  },
  {
    version: "0.7.39",
    date: "2026-11-03",
    highlights: {
      zh: [
        {
          title: "零依赖 AI 诊断 Skill 与内置 CLI：",
          desc: "收敛 12 项内存直读与级联溯源能力至 bug-lens-triage Skill 内置的零依赖 CLI（scripts/bug-lens-cli.mjs），支持一行 npx skills add 全局安装，彻底消除独立 MCP 配置门槛。",
        },
        {
          title: "会话级包路径记忆与截图直出：",
          desc: "open_pack 命令一步到位自动导出关键场景截图并建立会话状态缓存，后续下钻命令无需重复传包路径，极大减少终端交互与弹窗打断。",
        },
      ],
      en: [
        {
          title: "Zero-Dependency Triage Skill & Bundled CLI: ",
          desc: "Consolidates all 12 in-memory inspection and CSS cascade tracing capabilities into the bug-lens-triage Agent Skill with a bundled zero-dependency CLI (scripts/bug-lens-cli.mjs), installable via a single npx skills add command.",
        },
        {
          title: "Active Pack Cache & Instant Screenshot Export: ",
          desc: "open_pack automatically extracts key scene screenshots and caches active pack state across invocations, eliminating repetitive --pack flags and terminal interruption prompts.",
        },
      ],
    },
  },
  {
    version: "0.7.38",
    date: "2026-11-03",
    highlights: {
      zh: [
        {
          title: "内存直读与专属诊断 Skill：",
          desc: "发布免解压直读架构与 bug-lens-triage Agent 技能，支持 AI 免解压直读 ZIP 证据包，自动分流视觉级联溯源（cascade.json）与运行时序下钻，实现从证据到源码修复的标准化闭环。",
        },
        {
          title: "跨标签页无缝录制与并行解析：",
          desc: "支持衍生标签页自动追踪与分布式录制挂件状态同步，升级 Worker 并行 SourceMap 解析、全量黑匣子性能遥测与结构化缺陷工单导出。",
        },
      ],
      en: [
        {
          title: "In-Memory Inspection & Triage Skill: ",
          desc: "Enables zero-extraction in-memory ZIP inspection and the bug-lens-triage Agent Skill, automating CSS cascade pinpointing (cascade.json) and chronological timeline drill-down for defect triage.",
        },
        {
          title: "Seamless Multi-Tab Recording & Parallel SourceMap: ",
          desc: "Supports derived tab auto-tracking and distributed widget state sync, powered by parallel Worker SourceMap resolution, blackbox telemetry archives, and structured bug ticket export.",
        },
      ],
    },
  },
  {
    version: "0.7.37",
    date: "2026-10-23",
    highlights: {
      zh: [
        {
          title: "Windows 与跨平台单例工作区：",
          desc: "原生支持 Windows PowerShell 与 POSIX 终端环境自适应，提供强制覆写解压指令，保障 O(1) 恒定最小存储占用。",
        },
        {
          title: "绝对路径自动内联与安全转义：",
          desc: "下载完成后自动将本地真实路径转义注入解压命令，AI 编程助手即拷即跑，彻底告别手动替换与工作区污染。",
        },
      ],
      en: [
        {
          title: "Windows & Cross-Platform O(1) Workspace: ",
          desc: "Natively supports Windows PowerShell and POSIX shells with idempotent overwrite unzip commands for zero workspace pollution and minimal storage.",
        },
        {
          title: "Safe Inlined Path Injection: ",
          desc: "Automatically escapes and inlines local downloaded ZIP paths into diagnostic CLI commands for friction-free copy-paste execution.",
        },
      ],
    },
  },
  {
    version: "0.7.36",
    date: "2026-10-22",
    highlights: {
      zh: [
        {
          title: "全新设置页毛玻璃分段控制：",
          desc: "采用 iOS 26 风格 Liquid Glass 交互组件与防抖动排版，响应式体验更丝滑。",
        },
        {
          title: "截图文字标注体验重构：",
          desc: "引入流式自动折行（Flow Layout）、Halo 发光描边与高辨识度配色（#FA5352），大幅提升批注可读性。",
        },
      ],
      en: [
        {
          title: "Liquid Glass Segmented Controls: ",
          desc: "iOS 26 style liquid glass controls with zero-shift responsive layout for seamless workflow switching.",
        },
        {
          title: "Redesigned Screenshot Annotations: ",
          desc: "Fluid auto-wrap flow layout, glowing halo strokes, and high-contrast #FA5352 vibrant red annotations.",
        },
      ],
    },
  },
  {
    version: "0.7.35",
    date: "2026-09-28",
    highlights: {
      zh: [
        {
          title: "Chrome 原生风格设置页：",
          desc: "支持独立选项页、快捷键自定义、自动化采集开关与存储策略管控。",
        },
        {
          title: "跨标签页录制体验：",
          desc: "增强跨 Tab 会话感知、录制暂停与恢复状态同步及预览 Toast 便捷动作。",
        },
      ],
      en: [
        {
          title: "Chrome-Style Options Hub: ",
          desc: "Standalone settings dashboard with shortcut customization, automation toggles, and storage controls.",
        },
        {
          title: "Multi-Tab Recording Polish: ",
          desc: "Enhanced cross-tab session tracking, synchronized pause states, and instant preview toast actions.",
        },
      ],
    },
  },
  {
    version: "0.7.34",
    date: "2026-09-05",
    highlights: {
      zh: [
        {
          title: "前端框架源码探针：",
          desc: "支持 Vue 2、Vue 3 及 React 源码路径与行号高精度解析，深度解包响应式状态。",
        },
      ],
      en: [
        {
          title: "Framework Source Code Probes: ",
          desc: "Pinpoints Vue 2, Vue 3, and React source paths and line numbers with automated state unboxing.",
        },
      ],
    },
  },
  {
    version: "0.7.33",
    date: "2026-09-04",
    highlights: {
      zh: [
        {
          title: "极限高频压力与导出性能：",
          desc: "优化后台 IndexedDB 批量事务与静默导出流水线，通过 21 套端到端全量压力测试硬化。",
        },
      ],
      en: [
        {
          title: "High-Frequency Burst Hardening: ",
          desc: "Mitigates transaction locks via batching and hardens performance across 21 full-suite E2E stress runs.",
        },
      ],
    },
  },
];

export const LATEST_RELEASE: ReleaseEntry = RELEASES[0];
export const OLDEST_RELEASE: ReleaseEntry = RELEASES[RELEASES.length - 1];
export const PREVIOUS_RELEASE: ReleaseEntry | undefined = RELEASES[1];
