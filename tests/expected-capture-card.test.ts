import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { getAutoSkipRemainingSeconds } from "../src/entrypoints/content/collector/expected-capture-card.ts";

test("速记卡倒计时向上取整并在到期后归零", () => {
  const deadline = 15_000;

  assert.equal(getAutoSkipRemainingSeconds(deadline, 0), 15);
  assert.equal(getAutoSkipRemainingSeconds(deadline, 1), 15);
  assert.equal(getAutoSkipRemainingSeconds(deadline, 1_001), 14);
  assert.equal(getAutoSkipRemainingSeconds(deadline, 15_000), 0);
  assert.equal(getAutoSkipRemainingSeconds(deadline, 16_000), 0);
});

test("速记卡倒计时文案已覆盖中英文 locale", () => {
  for (const locale of ["zh_CN", "en"] as const) {
    const messages = JSON.parse(
      readFileSync(
        resolve(process.cwd(), `src/_locales/${locale}/messages.json`),
        "utf8"
      )
    );
    assert.ok(messages.expectedAutoSkipCountdown?.message);
  }
});

test("历史搜索在查询前经由 300ms 防抖状态", () => {
  const popupApp = readFileSync(
    resolve(process.cwd(), "src/components/popup/PopupApp.tsx"),
    "utf8"
  );

  assert.match(popupApp, /const HISTORY_SEARCH_DEBOUNCE_MS = 300/);
  assert.match(popupApp, /setDebouncedSearchQuery\(searchQuery\)/);
  assert.match(popupApp, /refreshHistory\(debouncedSearchQuery\)/);
});
