import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("PopupApp component tree retains essential CSS layout classes to prevent UI regression", () => {
  const popupAppCode = [
    "PopupApp.tsx",
    "RecordPanel.tsx",
    "OptionsGrid.tsx",
    "HistoryList.tsx",
  ]
    .map((file) =>
      readFileSync(
        resolve(process.cwd(), `src/components/popup/${file}`),
        "utf8"
      )
    )
    .join("\n");

  // 校验外层主布局容器与核心视觉容器 CSS class 存续，防止 UI 渲染错乱退化
  assert.ok(
    popupAppCode.includes('className="shell"') ||
      popupAppCode.includes('class="shell"'),
    "Must contain <main class='shell'> outer layout container"
  );
  assert.ok(
    popupAppCode.includes('className="brand"') ||
      popupAppCode.includes('class="brand"'),
    "Must contain <header class='brand'> navbar header"
  );
  assert.ok(
    popupAppCode.includes('className="context-flow"') ||
      popupAppCode.includes('class="context-flow"'),
    "Must contain <div class='context-flow'> context card"
  );
  assert.ok(
    popupAppCode.includes('className="action-btn start"') ||
      popupAppCode.includes('class="action-btn start"'),
    "Must contain primary action button with 'action-btn start' styling"
  );
  assert.ok(
    popupAppCode.includes('data-testid="take-screenshot-btn"'),
    "Must contain independent screenshot action button with data-testid='take-screenshot-btn'"
  );
  assert.ok(
    popupAppCode.includes('className="scopes-grid"') ||
      popupAppCode.includes('class="scopes-grid"'),
    "Must contain scope grid styling container"
  );
});

