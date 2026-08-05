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
    "PopupGuide.tsx",
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
    "PopupGuide.tsx",
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

test("首次使用引导移至 Popup 打开时展示（B1）", () => {
  const popupApp = readFileSync(
    resolve(process.cwd(), "src/components/popup/PopupApp.tsx"),
    "utf8"
  );
  const guide = readFileSync(
    resolve(process.cwd(), "src/components/popup/PopupGuide.tsx"),
    "utf8"
  );
  const widget = readFileSync(
    resolve(
      process.cwd(),
      "src/entrypoints/content/collector/recording-widget.ts"
    ),
    "utf8"
  );

  // 引导在 Popup 挂载时检查存储标记并展示
  assert.ok(
    popupApp.includes("hasCompletedGuide"),
    "PopupApp 应在挂载时读取 hasCompletedGuide 标记"
  );
  assert.ok(
    popupApp.includes("skipOnboardingGuide"),
    "PopupApp 应支持 skipOnboardingGuide 跳过标记"
  );
  assert.ok(
    popupApp.includes("hasCompletedGuide: true"),
    "引导完成或跳过时应写入 hasCompletedGuide"
  );

  // 引导组件渲染在 Popup 内（data-testid 供测试/E2E 定位）
  assert.ok(
    guide.includes('data-testid="popup-guide"'),
    "PopupGuide 应提供 data-testid='popup-guide'"
  );

  // 录制浮层不再触发网页内引导（避免打断录制并污染取证画面）
  assert.ok(
    !widget.includes("tryShowOnboardingGuide"),
    "recording-widget 不应再调用网页内引导"
  );
});
