# Chrome Web Store Listing & Submission Guide — Bug Lens

> **Version Alignment**: Manifest `v0.7.2`  
> **Target Store**: [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole)

---

## 1. 商店基本信息 (Store Listing — Copy & Paste)

### Extension Name

```text
Bug Lens
```

### Short Description (Max 132 chars)

```text
Capture browser bug context (Console, Network, User Actions) and export structured prompts for Cursor, Claude Code, and AI assistants.
```

### Detailed Description (English)

```text
Bug Lens is a browser extension tailored for developers and AI code assistants (Cursor, Claude Code, Windsurf, Antigravity) to capture full-stack bug context from web sessions.

Debugging frontend issues with AI assistants often fails because critical runtime context is missing. Bug Lens bridges this gap with one-click recording to collect clean, reproducible diagnostic evidence and formatted prompts.

Key Features:

1. Full-Stack Context Capture
- Console & Runtime Logs: Accurately captures console errors, warnings, and stack traces.
- Network Traffic: Correlates failed API requests, HTTP status codes, headers, and payloads.
- User Interaction Timeline: Records clicks, inputs, and navigation actions leading up to the issue.
- Visual Evidence: Captures DOM state snapshots, visual click indicators, and synchronized tab recordings.

2. AI-Optimized Export Formats
- Generates token-efficient Markdown prompts and structured JSON data.
- Built-in formatting tailored for direct consumption by Cursor, Claude Code, and custom AI agents.
- Automatically copies formatted AI prompts to the system clipboard upon export.

3. Privacy-First & 100% Local Processing
- All recording, log processing, and packaging happen strictly inside your local browser.
- Zero external data transmission or third-party telemetry.
- Automatic sanitization of sensitive data (Authorization headers, Cookies, and password fields).

How to Use:

1. Open the Bug Lens extension popup on your web application.
2. Click "Start Recording" (or press Alt+R / Option+R) and reproduce the bug.
3. Click "Stop & Export" to review captured evidence.
4. Paste the auto-copied AI prompt directly into your AI assistant for rapid root-cause analysis and automated fixes.

Privacy & Security:
Bug Lens does not collect, transmit, or share user data to remote servers. All diagnostic evidence is processed and stored locally.
```

### Detailed Description (Chinese / 中文详细说明)

```text
Bug Lens 是一款专为开发者与 AI 编程助手（Cursor、Claude Code、Windsurf、Antigravity）量身定制的网页端 Bug 现场证据捕获工具。

在使用 AI 辅助排查前端问题时，往往因为缺少运行时上下文导致 AI 无法准确定位。Bug Lens 让你一键将浏览器异常会话打包为结构化、高保真的诊断证据与提示词，让 AI 一步到位精准修复 Bug。

核心特性：

1. 全维度现场捕获
- 报错与日志：精确抓取 Console Error、Warning 及完整调用栈
- 网络请求追踪：自动关联失败的 API 请求、状态码、Headers 与 Payload
- 交互时间线：记录触发 Bug 前后的用户点击、输入及页面跳转时序
- 可视化证据：支持 DOM 状态快照、点击高亮与音视频同步录制

2. 专为 AI 编程优化的导出格式
- 提供高 Token 效率的 Markdown 提示词与结构化 JSON 数据
- 深度适配 Cursor、Claude Code 与各类 AI Agent 的上下文格式
- 导出完成后自动将结构化 Prompt 复制到系统剪贴板，即贴即用

3. 隐私与数据安全第一
- 纯本地处理：所有录制、日志解析与证据打包均在浏览器本地完成，绝无外部服务器上传
- 敏感数据脱敏：自动识别并遮蔽 Authorization、Cookie 及指定密码字段

3步极速工作流：

1. 捕获：在发生异常的网页点击 Bug Lens 开始录制（或使用快捷键 Alt+R / Option+R）并复现 Bug。
2. 导出：点击“结束并导出”，系统自动打包证据并生成 AI 诊断提示词。
3. 修复：直接粘贴给 Cursor、Claude 等 AI 助手，秒级获取根本原因分析与修复代码。

隐私与安全性说明：
Bug Lens 不会向任何远程服务器收集、传输或共享用户数据。所有诊断证据均在本地存储与处理。
```

### Category

```text
Developer Tools
```

### Single Purpose Statement

```text
Record browser tab interactions, console error logs, network traffic, and DOM state to generate self-contained, reproducible web bug reports and structured AI prompts locally.
```

---

## 2. 权限说明清单 (Permissions Justification)

> Chrome 审核团队要求对 `manifest.json` 中声明的每一项权限提供具体的业务逻辑理由。直接复制下方表格右侧文本填写至开发者后台：

