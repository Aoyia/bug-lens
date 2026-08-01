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

Playwright 当前使用 `Google Chrome for Testing`。如果改用其他浏览器 channel，可通过 `E2E_BROWSER_APP_NAME` 指定 macOS 中显示的进程名。

测试执行期间 Chrome 会短暂成为前台应用，并自动发送一次扩展快捷键。请不要同时运行其他依赖桌面焦点的自动化任务。

本地运行默认以 `250ms` 的 `slowMo` 放慢浏览器操作，并在全部断言通过后让 Preview 页面额外停留 `8s`。可通过 `E2E_SLOW_MO_MS` 和 `E2E_PREVIEW_HOLD_MS` 调整，例如：

```bash
E2E_SLOW_MO_MS=500 E2E_PREVIEW_HOLD_MS=15000 pnpm test:e2e
```

CI 默认关闭这两项等待。测试终端会输出带时间戳的阶段日志、浏览器 Console 信息、录制状态和最终证据统计，便于定位 Popup、录屏或 Preview 阶段的问题。

## Linux CI

Linux 必须使用 headed Chromium，并提供 Xvfb、窗口管理器和 `xdotool`。`DISPLAY` 必须指向该 Job 独占的虚拟桌面。浏览器窗口类无法自动匹配时，通过 `E2E_BROWSER_WINDOW_CLASS` 覆盖默认正则。

## 验证命令

- `pnpm typecheck`：检查产品代码和 E2E TypeScript。
- `pnpm test`：运行单元测试。
- `pnpm test:e2e`：构建扩展并运行真实录屏旅程。

当系统输入权限不可用时，用例会以 `NATIVE_DRIVER_UNAVAILABLE` 快速失败，不会回退到普通扩展页或降级录像。
