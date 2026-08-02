# 用扩展快捷键代替物理鼠标点击：Chrome 扩展 E2E 自动化的一次转向

> Bug Lens 最初希望纯使用 Playwright 点击开始录制。后来发现，网页自动化的点击和 Chrome 扩展 Action 的真实触发并不是一回事。最终采用操作系统级快捷键自动化，在不依赖人工鼠标的前提下复现了真正的用户启动路径。

![自动化方案的分层示意图](/Users/neoyuan/Desktop/aoyi/bug-lens/blog-assets/native-input-flow.svg)

## 问题背景：录制不是一个普通网页按钮

Bug Lens 是一个 Chrome 扩展。用户开始录制时，实际操作是：

1. 用户正在浏览目标网页；
2. 按下扩展快捷键，或点击浏览器工具栏中的扩展图标；
3. Chrome 打开扩展的 Action Popup；
4. 用户在 Popup 中点击“开始录制”；
5. 扩展启动 tabCapture、Offscreen Recorder 和证据采集。

开始录制的入口属于 Chrome 浏览器和扩展之间的 Action 调用，并不属于目标网页的 DOM。

## 第一种方案：纯 Playwright 点击

最初的想法很直接：使用 Playwright 打开扩展 Popup，然后点击按钮。

    const popup = await context.newPage();
    await popup.goto(extensionPopupUrl);
    await popup.locator('[data-testid="start-recording-btn"]').click();

它可以验证 Popup 自身的 UI，例如选项、按钮、文案和页面内状态变化。

但它直接访问了扩展页面，绕过了用户真正打开 Popup 的方式。测试没有让 Chrome 执行 Action Command。

这会产生一个假阳性：Popup 页面测试通过了，但用户在真实浏览器里按快捷键时，扩展可能根本没有被打开。

## 为什么 Playwright 点击不等于物理点击？

这里要区分三种输入：

| 输入方式 | 发生位置 | 能否代表真实扩展入口 |
| --- | --- | --- |
| Playwright locator.click | 网页或扩展页面 DOM | 只能验证页面事件 |
| CDP 鼠标事件 | 浏览器调试协议 | 不一定代表系统可信输入 |
| 操作系统键盘或鼠标事件 | 桌面系统 | 最接近真实用户操作 |

Playwright 的 click 非常适合网页交互。问题在于，它无法替代 Chrome 工具栏 Action、系统快捷键以及原生对话框这类浏览器外部边界。

## 第二种方案：用扩展快捷键代替物理鼠标点击

最终方案不是让测试人员真的去点击鼠标，而是通过操作系统级驱动，向前台 Chrome 发送扩展快捷键。

    Playwright 打开目标网页
      → 将 Chrome 置于前台
        → osascript / System Events 发送快捷键
          → Chrome 执行 _execute_action
            → 真实 Action Popup 出现
              → Playwright 通过 CDP 附加 Popup
                → 点击 Popup 内的开始录制按钮

这同时满足两个要求：

- 不需要人工物理点击；
- 不绕过 Chrome 扩展的真实 Action 入口。

![快捷键方案与失败日志的 GIF 示意](/Users/neoyuan/Desktop/aoyi/bug-lens/blog-assets/native-input-loop.gif)

## 三层职责如何划分

### Playwright 层

Playwright 负责创建 headed Chrome、加载扩展、打开目标页、等待 Service Worker、通过 CDP 附加真实 Popup、点击 Popup 内按钮，以及检查 IndexedDB、媒体分片和 Preview。

### 操作系统驱动层

macOS 驱动负责聚焦 Google Chrome for Testing、发送扩展快捷键、检查 Chrome 是否成为前台应用，并把辅助功能权限错误转换成可操作的提示。

Linux 环境可以使用 xdotool 完成窗口激活和按键发送。

### 扩展生产层

扩展仍然走正常生产路径：

    _execute_action
      → Action Popup
        → session/start
          → tabCapture
            → Offscreen Recorder
              → IndexedDB

测试没有增加“测试专用开始录制 API”，也没有给生产逻辑增加绕行入口。

## 关键实现：发送快捷键，而不是打开 Popup URL

测试先从扩展 Service Worker 读取 Chrome 已绑定的 Action shortcut：

    const commands = await serviceWorker.evaluate(
      () => chrome.commands.getAll()
    );
    const command = commands.find(
      item => item.name === "_execute_action"
    );

例如将 ⇧⌘Y 解析为 Shift、Command 和 Y。

发送前还要确认 Playwright 目标页和 Chrome 当前活动标签页一致，避免快捷键被发送给错误标签页。