test("PopupApp component tree i18n keys are 100% covered in locale bundles", () => {
  const popupAppCode = [
    "PopupApp.tsx",
    "RecordPanel.tsx",
    "OptionsGrid.tsx",
    "HistoryList.tsx",
  ]
    .map((file) =>
      readFileSync(
        resolve(process.cwd(), `src/components/popup/${file}`),
        "utf8"
      )
    )
    .join("\n");
  const zhDict = JSON.parse(
    readFileSync(
      resolve(process.cwd(), "src/_locales/zh_CN/messages.json"),
      "utf8"
    )
  );
  const enDict = JSON.parse(
    readFileSync(
      resolve(process.cwd(), "src/_locales/en/messages.json"),
      "utf8"
    )
  );

  // 匹配所有 t("key") 调用的正则表达式
  const tKeyMatches = [...popupAppCode.matchAll(/\bt\(\s*["']([^"']+)["']/g)];
  const usedKeys = Array.from(new Set(tKeyMatches.map((m) => m[1])));

  assert.ok(usedKeys.length > 0, "PopupApp must use i18n keys");

  for (const key of usedKeys) {
    assert.ok(
      key in zhDict,
      `i18n key '${key}' used in PopupApp.tsx is missing in zh_CN/messages.json`
    );
    assert.ok(
      key in enDict,
      `i18n key '${key}' used in PopupApp.tsx is missing in en/messages.json`
    );
  }
});

test("确认弹窗（清空历史）按钮文案走 i18n，不硬编码中文", () => {
  const popupApp = readFileSync(
    resolve(process.cwd(), "src/components/popup/PopupApp.tsx"),
    "utf8"
  );
  const zhDict = JSON.parse(
    readFileSync(
      resolve(process.cwd(), "src/_locales/zh_CN/messages.json"),
      "utf8"
    )
  );
  const enDict = JSON.parse(
    readFileSync(
      resolve(process.cwd(), "src/_locales/en/messages.json"),
      "utf8"
    )
  );

  // 提取自定义确认弹窗区域（从 overlay 容器到主布局结束）
  const modalStart = popupApp.indexOf('className="confirm-overlay"');
  assert.ok(modalStart !== -1, "PopupApp 应包含确认弹窗容器 confirm-overlay");
  const modalEnd = popupApp.indexOf("</main>", modalStart);
  assert.ok(modalEnd !== -1, "确认弹窗区域应能在 </main> 前截取到");
  const modal = popupApp.slice(modalStart, modalEnd);

  // 按钮必须复用 i18n key（与弹窗 message 一致的双语通道）
  assert.ok(
    modal.includes('{t("cancelShort")}'),
    '取消按钮应使用 t("cancelShort") 而非硬编码中文'
  );
  assert.ok(
    modal.includes('{t("expectedConfirm")}'),
    '确定按钮应使用 t("expectedConfirm") 而非硬编码中文'
  );

  // 弹窗区域不得残留硬编码按钮文案
  assert.ok(
    !modal.includes(">取消<"),
    "确认弹窗不应包含硬编码「取消」按钮文案"
  );
  assert.ok(
    !modal.includes(">确定<"),
    "确认弹窗不应包含硬编码「确定」按钮文案"
  );

  // 两个 key 必须在双语字典中都存在
  for (const key of ["cancelShort", "expectedConfirm"]) {
    assert.ok(key in zhDict, `i18n key '${key}' 缺失于 zh_CN/messages.json`);
    assert.ok(key in enDict, `i18n key '${key}' 缺失于 en/messages.json`);
  }
});

test("PopupApp 开始录制进入 pending 态：禁用按钮防止重复提交，并提供启动反馈", () => {
  const popupApp = readFileSync(
    resolve(process.cwd(), "src/components/popup/PopupApp.tsx"),
    "utf8"
  );
  const recordPanel = readFileSync(
    resolve(process.cwd(), "src/components/popup/RecordPanel.tsx"),
    "utf8"
  );
  const popupCss = readFileSync(
    resolve(process.cwd(), "src/entrypoints/popup/styles/popup.css"),
    "utf8"
  );

  // 启动是异步慢操作（权限检查/取流/内容脚本注入）：
  // 提交期间必须禁用开始按钮并显示"正在启动"反馈，防止双击触发第二个 session/start
  assert.ok(
    /disabled=\{!canCapture \|\| starting\}/.test(recordPanel),
    "Start button must be disabled while starting or on non-capturable tabs (pending state)"
  );
  assert.ok(
    recordPanel.includes('starting ? t("recordingStarting")'),
    "Start button must show starting feedback text while pending"
  );
  assert.ok(
    popupApp.includes("starting={starting}"),
    "PopupApp must pass starting state down to RecordPanel"
  );
  assert.ok(
    popupApp.includes("setStarting(true)"),
    "PopupApp must set pending state before awaiting session/start"
  );
  assert.ok(
    popupApp.includes("setStarting(false)"),
    "PopupApp must clear pending state after start resolves or fails"
  );
  assert.ok(
    popupCss.includes("button.action-btn:disabled"),
    "Popup CSS must provide a disabled visual state for action buttons"
  );
});

test("首次引导已迁移至 GitHub Pages 网页，扩展内不再内嵌引导（B1 演进）", () => {
  const popupApp = readFileSync(
    resolve(process.cwd(), "src/components/popup/PopupApp.tsx"),
    "utf8"
  );
  const background = readFileSync(
    resolve(process.cwd(), "src/entrypoints/background/events.ts"),
    "utf8"
  );
  const guidePage = readFileSync(
    resolve(process.cwd(), "site/index.html"),
    "utf8"
  );

  // 扩展内不再保留 Popup 内嵌引导（以网页引导为主）
  assert.ok(
    !popupApp.includes("hasCompletedGuide"),
    "PopupApp 不应再包含扩展内引导的完成标记逻辑"
  );
  assert.ok(
    !popupApp.includes("PopupGuide"),
    "PopupApp 不应再引用 PopupGuide 组件"
  );

  // background 在首次安装时打开 GitHub Pages 引导页（自动化测试可跳过）
  assert.ok(
    background.includes("onInstalled"),
    "background events 应监听 onInstalled 以在安装后打开引导页"
  );
  assert.ok(
    background.includes("aoyia.github.io/bug-lens"),
    "background events 应指向 GitHub Pages 引导页地址"
  );
  assert.ok(
    background.includes("skipOnboardingGuide"),
    "background events 应支持 skipOnboardingGuide 跳过标记（自动化测试）"
  );
  assert.ok(
    background.includes("BUG_LENS_IS_E2E") &&
      background.includes("navigator.webdriver"),
    "background events 应在自动化测试环境下（构建标志与 webdriver 检测）直接隔离跳过引导页打开"
  );

  // GitHub Pages 引导页存在且包含核心内容
  assert.ok(guidePage.includes("Bug Lens"), "docs/index.html 应包含产品名");
});

test("历史会话卡片整卡可点击打开预览，内嵌操作按钮必须阻止冒泡", () => {
  const historyList = readFileSync(
    resolve(process.cwd(), "src/components/popup/HistoryList.tsx"),
    "utf8"
  );

  // 会话卡片主体必须绑定打开预览的点击处理器（与 :hover 蓝色描边的可点击
  // 暗示保持一致，避免"看着可点、点了没反应"的交互断裂）
  assert.ok(
    /<article\b[^>]*onClick=\{\(\) => onOpenPreview\(session\.id\)\}/.test(
      historyList
    ),
    "Session card must open preview on click"
  );

  // 内嵌的继续/预览/删除按钮必须阻止事件冒泡，避免点按钮时同时触发达成
  // 打开预览的双重动作
  const bubbleGuards = historyList.match(
    /onClick=\{\(e\) => \{\s*e\.stopPropagation\(\);/g
  );
  assert.ok(
    bubbleGuards && bubbleGuards.length >= 3,
    [
      "Resume / preview / delete buttons must stopPropagation",
      `found ${bubbleGuards?.length ?? 0} guards`,
    ].join(": ")
  );
});

test("历史视图加载期间不得渲染空状态（加载门控）", () => {
  const popupApp = readFileSync(
    resolve(process.cwd(), "src/components/popup/PopupApp.tsx"),
    "utf8"
  );
  const historyList = readFileSync(
    resolve(process.cwd(), "src/components/popup/HistoryList.tsx"),
    "utf8"
  );

  // PopupApp 必须维护 historyLoading 状态：查询开始置位、最新请求结束复位，
  // 并用单调递增请求序号防止防抖查询与视图切换的竞态覆盖。
  assert.match(
    popupApp,
    /historyLoading/,
    "PopupApp 应维护 historyLoading 状态"
  );
  assert.match(
    popupApp,
    /setHistoryLoading\(true\)/,
    "refreshHistory 开始时必须置位 historyLoading"
  );
  assert.match(
    popupApp,
    /setHistoryLoading\(false\)/,
    "refreshHistory 结束时必须复位 historyLoading"
  );
  assert.match(
    popupApp,
    /historyRequestIdRef/,
    "refreshHistory 应使用请求序号防止竞态覆盖"
  );

  // HistoryList 必须接收 loading prop，且空状态分支必须被加载门控：
  // 加载中且无缓存列表时渲染加载占位（t("loading")），而非"无匹配记录"空状态。
  assert.match(
    historyList,
    /loading: boolean/,
    "HistoryList 应声明 loading prop"
  );
  const emptyStateIndex = historyList.indexOf('className="empty-state"');
  const loadingGateIndex = historyList.indexOf("loading ?");
  assert.ok(
    loadingGateIndex > 0 && loadingGateIndex < emptyStateIndex,
    "加载门控（loading ? 分支）必须位于空状态渲染之前：加载中不得展示空状态"
  );
  assert.match(historyList, /loading-state/, "加载中应渲染 loading-state 占位");
});

test("历史视图会话状态标签必须本地化，不能直接渲染内部枚举", () => {
  const historyList = readFileSync(
    resolve(process.cwd(), "src/components/popup/HistoryList.tsx"),
    "utf8"
  );
  const zhDict = JSON.parse(
    readFileSync(
      resolve(process.cwd(), "src/_locales/zh_CN/messages.json"),
      "utf8"
    )
  );
  const enDict = JSON.parse(
    readFileSync(
      resolve(process.cwd(), "src/_locales/en/messages.json"),
      "utf8"
    )
  );

  // 状态标签必须经由本地化标签函数渲染，而非把 session.status 内部枚举
  // （PREVIEW_READY / EXPORTED / FAILED 等）直接展示给用户
  assert.ok(
    historyList.includes("sessionStatusLabel(session.status)"),
    "Status tag must render through the localized label function"
  );
  assert.ok(
    !historyList.includes(">{session.status}<"),
    "Status tag must not render the raw SessionStatus enum"
  );

  // 映射必须覆盖协议定义的全部会话状态，防止新增状态时漏配本地化文案
  const protocolStatuses = [
    "IDLE",
    "PREPARING",
    "RECORDING",
    "DEGRADED",
    "STOPPING",
    "PREVIEW_READY",
    "EXPORTING",
    "EXPORTED",
    "FAILED",
  ];
  const sessionStatusKeys = [
    "sessionStatusIdle",
    "sessionStatusPreparing",
    "sessionStatusRecording",
    "sessionStatusDegraded",
    "sessionStatusStopping",
    "sessionStatusPreviewReady",
    "sessionStatusExporting",
    "sessionStatusExported",
    "sessionStatusFailed",
  ];

  for (const status of protocolStatuses) {
    assert.ok(
      historyList.includes(`${status}:`),
      `Session status mapping must cover ${status}`
    );
  }

  // 每个状态 key 必须同时存在于中英双语 locale 包
  for (const key of sessionStatusKeys) {
    assert.ok(key in zhDict, `zh_CN/messages.json must define '${key}'`);
    assert.ok(key in enDict, `en/messages.json must define '${key}'`);
  }
});

test("历史视图 footer 会话数在存储未就绪时显示加载提示而非硬编码中文", () => {
  const historyList = readFileSync(
    resolve(process.cwd(), "src/components/popup/HistoryList.tsx"),
    "utf8"
  );

  // storage 未就绪时 #storage-count 必须与相邻 #storage-used 一致地回退到
  // t("loading")（"正在读取…"/"Loading…"）：
  // - 不再谎报"0 个会话"（加载期间向用户提供错误数据状态，与列表空状态同源问题）
  // - 不再在英文界面渲染硬编码中文（破坏扩展全量中英双语一致性）
  assert.ok(
    historyList.includes('id="storage-count"'),
    "Must retain storage-count span in history footer"
  );
  assert.ok(
    historyList.includes('t("sessionsCount", String(storage.sessionCount))'),
    "Storage count must render localized session count when storage is available"
  );
  assert.ok(
    !historyList.includes('"0 个会话"'),
    "Storage count fallback must not be a hardcoded Chinese string"
  );
  assert.ok(
    historyList.includes(
      't("sessionsCount", String(storage.sessionCount))\n            : t("loading")'
    ),
    "Storage count fallback must use t('loading') like the sibling storage-used span"
  );
});

test("进入历史视图必须把焦点交给搜索框（主操作控件直达）", () => {
  const popupApp = readFileSync(
    resolve(process.cwd(), "src/components/popup/PopupApp.tsx"),
    "utf8"
  );

  // 第一性原理：历史视图的主操作控件是搜索框，视图进入时焦点应直达该控件，
  // 免去「点历史图标 → 再点搜索框」的一次多余点击；同时让 popup-escape 的
  // 两段式语义（焦点在搜索框 + 有关键词 → 第一下 Escape 清空搜索）成为
  // 进入历史视图的自然默认态。接线必须存在且随 currentView 变化触发。
  assert.match(
    popupApp,
    /import\s*\{[^}]*focusHistorySearchOnEntry[^}]*\}\s*from\s*["']\.\.\/\.\.\/popup\/history-search-focus["']/,
    "PopupApp 必须从 history-search-focus 模块导入 focusHistorySearchOnEntry"
  );

  const callStart = popupApp.indexOf("focusHistorySearchOnEntry({");
  assert.ok(callStart >= 0, "PopupApp 必须调用 focusHistorySearchOnEntry");
  const callTail = popupApp.slice(callStart, callStart + 400);
  assert.ok(
    callTail.includes("currentView,") && callTail.includes("getSearchInput:"),
    "聚焦调用必须传入 currentView 并解析搜索框"
  );
  assert.ok(
    callTail.includes('document.getElementById("search")'),
    "getSearchInput 必须解析到 #search 搜索框（与 popup-escape 的焦点判定同源）"
  );
  assert.ok(
    /}, \[currentView\]\);/.test(callTail),
    "聚焦 effect 必须以 currentView 为依赖（仅在视图切换时触发）"
  );
});

