# Chrome Web Store Listing — Bug Lens

> Last Updated: 2026-07-28

## 1. 商店基本信息 (Store Listing)

**扩展名称 (Extension Name)**  
Bug Lens

**简短描述 (Short Description - Max 132 chars)**  
Capture local evidence (DOM, network logs, video) for web bugs to make issue reporting clear and reproducible.

**详细描述 (Detailed Description)**  
Bug Lens is a developer tool that simplifies web application debugging by collecting comprehensive diagnostic evidence directly in your browser.

Key Features:

- Record browser tab interactions and video evidence.
- Capture console logs and network requests via Chrome DevTools Protocol.
- Export self-contained bug reports for team investigation.
- 100% Local & Private: All recording and log capture occurs entirely on your device.

How to use:

1. Open the Bug Lens extension popup on any web page.
2. Click "Start Recording" to begin capturing bug evidence.
3. Perform the actions that trigger the web bug.
4. Click "Stop Recording" and export the generated bug evidence package.

Privacy & Security:
Bug Lens does not upload, transmit, or share your captured data to external servers. All data is processed and stored locally.

**分类 (Category)**  
Developer Tools

**单一用途声明 (Single Purpose)**  
Record browser tab interactions, console/network logs, and DOM state to generate reproducible web bug reports locally.

**主要语言 (Primary Language)**  
English (US)

---

## 2. 图像资产清单 (Graphics & Assets)

| Asset                          | Dimensions          | Status      | Requirements / Filename                |
| ------------------------------ | ------------------- | ----------- | -------------------------------------- |
| Store Icon [REQUIRED]          | 128×128 PNG         | ✅ Ready    | `src/icons/icon128.png`                |
| Screenshot 1 [REQUIRED]        | 1280×800 or 640×400 | 🟡 Pending  | Main popup recording control interface |
| Screenshot 2 [RECOMMENDED]     | 1280×800 or 640×400 | 🟡 Pending  | Captured bug evidence preview page     |
| Small Promo Tile [RECOMMENDED] | 440×280             | 🟡 Optional | Extension branding promo card          |

---

## 3. 权限使用理由 (Permissions Justification)

> Chrome 审核团队要求对 `manifest.json` 中声明的每一项权限提供具体的业务场景说明。

| Permission                  | Type                      | Standard Justification for Chrome Web Store Review                                                                                   |
| --------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `activeTab`                 | permissions               | Required to inspect the user-selected active tab and initialize recording controls when the user clicks the extension action.        |
| `debugger`                  | permissions               | Required to attach Chrome DevTools Protocol to capture network traffic and console error logs while recording bugs.                  |
| `downloads`                 | permissions               | Required to export and download the packaged bug evidence files (video, JSON logs) directly to the user's local disk.                |
| `offscreen`                 | permissions               | Required to host audio/video processing and packaging tasks in an offscreen document context without freezing the popup UI.          |
| `scripting`                 | permissions               | Required to dynamically inject interaction trackers that capture user mouse clicks and DOM state changes during a recording session. |
| `storage`                   | permissions               | Required to save extension preferences, recording settings, and draft bug evidence locally on the device.                            |
| `tabCapture`                | permissions               | Required to capture the current browser tab's visual and audio stream for generating bug reproduction videos.                        |
| `unlimitedStorage`          | permissions               | Required to store large temporary recording files and console log artifacts locally without running into storage quota limits.       |
| `webNavigation`             | permissions               | Required to track page navigation events during recording so evidence collection remains uninterrupted across page reloads.          |
| `http://*/*`, `https://*/*` | optional_host_permissions | Requested on-demand to allow users to capture network traffic and console logs on specific web application domains.                  |

---

## 4. 隐私与数据使用声明 (Privacy & Data Use)

### Data Collection

- **Does the extension collect user data?**: **No** (No data is transmitted off-device).

| Data Type       | Collected?    | Transmitted Off-Device? | Purpose                       | Shared with Third Parties? |
| --------------- | ------------- | ----------------------- | ----------------------------- | -------------------------- |
| User activity   | Yes (locally) | No                      | Bug evidence generation       | No                         |
| Website content | Yes (locally) | No                      | Console & network log capture | No                         |

### Data Use Certification

- [x] Data is NOT sold to third parties.
- [x] Data is NOT used for purposes unrelated to the extension's core functionality.
- [x] Data is NOT used for creditworthiness or lending purposes.

---

## 5. 打包发布步骤 (Packaging & Publishing Checklist)

### 步骤 A: 生成插件构建产物与 ZIP 压缩包

1. 运行 `npm run build` 重新编译出最新扩展前端产物到 `dist/` 目录。
2. 运行 `npm run package` 打包生成 `bug-lens-v0.1.0.zip`。

### 步骤 B: 在 Chrome Developer Dashboard 上架

1. 访问 [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole)。
2. 使用 Google 开发者账号登录（若首次使用需支付 $5 开发者注册费）。
3. 点击 **"Add new item"** (添加新商品)，上传生成的 `bug-lens-v0.1.0.zip`。
4. 填写上述 **Store Listing** 字段（名称：Bug Lens、简短描述、详细描述、分类、单一用途）。
5. 复制粘贴 **Permissions Justification** 中的权限说明至后台对应的输入框。
6. 上传 128x128 图标及至少一张 1280x800 截图。
7. 在 **Privacy practices** 页面勾选数据合规项并提供隐私政策链接。
8. 确认无误后点击 **"Submit for review"** 提交审核。

---

## 6. 版本记录 (Version History)

| Version | Date       | Summary of Changes                       | Status |
| ------- | ---------- | ---------------------------------------- | ------ |
| 0.1.0   | 2026-07-28 | Initial release under the name Bug Lens. | Draft  |