快捷键发送完成后，测试通过 CDP 等待真实的扩展 Popup Target，而不是假设 Popup 一定出现：

    const popup = await attachToPopupTarget(
      browserCdp,
      popupUrl
    );

如果 Popup 没出现，测试报告的是 Action Target 缺失，而不是误判为录制业务失败。

## 遇到的错误：不是代码问题，而是 macOS 权限

![系统权限失败终端示意图](/Users/neoyuan/Desktop/aoyi/bug-lens/blog-assets/failure-terminal.svg)

实际遇到过：

    BROWSER_FOCUS_FAILED
    osascript failed:
    System Events 不允许发送按键 (1002)

日志表明：

    Chrome launched
    Extension Service Worker ready
    Resolved extension action shortcut
    Sending native extension shortcut
    osascript failed

Chrome 和扩展都已经启动，失败发生在系统发送快捷键的阶段。因此它不是扩展代码问题，也不是点击速度太快。

## 为什么 Codex 可以，Terminal 却不行？

macOS 的辅助功能和自动化权限按宿主应用区分：

| 执行宿主 | 需要授权的对象 |
| --- | --- |
| Codex Desktop | Codex 或其 Runner |
| Terminal | Terminal |
| iTerm2 | iTerm2 |
| VS Code | VS Code 或相关 Runner |
| CI | CI Runner |

需要在系统设置中为实际运行测试的应用授权：

    系统设置
      → 隐私与安全性
        → 辅助功能

并在“自动化”中允许它控制 System Events；如果系统显示，也允许控制 Google Chrome for Testing。

授权后要完全退出并重新打开宿主应用。只重开终端标签页有时不够。

## 一个最小的真实 E2E 示例

    // 打开并聚焦目标页
    await targetPage.goto(mockPageUrl);
    await targetPage.bringToFront();
    await targetPage.waitForFunction(
      () => document.hasFocus()
    );

    // 系统驱动发送快捷键，等待真实 Popup
    const popup = await openActionPopup(targetPage);

    // Popup 内部继续使用 Playwright
    await popup.click(
      '[data-testid="start-recording-btn"]'
    );
    await popup.dispose();

    // 验证真实生产录制链路
    const session = await mediaProbe.waitForSession(
      targetTabId
    );
    expect(session.status).toBe("RECORDING");

这段测试没有直接打开 popup.html，而是验证了“目标页 → Chrome Action → Popup → 开始录制”的完整用户入口。

## 这和物理鼠标点击是什么关系？

使用操作系统自动化，并不意味着测试人员必须在旁边手动点击。

它的含义是让测试程序产生操作系统可以识别的真实输入事件：

- macOS：AppleScript 和 System Events；
- Linux：xdotool；
- Windows：桌面自动化 API。

在本方案中，系统驱动只负责发送扩展快捷键。Popup 打开以后，按钮仍由 Playwright 操作。

更准确的描述是：

> 用操作系统级快捷键代替人工鼠标点击，用 Playwright 完成浏览器内部操作和断言。

## 为什么值得保留这类系统级 E2E？

它主要覆盖纯页面测试无法覆盖的高风险边界：

- 扩展 Action 快捷键是否真正可用；
- Chrome 前台焦点是否正确；
- Popup 是否能从真实 Action 打开；
- tabCapture 是否绑定到正确标签页；
- 系统权限错误是否能被清晰报告。

普通业务逻辑仍然应该使用更快的单元测试和页面测试。

## 推荐测试分层

    快速层：TypeScript + 单元测试
      ↓
    目标 E2E：只运行直接相关场景
      ↓
    Desktop Gate：快捷键、录制、原生系统交互
      ↓
    发布前：完整 E2E

日常修改：

    pnpm typecheck
    pnpm test

录制入口修改完成后，再运行目标场景：

    E2E_SLOW_MO_MS=0 E2E_PREVIEW_HOLD_MS=0 \
    pnpm exec playwright test \
      e2e/recording-journey.spec.ts --headed

不要每修改两行代码就运行全量 E2E。

## 最终经验

这次方案转向的核心不是“Playwright 不够强”，而是认识到 Chrome 扩展存在网页之外的信任边界。

纯 Playwright 点击适合网页 DOM；操作系统级快捷键适合 Chrome Action。两者组合，才能在不依赖人工鼠标的情况下复现真实用户启动扩展的路径。

    Playwright
      + 操作系统输入驱动
        + Chrome 扩展真实入口
          + 生产录制链路

它比直接访问 Popup 页面更接近真实用户，也比每次人工物理点击更适合持续回归测试。
