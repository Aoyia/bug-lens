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
