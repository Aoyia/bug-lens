# Bug Lens E2E

完整录屏用例通过 Chrome 的 `_execute_action` 快捷键打开真实扩展 Popup，不再直接访问 `popup.html`。开始录制使用 Action Popup，停止录制点击目标页中的可见录制控件，并验证 tabCapture、Offscreen Recorder、IndexedDB 媒体分片和 Preview 视频。

## macOS 首次配置

> **重要：macOS 按“启动测试的应用”分别授予权限。** Codex 能运行测试，不代表 Terminal、iTerm、Warp 或 IDE 也有权限。你从哪个应用执行 `pnpm test:e2e`，就必须为哪个应用单独授权。

1. 打开“系统设置 → 隐私与安全性 → 辅助功能”。
2. 允许启动测试的 Terminal、iTerm、Warp、IDE 或 Runner 控制电脑。
3. 打开“隐私与安全性 → 自动化”，允许同一应用控制 `System Events`；如果系统显示相关选项，也允许控制 `Google Chrome for Testing`。
4. **完全退出并重新打开对应应用**，使权限生效。
5. 运行 `pnpm test:e2e`。

如果看到 `MACOS_ACCESSIBILITY_PERMISSION_REQUIRED` 或“`osascript` 不允许发送按键 `(1002)`”，说明当前启动应用的权限仍未生效。可尝试关闭后重新开启权限，或删除系统设置中的旧条目再重新添加。

### 跳过辅助功能预检（可选）

`global-setup.ts` 的预检保护的是**系统级键盘模拟**（通过 `System Events` 发送 `⇧⌘Y` 唤起真实 Action Popup），不是 Playwright/Chromium 本身：headed Chromium 启动、加载扩展、页面操作都不需要该权限。

```bash
BUG_LENS_SKIP_ACCESSIBILITY_PREFLIGHT=1 npx playwright test e2e/options-preview.spec.ts
```

- 默认行为不变：不设置该变量时仍强制预检，未授权直接中断。
- 设置后 global-setup 打印醒目告警并列出依赖原生快捷键的 spec；这些用例会在 `nativeShortcutDriver` fixture 中被 `test.skip`（不会计为通过），其余用例照常运行。
- 需要观察真实失败时，再叠加 `BUG_LENS_FORCE_RUN_SHORTCUT_TESTS=1`，此时依赖快捷键的用例不会被跳过，会以 `NATIVE_SHORTCUT_PREFLIGHT_FAILED ... (-10004)` 之类的错误失败。
- 旧变量 `SKIP_ACCESSIBILITY_CHECK` 仍然有效，是新变量的别名。

### Action Popup 驱动：`BUG_LENS_POPUP_DRIVER`

`openActionPopup` 有两种驱动方式，通过环境变量切换（调用方签名不变）：

| 取值             | 行为                                                                                         | 是否需要辅助功能权限 | 用途                                         |
| ---------------- | -------------------------------------------------------------------------------------------- | -------------------- | -------------------------------------------- |
| `native`（默认） | `System Events` 物理快捷键（`⇧⌘Y`）唤起真实 Action Popup                                     | 是                   | **完整验收**：录制、导出、框架矩阵等全部用例 |
| `extension-page` | service worker 侧 `chrome.action.openPopup()` 打开真实 Action Popup，再由 CDP 驱动弹层内控件 | 否                   | 仅**降级冒烟**（见下方能力边界）             |

```bash
# 只做无权限冒烟
BUG_LENS_POPUP_DRIVER=extension-page npx playwright test e2e/recording-framework-matrix.spec.ts --grep "vue2"
```

#### `extension-page` 的真实能力边界

**能验证什么**（已实测通过）：

- Action Popup 是**真实 Action Popup 窗口**（`chrome.action.openPopup()` 产生 `type=page` 的 `popup.html` target），不是 `context.newPage()` 打开的新标签页；
- `[data-testid="record-panel"]` 出现；
- 弹层内 `chrome.tabs.query({active:true,currentWindow:true})` 正确解析为**目标 app tab**（而非 popup 自身）；
- 录制确实启动：目标页出现 `#__wbr_issue_btn__`，页面录制控件（REC 计时器）存在。

**不能验证什么**：

- `chrome.tabCapture.getMediaStreamId()` 会被 Chrome 的 activeTab 安全模型拒绝，原始报错：

  ```text
  Extension has not been invoked for the current page (see activeTab permission). Chrome pages cannot be captured.
  ```

