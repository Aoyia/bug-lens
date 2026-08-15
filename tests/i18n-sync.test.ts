import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
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
});
