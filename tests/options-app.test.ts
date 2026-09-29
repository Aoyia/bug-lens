import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { h } from "preact";
import render from "preact-render-to-string";
import { OptionsApp } from "../src/components/options/OptionsApp.tsx";

describe("OptionsApp 全量 i18n 词条静态防退化测试", () => {
  const optionsAppPath = resolve(
    process.cwd(),
    "src/components/options/OptionsApp.tsx"
  );
  const optionsAppCode = readFileSync(optionsAppPath, "utf8");

  function loadLocaleDict(localeName: "zh-CN" | "en-US") {
    // 优先匹配标准路径规范，兼顾 Chrome Extension 标准目录与配置别名
    const candidates =
      localeName === "zh-CN"
        ? [
            resolve(process.cwd(), "src/locales/zh-CN.json"),
            resolve(process.cwd(), "src/_locales/zh_CN/messages.json"),
          ]
        : [
            resolve(process.cwd(), "src/locales/en-US.json"),
            resolve(process.cwd(), "src/_locales/en/messages.json"),
          ];

    const foundPath = candidates.find((p) => existsSync(p));
    assert.ok(
      foundPath,
      `必须存在 ${localeName} 语言包定义文件 (候选路径: ${candidates.join(", ")})`
    );
    const content = readFileSync(foundPath, "utf8");
    return JSON.parse(content) as Record<string, { message: string }>;
  }

  const zhDict = loadLocaleDict("zh-CN");
  const enDict = loadLocaleDict("en-US");

  test("扫描并提取 OptionsApp 中所有 t() 调用的 i18n 键名", () => {
    // 提取所有 t("key"), t('key'), t(`key`), 包括带有类型断言如 t(`key` as any)
    const tRegex = /\bt\(\s*([`"'])(.*?)\1(?:\s+as\s+[^)]+)?\s*(?:,|\))/g;
    const rawKeys: string[] = [];
    let match: RegExpExecArray | null;

    while ((match = tRegex.exec(optionsAppCode)) !== null) {
      const candidate = match[2]?.trim();
      // 过滤非字面量的参数调用（如果有）
      if (candidate && !candidate.startsWith("/*")) {
        rawKeys.push(candidate);
      }
    }

    const uniqueKeys = new Set<string>();
    for (const rawKey of rawKeys) {
      // 处理动态拼接模式，例如：t(`retentionDays${days}` as any)
      if (rawKey.includes("${days}")) {
        for (const days of [7, 14, 30, 90]) {
          uniqueKeys.add(`retentionDays${days}`);
        }
      } else {
        uniqueKeys.add(rawKey);
      }
    }

    const allKeys = Array.from(uniqueKeys);
    assert.ok(
      allKeys.length >= 70,
      `从 OptionsApp.tsx 扫描出的 i18n key 总数应不少于 70 项，实际提取到 ${allKeys.length} 项`
    );
    // 明确断言动态拼接的 retentionDays 词条均被提取到位
    assert.ok(
      uniqueKeys.has("retentionDays7"),
      "必须包含动态生成的 retentionDays7"
    );
    assert.ok(
      uniqueKeys.has("retentionDays14"),
      "必须包含动态生成的 retentionDays14"
    );
    assert.ok(
      uniqueKeys.has("retentionDays30"),
      "必须包含动态生成的 retentionDays30"
    );
    assert.ok(
      uniqueKeys.has("retentionDays90"),
      "必须包含动态生成的 retentionDays90"
    );

    // 逐项断言全部 key 在 zhDict 和 enDict 中 100% 存在且非空
    for (const key of allKeys) {
      assert.ok(
        key in zhDict,
        `[i18n 缺失] Key "${key}" 在中文语言包 (zh-CN) 中不存在，会导致页面裸露原始 Key`
      );
      assert.ok(
        typeof zhDict[key]?.message === "string" &&
          zhDict[key].message.trim().length > 0,
        `[i18n 空文案] Key "${key}" 在中文语言包中的 message 不能为空`
      );

      assert.ok(
        key in enDict,
        `[i18n 缺失] Key "${key}" 在英文语言包 (en-US) 中不存在，会导致页面裸露原始 Key`
      );
      assert.ok(
        typeof enDict[key]?.message === "string" &&
          enDict[key].message.trim().length > 0,
        `[i18n 空文案] Key "${key}" 在英文语言包中的 message 不能为空`
      );

      // 验证英文翻译中未夹带未翻译的中文字符（语言选项本身如 "简体中文" 除外）
      if (key !== "languageZhCN") {
        assert.ok(
          !/[\u4e00-\u9fff]/.test(enDict[key].message),
          `[i18n 汉字残留] Key "${key}" 在英文语言包中混入了中文字符: "${enDict[key].message}"`
        );
      }
    }
  });
});

describe("OptionsApp 导航结构与核心容器静态防退化测试", () => {
  const optionsAppPath = resolve(
    process.cwd(),
    "src/components/options/OptionsApp.tsx"
  );
  const optionsAppCode = readFileSync(optionsAppPath, "utf8");

  test("断言 6 个主导航 Tab 标识与导航按钮完整存续", () => {
    const requiredTabs = [
      { id: "workflow", i18nKey: "navWorkflow" },
      { id: "ai", i18nKey: "navAi" },
      { id: "recording", i18nKey: "navRecording" },
      { id: "privacy", i18nKey: "navPrivacy" },
      { id: "storage", i18nKey: "navStorage" },
      { id: "shortcuts", i18nKey: "navShortcuts" },
    ];

    // 断言 NavTab 类型联合中包含全部 6 项
    for (const tab of requiredTabs) {
      assert.ok(
        optionsAppCode.includes(`"${tab.id}"`),
        `OptionsApp.tsx 中缺少导航标识 "${tab.id}"`
      );
      assert.ok(
        optionsAppCode.includes(`activeTab === "${tab.id}"`),
        `OptionsApp.tsx 缺少针对 Tab "${tab.id}" 的激活渲染分支`
      );
      assert.ok(
        optionsAppCode.includes(`t("${tab.i18nKey}")`),
        `OptionsApp.tsx 导航栏缺少 i18n 键名 t("${tab.i18nKey}")`
      );
    }
  });

  test("断言胶囊分段选择器与自定义下拉菜单的关键 CSS 类名与无障碍属性", () => {
    // 胶囊分段控件 CSS 类与 ARIA 规范
    const segmentedPatterns = [
      'className="segmented-control"',
      'role="radiogroup"',
      "className={`segmented-btn",
      'role="radio"',
      "aria-checked=",
      "data-text=",
    ];

    for (const pattern of segmentedPatterns) {
      assert.ok(
        optionsAppCode.includes(pattern),
        `SegmentedControl 缺少关键样式或可访问性属性: ${pattern}`
      );
    }

    // 自绘 CustomSelect 下拉菜单类名与 ARIA 规范
    const customSelectPatterns = [
      "custom-select-wrap",
      "custom-select-trigger",
      "custom-select-dropdown",
      "custom-select-option",
      'role="listbox"',
      'role="option"',
      "aria-expanded=",
      "aria-selected=",
    ];

    for (const pattern of customSelectPatterns) {
      assert.ok(
        optionsAppCode.includes(pattern),
        `CustomSelect 缺少关键样式或可访问性属性: ${pattern}`
      );
    }
  });

  test("断言设置页主体布局与设置卡片容器完整性", () => {
    const layoutContainers = [
      "options-layout",
      "options-topbar",
      "topbar-left",
      "topbar-center",
      "topbar-right",
      "topbar-search-box",
      "topbar-search-input",
      "auto-save-pill",
      "save-status-badge",
      "options-body-scroll",
      "options-center-container",
      "options-sidebar",
      "sidebar-nav",
      "nav-item",
      "options-main-container",
      "section-header-row",
      "section-title",
      "section-subtitle",
      "settings-card",
      "setting-row",
      "setting-info",
      "setting-label",
      "setting-desc",
      "setting-control",
      "switch",
      "slider",
    ];

    for (const cls of layoutContainers) {
      assert.ok(
        optionsAppCode.includes(cls),
        `OptionsApp 缺少布局容器或控件关键类名: "${cls}"`
      );
    }
  });

  test("OptionsApp 组件初始 SSR 渲染冒烟防护", () => {
    const output = render(h(OptionsApp, {}));
    assert.ok(
      typeof output === "string" && output.length > 0,
      "OptionsApp SSR 渲染输出不得为空"
    );
    assert.ok(
      output.includes("loading") || output.includes("options-layout"),
      "OptionsApp 初始渲染输出应当包含预期的加载态或布局容器"
    );
  });
});
