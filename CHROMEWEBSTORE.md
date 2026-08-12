# Chrome Web Store Listing & Submission Guide — Bug Lens

> **Version Alignment**: Manifest `v0.6.0`  
> **Target Store**: [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole)

---

## 1. 商店基本信息 (Store Listing — Copy & Paste)

### Extension Name

```text
Bug Lens
```

### Short Description (Max 132 chars)

```text
Capture local evidence (DOM, network logs, video) for web bugs to make issue reporting clear and reproducible for AI assistants.
```

### Detailed Description

```text
Bug Lens is a developer tool designed for developers and AI code assistants (Cursor, Claude Code, Antigravity) to capture full-stack bug context from browser sessions.

When debugging frontend issues or working with AI agents, reproducing bugs often fails due to missing runtime context. Bug Lens bridges this gap with one-click browser recording to collect clean diagnostic evidence.

Key Features:

- One-Click Reproduction: Capture clicked element highlights (with visual rings), DOM state snapshots, console logs, network payloads, and WebM screen recordings.
- Offline ZIP Export: Generates self-contained static report files (`report.html`) and structured AI Prompt (`AI_PROMPT.md`).
- Automatic Clipboard Copy: Copies AI prompt to system clipboard instantly upon export for effortless pasting into Cursor, Claude Code, or Antigravity.
- Privacy-First & 100% Local: All recording, log processing, and evidence packaging take place locally on your device. Zero external data transmission.
- Timeline Inspection: Synchronize console/network event logs with video playback and redact sensitive data before export.

How to use:

1. Open the Bug Lens extension popup on your web application.
2. Click "Start Recording" (or shortcut Alt+R / Option+R) and reproduce the bug.
3. Click "Stop Recording" to review captured logs and evidence.
4. Export the evidence ZIP package; paste the auto-copied AI prompt directly into your AI assistant.

Privacy & Data Use:
Bug Lens does not collect, transmit, or share user data to remote servers. All diagnostic evidence is processed and stored locally.
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

## 3. 图像与媒体资产 (Graphics & Media Checklist)

| Asset                | Dimensions          | Source File / Status                        | Requirement           |
| :------------------- | :------------------ | :------------------------------------------ | :-------------------- |
| **Store Icon**       | 128×128 PNG         | `src/icons/icon_idle_128.png` ✅            | Required              |
| **Screenshot 1**     | 1280×800 or 640×400 | Popup recording interface (Pending 🟡)      | Required (At least 1) |
| **Screenshot 2**     | 1280×800 or 640×400 | Captured evidence preview page (Pending 🟡) | Recommended           |
| **Small Promo Tile** | 440×280             | Promo banner (Optional ⚪)                  | Optional              |

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
# 1. 运行类型检查
pnpm run typecheck

# 2. 编译并打包为 Release ZIP
pnpm run package
```

产物位置：根目录下生成 `bug-lens-v0.6.0.zip`

### 步骤 2: 提交至 Chrome Developer Dashboard

1. 打开 [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole)。
2. 点击 **"Add new item"**，上传 `bug-lens-v0.6.0.zip`。
3. 复制本文件 **第 1 节** 中的 `Extension Name`、`Short Description`、`Detailed Description`、`Category` 与 `Single Purpose`。
4. 在权限理由页面，按 **第 2 节** 的表格，将每一项权限的 `Justification` 逐一粘贴至后台文本框。
5. 上传 `src/icons/icon_idle_128.png` 图标及至少一张 1280×800 插件截图。
6. 在 **Privacy practices** 页按照 **第 4 节** 进行勾选并提供公开隐私政策地址（可填 GitHub README 链接或 `PRIVACY.md`）。
7. 确认无误后点击 **"Submit for review"** 提交审核。

---

## 6. 版本变更记录 (Version History)

| Version  | Date       | Changes Summary                                                         | Store Status                 |
| :------- | :--------- | :---------------------------------------------------------------------- | :--------------------------- |
| `v0.6.0` | 2026-08-12 | Alignment with CDP log capture, clipboard AI prompt copy, pnpm tooling. | Draft / Ready for Submission |