test("PopupApp 闲置态展示 3 步工作流心智卡片，并经由 storage 计数至多展示 5 次", () => {
  const popupApp = readFileSync(
    resolve(process.cwd(), "src/components/popup/PopupApp.tsx"),
    "utf8"
  );
  const recordPanel = readFileSync(
    resolve(process.cwd(), "src/components/popup/RecordPanel.tsx"),
    "utf8"
  );
  const popupCss = readFileSync(
    resolve(process.cwd(), "src/entrypoints/popup/styles/popup.css"),
    "utf8"
  );

  // 1. PopupApp 必须定义 MAX_WORKFLOW_GUIDE_VIEWS = 5 门控阈值并读取/更新 workflowGuideViewCount
  assert.match(
    popupApp,
    /MAX_WORKFLOW_GUIDE_VIEWS\s*=\s*5/,
    "PopupApp 必须定义至多展示 5 次的门控常量"
  );
  assert.match(
    popupApp,
    /workflowGuideViewCount/,
    "PopupApp 必须在 local storage 中读写 workflowGuideViewCount"
  );
  assert.match(
    popupApp,
    /showWorkflowGuide=\{showWorkflowGuide\}/,
    "PopupApp 必须将 showWorkflowGuide 状态传递给 RecordPanel"
  );

  // 2. RecordPanel 必须在 !active && !ready && showWorkflowGuide 时渲染 workflow-guide
  assert.match(
    recordPanel,
    /showWorkflowGuide/,
    "RecordPanel 必须声明 showWorkflowGuide prop"
  );
  assert.match(
    recordPanel,
    /className="workflow-guide"/,
    "RecordPanel 必须包含 className='workflow-guide' 容器"
  );
  assert.match(
    recordPanel,
    /t\("workflowStepStart"\)/,
    "引导卡片步骤 1 必须使用 t('workflowStepStart')"
  );
  assert.match(
    recordPanel,
    /t\("workflowStepReproduce"\)/,
    "引导卡片步骤 2 必须使用 t('workflowStepReproduce')"
  );
  assert.match(
    recordPanel,
    /t\("workflowStepPromptAi"\)/,
    "引导卡片步骤 3 必须使用 t('workflowStepPromptAi')"
  );
  assert.match(
    recordPanel,
    /t\("workflowAiHint"\)/,
    "引导卡片必须使用 t('workflowAiHint') 交付说明"
  );

  // 3. CSS 样式必须定义 .workflow-guide
  assert.match(
    popupCss,
    /\.workflow-guide\s*\{/,
    "popup.css 必须包含 .workflow-guide 样式规则"
  );
});

test("OptionsGrid 录制锁定态：提供 not-allowed 禁用光标、视觉分层与 Hover Tooltip 提示", () => {
  const optionsGrid = readFileSync(
    resolve(process.cwd(), "src/components/popup/OptionsGrid.tsx"),
    "utf8"
  );
  const popupCss = readFileSync(
    resolve(process.cwd(), "src/entrypoints/popup/styles/popup.css"),
    "utf8"
  );
  const zhDict = JSON.parse(
    readFileSync(
      resolve(process.cwd(), "src/_locales/zh_CN/messages.json"),
      "utf8"
    )
  );
  const enDict = JSON.parse(
    readFileSync(
      resolve(process.cwd(), "src/_locales/en/messages.json"),
      "utf8"
    )
  );

  // 1. OptionsGrid 必须定义 lockedTitle 并绑定至 options/selects
  assert.match(
    optionsGrid,
    /lockedTitle\s*=\s*controlsLocked\s*\?\s*t\("configLockedDuringRecording"\)\s*:\s*undefined/,
    "OptionsGrid 必须在 controlsLocked 时计算 configLockedDuringRecording 悬停提示"
  );
  assert.match(
    optionsGrid,
    /title=\{lockedTitle\}/,
    "OptionsGrid 必须将 lockedTitle 绑定至配置项"
  );

  // 2. 双语字典中必须存在 configLockedDuringRecording key
  assert.ok(
    "configLockedDuringRecording" in zhDict,
    "zh_CN/messages.json 必须包含 configLockedDuringRecording"
  );
  assert.ok(
    "configLockedDuringRecording" in enDict,
    "en/messages.json 必须包含 configLockedDuringRecording"
  );

  // 3. CSS 必须定义禁用光标与视觉弱化样式
  assert.match(
    popupCss,
    /\.scope-chip:has\(input:disabled\)/,
    "popup.css 必须包含 .scope-chip:has(input:disabled) 规则"
  );
  assert.match(
    popupCss,
    /cursor:\s*not-allowed/,
    "popup.css 必须提供 cursor: not-allowed"
  );
});

test("PopupApp 录制配置即时自动持久化：具备加载守卫与变更自动存盘", () => {
  const popupApp = readFileSync(
    resolve(process.cwd(), "src/components/popup/PopupApp.tsx"),
    "utf8"
  );

  // 1. 必须具备初始化守卫 optionsLoadedRef，防止初始默认值覆盖已存盘配置
  assert.match(
    popupApp,
    /optionsLoadedRef\s*=\s*useRef\(false\)/,
    "PopupApp 必须使用 optionsLoadedRef 记录初始化加载状态"
  );
  assert.match(
    popupApp,
    /optionsLoadedRef\.current\s*=\s*true/,
    "PopupApp 读取 local storage 后必须标记 optionsLoadedRef.current = true"
  );

  // 2. 必须具备自动存盘 useEffect，监听配置项并存入 last-recording-options
  assert.match(
    popupApp,
    /if\s*\(\!optionsLoadedRef\.current\)\s*return/,
    "自动存盘 effect 必须在未完成初始化时提前返回"
  );
  assert.match(
    popupApp,
    /chrome\.storage\.local\s*\.\s*set\(\{\s*["']last-recording-options["']:\s*options\s*\}\)/,
    "必须将更新后的 options 即时写入 chrome.storage.local"
  );
});

test("OptionsGrid 一级采集源收敛为 2×3 矩阵，移除 bodies/full-response-body chip 并下沉为独立表单行 (方案 A)", () => {
  const optionsGrid = readFileSync(
    resolve(process.cwd(), "src/components/popup/OptionsGrid.tsx"),
    "utf8"
  );
  const popupApp = readFileSync(
    resolve(process.cwd(), "src/components/popup/PopupApp.tsx"),
    "utf8"
  );
  const popupCss = readFileSync(
    resolve(process.cwd(), "src/entrypoints/popup/styles/popup.css"),
    "utf8"
  );
  const zhDict = JSON.parse(
    readFileSync(
      resolve(process.cwd(), "src/_locales/zh_CN/messages.json"),
      "utf8"
    )
  );
  const enDict = JSON.parse(
    readFileSync(
      resolve(process.cwd(), "src/_locales/en/messages.json"),
      "utf8"
    )
  );

  // R1: 校验 .scopes-grid 严格只包含 6 个一级采集维度：video, audio, screenshots, console, network, framework-state
  const scopesGridStart = optionsGrid.indexOf('className="scopes-grid"');
  assert.ok(scopesGridStart > 0, "OptionsGrid 必须包含 .scopes-grid 容器");
  const scopesGridEnd = optionsGrid.indexOf("</div>", scopesGridStart);
  const scopesGridContent = optionsGrid.slice(scopesGridStart, scopesGridEnd);

  const expectedChipIds = [
    "video",
    "audio",
    "screenshots",
    "console",
    "network",
    "framework-state",
  ];
  for (const id of expectedChipIds) {
    assert.ok(
      scopesGridContent.includes(`id="${id}"`),
      `.scopes-grid 必须包含一级芯片 #${id}`
    );
  }

  // 严格确保原网格中的 bodies 和 full-response-body 两个 Chip 已从网格中彻底移除
  assert.ok(
    !scopesGridContent.includes('id="bodies"'),
    ".scopes-grid 不得残留 #bodies 芯片"
  );
  assert.ok(
    !scopesGridContent.includes('id="full-response-body"'),
    ".scopes-grid 不得残留 #full-response-body 芯片"
  );

  // 统计 input[type=checkbox] 数量恰好为 6 个
  const chipMatches = scopesGridContent.match(/type="checkbox"/g);
  assert.equal(
    chipMatches?.length,
    6,
    ".scopes-grid 必须严格由 6 个元素填满（2×3 矩阵）"
  );

  // R2: 在 .scopes-grid 下方、Masking 上方新增响应正文策略控制项
  const responseBodiesSelectIdx = optionsGrid.indexOf('id="response-bodies"');
  const privacySelectIdx = optionsGrid.indexOf('id="privacy"');
  assert.ok(
    responseBodiesSelectIdx > scopesGridEnd &&
      responseBodiesSelectIdx < privacySelectIdx,
    "响应正文策略下拉框必须位于 .scopes-grid 下方且在 Masking (privacy) 上方"
  );

  // 样式与现有的 Masking、Language 行保持一致
  assert.match(
    optionsGrid,
    /<label className="video-quality-row"[^>]*>[\s\S]*?<span className="video-quality-label">\s*\{t\("responseBodiesLabel"\)\}\s*<\/span>[\s\S]*?<select\s+id="response-bodies"\s+className="privacy-select"/,
    "响应正文行必须复用 .video-quality-row 与 .privacy-select 统一表单样式"
  );

  // 3 档互斥选项
  assert.match(
    optionsGrid,
    /<option value="disabled">\{t\("responseBodiesDisabled"\)\}<\/option>/
  );
  assert.match(
    optionsGrid,
    /<option value="standard">\{t\("responseBodiesStandard"\)\}<\/option>/
  );
  assert.match(
    optionsGrid,
    /<option value="full">\{t\("responseBodiesFull"\)\}<\/option>/
  );

  // 联动显示：未勾选 Network 时不展示响应正文行，勾选后才显示且受 controlsLocked 保护
  assert.match(
    optionsGrid,
    /\{captureNetwork && \([\s\S]*?<select\s+id="response-bodies"/,
    "响应正文下拉行必须仅在 captureNetwork 为 true 时才渲染显示"
  );
  assert.match(
    optionsGrid,
    /<select\s+id="response-bodies"[\s\S]*?disabled=\{controlsLocked\}/,
    "响应正文下拉框在录制期间必须受 controlsLocked 禁用保护"
  );

  // R3: PopupApp 状态绑定与持久化
  assert.match(
    popupApp,
    /responseBodyPolicy/,
    "PopupApp 必须计算或管理 responseBodyPolicy"
  );
  assert.match(
    popupApp,
    /handleSetResponseBodyPolicy/,
    "PopupApp 必须具备 handleSetResponseBodyPolicy 回调处理三态映射"
  );

  // R4: 中英语言包文案完全符合规范且无硬编码
  const expectedKeys = [
    "responseBodiesLabel",
    "responseBodiesDisabled",
    "responseBodiesStandard",
    "responseBodiesFull",
    "responseBodiesNeedNetwork",
  ];
  for (const key of expectedKeys) {
    assert.ok(key in zhDict, `zh_CN 缺失 key: ${key}`);
    assert.ok(key in enDict, `en 缺失 key: ${key}`);
  }
  assert.equal(zhDict.responseBodiesDisabled.message, "不采集");
  assert.equal(zhDict.responseBodiesStandard.message, "标准采集（截断至 2MB）");
  assert.equal(zhDict.responseBodiesFull.message, "完整采集（无截断）");
  assert.equal(zhDict.responseBodiesLabel.message, "响应正文");

  assert.equal(enDict.responseBodiesDisabled.message, "Disabled");
  assert.equal(
    enDict.responseBodiesStandard.message,
    "Standard (Truncate at 2MB)"
  );
  assert.equal(enDict.responseBodiesFull.message, "Full (No Truncation)");
  assert.equal(enDict.responseBodiesLabel.message, "Response Bodies");

  // 视觉规范：.video-quality-label 具有固定宽度保证左侧标签与右侧 Select 完美垂直对齐
  assert.match(
    popupCss,
    /\.video-quality-label\s*\{[^}]*width:\s*\d+px/,
    "popup.css 必须为 .video-quality-label 指定固定宽度以实现下拉行完美垂直对齐"
  );
});

test("PopupApp 响应正文配置持久化：在 Network 切换时不丢失偏好且防御异常历史组合", () => {
  const popupApp = readFileSync(
    resolve(process.cwd(), "src/components/popup/PopupApp.tsx"),
    "utf8"
  );

  // 1. 回填时若存在旧版 captureNetworkBodies: false 但 captureFullResponseBody: true 异常组合，必须校正为 false
  assert.match(
    popupApp,
    /last\.captureFullResponseBody\s*&&\s*last\.captureNetworkBodies\s*!==\s*false/,
    "历史异常组合回填必须受 last.captureNetworkBodies !== false 守卫"
  );

  // 2. 自动存盘 effect 必须保持用户设置的 captureNetworkBodies 与 captureFullResponseBody，避免 Network 关闭时覆写丢失
  assert.match(
    popupApp,
    /captureNetworkBodies,\s*captureFullResponseBody:\s*captureNetworkBodies\s*\?\s*captureFullResponseBody\s*:\s*false/,
    "自动存盘 effect 必须持久化用户的正文策略偏好"
  );
});
