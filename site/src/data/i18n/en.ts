import type { SiteCopy } from "./types";

export const EN_COPY: SiteCopy = {
  htmlLang: "en",
  ogLocale: "en_US",
  ogLocaleAlt: "zh_CN",
  pageTitle: "Bug Lens — From Bug Scene to AI Fix in 3 Seconds",
  metaDescription:
    "Bug Lens is a 100% local Chrome extension: record interactions or annotate screenshots to capture click trails, React/Vue state, console stacks, and network payloads into structured AI prompts and offline evidence packs.",
  ogTitle: "Bug Lens — From Bug Scene to AI Fix in 3 Seconds",
  ogDescription:
    "Capture browser interactions, React/Vue state, console stacks, and network payloads locally — export structured AI prompts and offline evidence packs in one click.",
  twitterTitle: "Bug Lens — From Bug Scene to AI Fix in 3 Seconds",
  twitterDescription:
    "One-click browser bug context recorder & screenshot annotator built for Cursor, Claude Code, Codex, and Antigravity.",

  navAria: "Primary Navigation",
  navWorkflow: "Workflow",
  navCapabilities: "Capabilities",
  navAgentSkill: "Agent Skill",
  navChangelog: "Changelog",
  navFaq: "FAQ",
  navMenuAria: "Toggle navigation menu",
  langSwitchLabel: "中文",
  langSwitchAria: "Switch to Simplified Chinese",

  heroVersionBadgePrefix: "is Live · See Changelog",
  heroTitleHtml:
    'From Bug Scene to <span class="hl">AI Fix</span><br />In 3 Seconds',
  heroTitlePlain: "From Bug Scene to AI Fix in 3 Seconds",
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
  bmTagPrefix: "End-to-End Loop",
  captureTabsAria: "Capture views",
  t1Title: "Step 01. One-Click Record or Standalone Screenshot",
  t1Badge: "Scene Capture",
  t1Desc:
    "Recording automatically captures click ripples, console logs, network traffic, and framework state (press Option/Alt+S to mark issue scenes). Or trigger standalone screenshot annotation anytime with pixel measurements, arrows, and flow-wrapped notes.",
  tabShotAnnotation: "Screenshot Annotation",
  tabShotPopup: "Extension Control Panel",
  shotAltAnnotation: "Bug Lens Screenshot Annotation",
  shotCaptionAnnotation:
    "Measure bounding regions in pixels, point with arrows, and add halo-stroked notes directly on the page for UI or behavior fixes.",
  shotAltPopup: "Bug Lens Control Popup Panel",
  shotCaptionPopup:
    "Start recording or snap a screenshot in one click; toggle Video, Console, Network, Response Bodies, and Framework State with Safe Mode enabled by default.",
  t2Title: "Step 02. Visual Curation & Offline ZIP Export",
  t2Badge: "Evidence Archive",
  t2Desc:
    "Review the timeline in the Preview Workspace, remove or edit steps and screenshots with undo/redo, inspect Playwright locators, and export a self-contained ZIP with the AI prompt copied to your clipboard.",
  t2ImgAlt: "Bug Lens Evidence Preview Workspace",
  t2Caption:
    "Evidence Preview Workspace: draggable split layout pairing video/timeline playback with stability-scored Playwright locators and network state.",
  archiveSampleName: "web-bug-report-b3444f9a.zip",
  treeLabel: "Exported Archive Layout",
  fileTree: [
    {
      name: "AI_PROMPT.md",
      desc: "Structured AI prompt & workspace setup guide",
    },
    {
      name: "report.html",
      desc: "Strict-CSP offline interactive HTML report",
    },
    {
      name: "data/session-data.js",
      desc: "Timeline, console, framework state & issue scenes",
    },
    {
      name: "data/network-details.js",
      desc: "Full headers, payloads & initiator call stacks",
    },
    {
      name: "reproduce.spec.ts",
      desc: "Stability-scored Playwright reproduction script",
    },
  ],
  t3Title: "Step 03. Auto-Copied Bilingual Prompt for Any LLM",
  t3Badge: "AI Prompt",
  t3Desc:
    "Switch between Compact (token-saving Skill/CLI router) and Full templates with OS-aware extraction commands, copied automatically upon export.",
  promptTabsAria: "Prompt templates",
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
  capabilities: [
    {
      icon: "timeline",
      tag: "Unified Timeline",
      title: "Millisecond-Aligned Evidence",
      desc: "Correlates red-ring click screenshots, DOM styles, console stacks, XHR/Fetch traffic, and tab video on a single chronological timeline.",
    },
    {
      icon: "code",
      tag: "Framework Probes",
      title: "React & Vue Source Unboxing",
      desc: "Resolves exact Vue 2, Vue 3, and React component file paths and line numbers while capturing props and reactive state snapshots.",
    },
    {
      icon: "annotate",
      tag: "No Recording Needed",
      title: "Standalone Screenshot Annotator",
      desc: "Press Option/Alt+X on any page to crop regions, inspect pixel dimensions, draw arrows, and add high-contrast halo-stroked labels.",
    },
    {
      icon: "mobile",
      tag: "Mobile & Multi-Tab",
      title: "DevTools Emulation & Derived Tabs",
      desc: "Tailored for Chrome DevTools mobile emulation with edge-docked pills, physical scale cropping, Pointer Events, and automatic derived-tab tracking.",
    },
    {
      icon: "report",
      tag: "Curated Delivery",
      title: "Interactive Ticket Curation & CSP Reports",
      desc: "Edit descriptions, drop noisy steps or screenshots with undo/redo, drag-resize split panes, and open offline reports via file:// under strict CSP.",
    },
    {
      icon: "lock",
      tag: "Zero Telemetry",
      title: "100% Local & Auto-Sanitized",
      desc: "Zero backend servers. All capture and ZIP packaging run strictly in-browser with automatic masking of Authorization headers, Cookies, and passwords.",
      highlight: true,
    },
  ],

  skillEyebrow: "Agent Skill & Native CLI · Optional Power-Up",
  skillTitle: "Native Rust Triage Engine for AI Agents",
  skillDesc:
    "The Chrome extension works standalone out of the box. For Claude Code, Cursor, Codex, or Antigravity users, installing the bug-lens-triage Skill unlocks a native Rust CLI so agents stream-extract and query large evidence packs without ad-hoc scripts.",
  skillPoints: [
    "Single 2.49 MB native binary (zero runtime deps) with streaming zip-bomb protection & atomic swaps",
    "Generates clean data/*.json and INDEX.md with full top-level requestBody & error extraction",
    "Prebuilt binaries for 5 desktop targets (macOS / Linux / Windows) with SHA-256 verified installers",
  ],
  skillCardBadge: "One-Command Setup",
  skillCardPlatforms: "macOS · Linux · Windows",
  skillInstallLabel:
    "Install the triage Skill globally (Claude Code / Cursor / Codex / Antigravity, etc.)",
  skillAutoInstallNote:
    "On first run, the native Rust CLI is automatically downloaded for your OS and SHA-256 verified — no second step required.",
  cliCopy: "Copy",
  cliCopied: "Copied!",

  perfStatusBadge: "BENCHMARK · NATIVE RUST TRIAGE ENGINE",
  perfFootnote:
    "13.5 MB real pack · 4,843 logs · 522 requests · 6.20 MB JSON · 5-run median",
  perfKpiTitles: {
    kpi1: "Network Query Speedup",
    kpi2: "Timeline Speedup",
    kpi3: "Query Peak RAM",
    kpi4: "AI Context Cut",
  },
  perfRuntimeTitle: "Runtime · Rust CLI vs. Node.js",
  perfLegendRust: "Rust CLI",
  perfLegendJs: "Legacy JS",
  perfMetrics: {
    m1: { name: "Extract & Index Peak RAM (open_pack RSS)", gain: "-70% RAM" },
    m2: { name: "Network Query Latency (query_network)", gain: "4.2× faster" },
    m3: { name: "Timeline Latency (timeline)", gain: "3.4× faster" },
    m4: { name: "Query Peak RAM (query_network RSS)", gain: "-74% RAM" },
  },
  perfContextTitle: "Scoped Context Filtering Ratio",
  perfRingSub: "Noise filtered out",
  perfStepLabels: {
    open: "Overview & INDEX.md",
    timeline: "Chronological spine",
    net: "Network slice",
  },
  perfCtxBefore: "Raw full JSON: 6.20 MB",
  perfCtxAfter: "3-step CLI total: 24.5 KB (0.39%)",

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
  faqs: [
    {
      question: "Does Bug Lens upload my data to any server?",
      answer:
        "No. Bug Lens runs 100% locally inside your browser with zero backend servers. Safe Mode also automatically masks sensitive tokens such as Authorization headers, Cookies, password fields, and storage entries.",
    },
    {
      question: "What is included in the exported ZIP evidence pack?",
      answer:
        "It includes AI_PROMPT.md for LLMs, an interactive offline report.html, red-ring click & issue screenshots, DOM/framework snapshots (data/session-data.js), full network details (data/network-details.js), a Playwright script (reproduce.spec.ts), and WebM video.",
    },
    {
      question: "Do I have to install the bug-lens-triage Skill or Rust CLI?",
      answer:
        "No. The extension works completely standalone with zero CLI setup. The bug-lens-triage Skill and native Rust CLI are an optional power-up for AI coding agents to inspect large ZIP archives faster with lower memory and token overhead.",
    },
    {
      question: "Which AI assistants and web frameworks are supported?",
      answer:
        "Exported prompts work with Cursor, Claude Code, Codex, Antigravity, Windsurf, and any LLM chat. Capture works on all websites, with dedicated component source path and reactive state probes for Vue 2, Vue 3, and React.",
    },
    {
      question: "What Chrome version and shortcuts are supported?",
      answer:
        "Requires Chrome / Edge 125 or newer (Manifest V3). Default shortcuts: Cmd/Ctrl+Shift+Y opens the popup, Option/Alt+R starts recording, Option/Alt+X triggers standalone screenshot annotation, and Option/Alt+S marks an issue scene during recording (customizable in Options).",
    },
  ],

  footerSource: "GitHub Repository",
  footerPrivacy: "Privacy Policy",
  footerDiscussions: "Discussions",
  footerIssues: "Report Issue",
  footerCommunity: "WeChat Group",
  footerLicense: "AGPL-3.0 License",
  footerLangLinkLabel: "简体中文",
};
