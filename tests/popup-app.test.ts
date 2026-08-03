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