- 会话因此降级为**无视频流**录制；凡经过 `mediaProbe.waitForActive`（要求 `tabCapture` 为 `active`）的录制/导出用例都会在该步失败，例如 `recording-framework-matrix.spec.ts` 会在 `waitForActive` 处抛 `MEDIA_STREAM_ID_FAILED`。

**结论**：`extension-page` 只能作为「无辅助功能权限环境下的降级冒烟」，**不能替代 native 驱动做完整验收**；它不会、也无法让矩阵类完整录制用例跑通。

**为什么程序化授予 activeTab 无解**（4 组对照 + 1 组按键注入，全部为实测）：

| 尝试                                                                                      | 结果                                                                               |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| service worker 直接调 `getMediaStreamId`                                                  | 同样报错                                                                           |
| `chrome.action.openPopup()` 之后调用（openPopup 不授予 activeTab）                        | 同样报错                                                                           |
| `chrome.scripting.executeScript` 成功之后调用（已有 `http://*/*` host permission 也无效） | 同样报错                                                                           |
| 在扩展页内做 Playwright 受信任点击之后再调用                                              | 同样报错                                                                           |
| CDP 注入 `Meta+Shift+Y` / `Alt+R`                                                         | 不经过浏览器 accelerator 分支：popup target 数为 0，无 session，activeTab 仍未授予 |

即：`tabCapture` 要求扩展被**真实用户手势调用**（工具栏点击或 OS 级快捷键），只能由 `native` 驱动提供。

#### 各驱动下的跳过策略

`native` 驱动不可用（或显式 `BUG_LENS_SKIP_ACCESSIBILITY_PREFLIGHT=1`）时，`shortcut-recording.spec.ts`（依赖 `nativeShortcutDriver`）会被 `test.skip` 精确跳过；`export.spec.ts` 的 `EXP-001-native-save` 通过 `nativeSaveDialogDriver.isAvailable()` 运行时判定并自行跳过。`BUG_LENS_POPUP_DRIVER=extension-page` 时，只经 `openActionPopup` 的用例不再跳过（它们仍会因上述 tabCapture 限制在深层失败，这是有意暴露的真实失败，不是通过）。

Playwright 当前使用 `Google Chrome for Testing`。如果改用其他浏览器 channel，可通过 `E2E_BROWSER_APP_NAME` 指定 macOS 中显示的进程名。

测试执行期间 Chrome 会短暂成为前台应用，并自动发送一次扩展快捷键。请不要同时运行其他依赖桌面焦点的自动化任务。

本地运行默认以 `250ms` 的 `slowMo` 放慢浏览器操作，并在全部断言通过后让 Preview 页面额外停留 `8s`。可通过 `E2E_SLOW_MO_MS` 和 `E2E_PREVIEW_HOLD_MS` 调整，例如：

```bash
E2E_SLOW_MO_MS=500 E2E_PREVIEW_HOLD_MS=15000 pnpm test:e2e
```

CI 默认关闭这两项等待。测试终端会输出带时间戳的阶段日志、浏览器 Console 信息、录制状态和最终证据统计，便于定位 Popup、录屏或 Preview 阶段的问题。

## Linux CI

Linux 必须使用 headed Chromium，并提供 Xvfb、窗口管理器和 `xdotool`。`DISPLAY` 必须指向该 Job 独占的虚拟桌面。浏览器窗口类无法自动匹配时，通过 `E2E_BROWSER_WINDOW_CLASS` 覆盖默认正则。

## 导出测试平台矩阵

导出链路拆分为两个用例，避免非 macOS CI 静默跳过核心验证：

- `EXP-001-core`：**所有平台**执行。录制 → 排除 → 导出 ZIP → 完整性/内容校验 → 离线报告 → AI 交接，导出通过 Playwright download 事件拦截，不依赖原生保存对话框。
- `EXP-001-native-save`：**仅 macOS** 执行（静态 skip + annotation 可见跳过）。驱动真实原生保存对话框，验证文件落盘到用户选择的目录。

Linux/Windows CI 至少应执行 `EXP-001-core`，保证导出核心旅程与 ZIP 完整性始终有覆盖。

## 验证命令

- `pnpm typecheck`：检查产品代码和 E2E TypeScript。
- `pnpm test`：运行单元测试。
- `pnpm test:e2e`：构建扩展并运行真实录屏旅程。

当系统输入权限不可用时，用例会以 `NATIVE_DRIVER_UNAVAILABLE` 快速失败，不会回退到普通扩展页或降级录像。
