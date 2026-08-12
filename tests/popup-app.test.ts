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
