import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  applyI18n,
  getLanguagePreference,
  getLocale,
  initI18nPreference,
  isEn,
  normalizeLocale,
  onLanguagePreferenceChange,
  setUserLanguagePreference,
  t,
} from "../src/shared/i18n.ts";

describe("i18n Sync and Translation", () => {
  test("normalizeLocale 标准化区域格式", () => {
    assert.equal(normalizeLocale("zh"), "zh-CN");
    assert.equal(normalizeLocale("zh-CN"), "zh-CN");
    assert.equal(normalizeLocale("zh_CN"), "zh-CN");
    assert.equal(normalizeLocale("en"), "en-US");
    assert.equal(normalizeLocale("en-US"), "en-US");
    assert.equal(normalizeLocale("en_US"), "en-US");
    assert.equal(normalizeLocale(undefined), "zh-CN");
  });

  test("setUserLanguagePreference 触发 onLanguagePreferenceChange 订阅器", async () => {
    const changes: Array<{ pref: string; locale: string }> = [];
    const unsubscribe = onLanguagePreferenceChange((pref, locale) => {
      changes.push({ pref, locale });
    });

    await setUserLanguagePreference("en-US");
    assert.equal(getLanguagePreference(), "en-US");
    assert.equal(getLocale(), "en-US");
    assert.equal(isEn(), true);

    await setUserLanguagePreference("zh-CN");
    assert.equal(getLanguagePreference(), "zh-CN");
    assert.equal(getLocale(), "zh-CN");
    assert.equal(isEn(), false);

    unsubscribe();
    await setUserLanguagePreference("auto");
    assert.equal(getLanguagePreference(), "auto");

    assert.equal(changes.length, 2);
    assert.deepEqual(changes[0], { pref: "en-US", locale: "en-US" });
    assert.deepEqual(changes[1], { pref: "zh-CN", locale: "zh-CN" });
  });

  test("initI18nPreference 在初始化完成时触发 onLanguagePreferenceChange", async () => {
    let triggered = false;
    const unsubscribe = onLanguagePreferenceChange(() => {
      triggered = true;
    });
    await initI18nPreference();
    assert.equal(triggered, true);
    unsubscribe();
  });

  test("t 函数使用 customDict 或 fallback 进行占位符插值", () => {
    const customDict = {
      greeting: { message: "Hello, $NAME$!" },
      fileCount: { message: "Found $COUNT$ files in $SECONDS$ seconds." },
      indexedParam: { message: "Param 1: $1$, Param 2: $2$" },
    };

    assert.equal(t("greeting", ["Alice"], customDict), "Hello, Alice!");
    assert.equal(
      t("fileCount", ["42", "5"], customDict),
      "Found 42 files in 5 seconds."
    );
    assert.equal(
      t("indexedParam", ["foo", "bar"], customDict),
      "Param 1: foo, Param 2: bar"
    );
  });

  test("applyI18n 同步 document.documentElement.lang 与当前 locale 一致", async () => {
    const originalDocument = (globalThis as any).document;
    const langHolder = { lang: "" };
    (globalThis as any).document = {
      documentElement: langHolder,
      querySelectorAll: () => [],
    };
    const container = {
      querySelectorAll: () => [],
    };
    try {
      await setUserLanguagePreference("en-US");
      applyI18n(container as any);
      assert.equal(langHolder.lang, "en-US");

      await setUserLanguagePreference("zh-CN");
      applyI18n(container as any);
      assert.equal(langHolder.lang, "zh-CN");
    } finally {
      await setUserLanguagePreference("auto");
      (globalThis as any).document = originalDocument;
    }
  });

  test("导出成功 Toast 提示文案包含 ZIP 下载与 Cursor/Claude 粘贴排查指引 (方案2)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const zhDict = JSON.parse(
      fs.readFileSync(
        path.resolve(process.cwd(), "src/_locales/zh_CN/messages.json"),
        "utf8"
      )
    );
    const enDict = JSON.parse(
      fs.readFileSync(
        path.resolve(process.cwd(), "src/_locales/en/messages.json"),
        "utf8"
      )
    );

    assert.ok(
      zhDict.exportSuccessCopied.message.includes("ZIP") &&
        zhDict.exportSuccessCopied.message.includes("Cursor") &&
        zhDict.exportSuccessCopied.message.includes("Claude"),
      "zh_CN exportSuccessCopied 应同时包含 ZIP 下载与 Cursor/Claude 粘贴指引"
    );
    assert.ok(
      enDict.exportSuccessCopied.message.includes("ZIP") &&
        enDict.exportSuccessCopied.message.includes("Cursor") &&
        enDict.exportSuccessCopied.message.includes("Claude"),
      "en exportSuccessCopied 应同时包含 ZIP 下载与 Cursor/Claude 粘贴指引"
    );
  });
});