| Permission                  | Category | Standard Justification for Chrome Web Store Review                                                                                 |
| :-------------------------- | :------- | :--------------------------------------------------------------------------------------------------------------------------------- |
| `activeTab`                 | Required | Required to inspect the user-selected active tab and initialize recording controls when the user clicks the extension action.      |
| `tabs`                      | Required | Required to query current tab properties and maintain tab identification during multi-tab recording sessions.                      |
| `alarms`                    | Required | Required to schedule non-blocking background cleanup tasks and maintain session state heartbeats.                                  |
| `clipboardWrite`            | Required | Required to copy the structured AI Prompt markdown directly to the system clipboard upon export completion for instant AI pasting. |
| `debugger`                  | Required | Required to attach Chrome DevTools Protocol (CDP) for capturing raw network traffic and console error logs while recording bugs.   |
| `downloads`                 | Required | Required to save and export packaged bug evidence archives (ZIP files containing video and JSON logs) directly to local storage.   |
| `offscreen`                 | Required | Required to host audio/video encoding and file archiving in an offscreen document without freezing the extension popup UI.         |
| `scripting`                 | Required | Required to dynamically inject visual interaction trackers (click indicators) into the active page during recording sessions.      |
| `storage`                   | Required | Required to save user preferences, recording configurations, and draft bug evidence locally on the device.                         |
| `tabCapture`                | Required | Required to capture visual tab video and audio streams for generating bug reproduction video files.                                |
| `unlimitedStorage`          | Required | Required to hold temporary video recordings and extensive console log artifacts locally without quota limits.                      |
| `webNavigation`             | Required | Required to track page navigation events during recording so evidence collection remains uninterrupted across reloads.             |
| `http://*/*`, `https://*/*` | Host     | Requested on-demand to allow users to capture network payloads and console logs on specific web application domains.               |

---

## 3. 图像与媒体资产规划 (Graphics & Media Specification)

建议提供至少 4 张 1280×800 规格的截图，按以下主题与构图进行制作：

| Asset                                 | Dimensions   | Theme & Content Layout                                                                                                                                 | Status      |
| :------------------------------------ | :----------- | :----------------------------------------------------------------------------------------------------------------------------------------------------- | :---------- |
| **Store Icon**                        | 128×128 PNG  | `src/icons/icon_idle_128.png`                                                                                                                          | Ready       |
| **Screenshot 1 (Hero / Workflow)**    | 1280×800 PNG | 主标题：AI 时代的网页 Debug 现场捕获器。<br>画面：左侧展示 Bug Lens 捕获的时序与网络/控制台报错，右侧展示 Cursor/Claude 基于该上下文自动输出修复代码。 | Required    |
| **Screenshot 2 (Full-Stack Capture)** | 1280×800 PNG | 主标题：控制台 · 网络请求 · 操作时序 全景记录。<br>画面：UI 局部特写，高亮标注 Network 400/500 请求、Console Error 调用栈与用户操作时间线。            | Recommended |
| **Screenshot 3 (AI Prompt Export)**   | 1280×800 PNG | 主标题：一键生成 AI 诊断提示词。<br>画面：展示结构化 Markdown Prompt 预览及自动复制到剪贴板的反馈通知。                                                | Recommended |
| **Screenshot 4 (Local & Privacy)**    | 1280×800 PNG | 主标题：100% 本地运算，敏感数据自动脱敏。<br>画面：展示 Token 与 Cookie 字段被自动脱敏处理的界面特写。                                                 | Recommended |
| **Small Promo Tile**                  | 440×280 PNG  | 品牌深色背景 + Bug Lens 图标 + 核心标语 "Bug Lens: Browser to AI Context"                                                                              | Optional    |

---

## 4. 隐私与数据管理 (Privacy Practices)

针对 Chrome Web Store 后台 **Privacy practices** 问卷的填报标准：

- **Single Purpose Certifications**:
  - [x] Data is NOT sold to third parties.
  - [x] Data is NOT used or transferred for purposes unrelated to the item's core functionality.
  - [x] Data is NOT used or transferred to determine creditworthiness or for lending purposes.

- **Data Collection Declarations**:
  - **Do you collect user data?**: Select **No** (All processing is strictly local).

---

## 5. 打包上架标准流程 (Release SOP)

### 步骤 1: 验证与编译生成 Release 包

```bash
# 1. 运行类型检查与测试
pnpm run typecheck

# 2. 编译并打包为 Release ZIP
pnpm run package
```

产物位置：根目录下生成 `dist-zip/bug-lens-v0.7.2.zip`

### 步骤 2: 提交至 Chrome Developer Dashboard

1. 打开 [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole)。
2. 点击 "Add new item" 或进入现有扩展包管理页面，上传最新版本的 ZIP 文件。
3. 复制本文件 第 1 节 中的 `Extension Name`、`Short Description`、`Detailed Description`、`Category` 与 `Single Purpose`。
4. 在权限理由页面，按 第 2 节 的表格，将每一项权限的 `Justification` 逐一粘贴至后台文本框。
5. 上传 `src/icons/icon_idle_128.png` 图标及制作好的 1280×800 截图。
6. 在 Privacy practices 页按照 第 4 节 进行勾选并提供公开隐私政策地址（填 GitHub README 链接或 `PRIVACY.md`）。
7. 确认无误后点击 "Submit for review" 提交审核。

---

## 6. 版本变更记录 (Version History)

| Version  | Date       | Changes Summary                                                                                  | Store Status         |
| :------- | :--------- | :----------------------------------------------------------------------------------------------- | :------------------- |
| `v0.7.2` | 2026-08-19 | Fix silent export package missing offline HTML report template & assets.                         | Ready for Submission |
| `v0.7.1` | 2026-08-19 | Store listing optimization for AI coding assistant workflows (Cursor, Claude Code, Antigravity). | Submitted            |
| `v0.6.0` | 2026-08-12 | Alignment with CDP log capture, clipboard AI prompt copy, pnpm tooling.                          | Submitted            |
