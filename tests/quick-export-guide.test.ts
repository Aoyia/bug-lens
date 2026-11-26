import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  DEFAULT_QUICK_EXPORT_GUIDE_STATE,
  QUICK_EXPORT_GUIDE_STORAGE_KEY,
  STOP_ACTION_MIGRATED_STORAGE_KEY,
  consumeStage2OnboardingToastInState,
  migrateLegacyStopActionIfNeeded,
  recordManualStopActionChange,
  recordPreviewEdited,
  recordStage1PreviewOpened,
  recordUpgradeAccepted,
  recordUpgradeDismissed,
  resolveUpgradeBannerReason,
  shouldMigrateLegacyStopAction,
} from "../src/domain/quick-export-guide.ts";
import {
  APP_SETTINGS_STORAGE_KEY,
  DEFAULT_APP_SETTINGS,
  loadAppSettings,
  saveAppSettings,
} from "../src/shared/settings.ts";
import { DIAGNOSTICS_STORAGE_KEY } from "../src/diagnostics/diagnostics-store.ts";

function installMemoryStorage(initial: Record<string, unknown> = {}) {
  const store: Record<string, unknown> = { ...initial };
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const key of list) {
            if (key in store) out[key] = store[key];
          }
          return out;
        },
        set: async (patch: Record<string, unknown>) => {
          Object.assign(store, patch);
        },
      },
    },
  };
  return store;
}

test("行为信号状态机：第 1、2 次不弹窗，第 3 次连续 2 次无编辑触发 strong 推荐", () => {
  let state = { ...DEFAULT_QUICK_EXPORT_GUIDE_STATE };

  // 第 1 次
  state = recordStage1PreviewOpened(state, "sess-1");
  assert.equal(state.stage1ExportCount, 1);
  assert.equal(state.consecutiveUneditedCount, 0);
  assert.equal(
    resolveUpgradeBannerReason(state, {
      stopAction: "preview",
      fromStopExport: true,
      currentSessionEdited: false,
    }),
    null
  );

  // 同 sessionId 刷新幂等，不重复计数
  const reloaded = recordStage1PreviewOpened(state, "sess-1");
  assert.deepEqual(reloaded, state);

  // 第 2 次（结算 sess-1 无编辑 -> consecutiveUneditedCount = 1）
  state = recordStage1PreviewOpened(state, "sess-2");
  assert.equal(state.stage1ExportCount, 2);
  assert.equal(state.consecutiveUneditedCount, 1);
  assert.equal(
    resolveUpgradeBannerReason(state, {
      stopAction: "preview",
      fromStopExport: true,
      currentSessionEdited: false,
    }),
    null
  );

  // 第 3 次（结算 sess-2 无编辑 -> consecutiveUneditedCount = 2 -> strong）
  state = recordStage1PreviewOpened(state, "sess-3");
  assert.equal(state.stage1ExportCount, 3);
  assert.equal(state.consecutiveUneditedCount, 2);
  assert.equal(
    resolveUpgradeBannerReason(state, {
      stopAction: "preview",
      fromStopExport: true,
      currentSessionEdited: false,
    }),
    "strong"
  );

  // 非 fromStopExport 打开或当前会话已编辑则不展示
  assert.equal(
    resolveUpgradeBannerReason(state, {
      stopAction: "preview",
      fromStopExport: false,
      currentSessionEdited: false,
    }),
    null
  );
  assert.equal(
    resolveUpgradeBannerReason(state, {
      stopAction: "preview",
      fromStopExport: true,
      currentSessionEdited: true,
    }),
    null
  );
});

test("行为信号状态机：中途编辑重置连续计数，第 5 次走 fallback 兜底推荐", () => {
  let state = { ...DEFAULT_QUICK_EXPORT_GUIDE_STATE };
  state = recordStage1PreviewOpened(state, "sess-1");
  state = recordStage1PreviewOpened(state, "sess-2");
  // 第 2 次发生了编辑
  state = recordPreviewEdited(state, "sess-2");

  // 第 3 次结算 sess-2：连续无编辑归零
  state = recordStage1PreviewOpened(state, "sess-3");
  assert.equal(state.stage1ExportCount, 3);
  assert.equal(state.consecutiveUneditedCount, 0);
  assert.equal(
    resolveUpgradeBannerReason(state, {
      stopAction: "preview",
      fromStopExport: true,
      currentSessionEdited: false,
    }),
    null
  );

  // 第 4 次也编辑
  state = recordStage1PreviewOpened(state, "sess-4");
  state = recordPreviewEdited(state, "sess-4");
  assert.equal(
    resolveUpgradeBannerReason(state, {
      stopAction: "preview",
      fromStopExport: true,
      currentSessionEdited: false,
    }),
    null
  );

  // 第 5 次：虽然连续无编辑仍为 0，但累计导出已达 5 次 -> fallback
  state = recordStage1PreviewOpened(state, "sess-5");
  assert.equal(state.stage1ExportCount, 5);
  assert.equal(state.consecutiveUneditedCount, 0);
  assert.equal(
    resolveUpgradeBannerReason(state, {
      stopAction: "preview",
      fromStopExport: true,
      currentSessionEdited: false,
    }),
    "fallback"
  );
});

test("拒绝冷却与永久静默：拒绝 1 次后冷却 10 次且需连续 3 次无编辑，第 2 次拒绝永久静默", () => {
  let state = { ...DEFAULT_QUICK_EXPORT_GUIDE_STATE };
  state = recordStage1PreviewOpened(state, "s1");
  state = recordStage1PreviewOpened(state, "s2");
  state = recordStage1PreviewOpened(state, "s3");

  // 第 1 次拒绝（at stage1ExportCount = 3）
  state = recordUpgradeDismissed(state);
  assert.equal(state.status, "dismissed");
  assert.equal(state.dismissCount, 1);
  assert.equal(state.dismissedAtExportCount, 3);

  // 随后 9 次无编辑导出仍在冷却期内（3 + 1..9 = 4..12）
  for (let i = 4; i <= 12; i++) {
    state = recordStage1PreviewOpened(state, `s${i}`);
    assert.equal(
      resolveUpgradeBannerReason(state, {
        stopAction: "preview",
        fromStopExport: true,
        currentSessionEdited: false,
      }),
      null
    );
  }

  // 第 13 次（差值 = 10，且连续无编辑 >= 3）再次弹出 strong
  state = recordStage1PreviewOpened(state, "s13");
  assert.equal(
    resolveUpgradeBannerReason(state, {
      stopAction: "preview",
      fromStopExport: true,
      currentSessionEdited: false,
    }),
    "strong"
  );

  // 第 2 次拒绝后永久静默
  state = recordUpgradeDismissed(state);
  assert.equal(state.dismissCount, 2);
  for (let i = 14; i <= 30; i++) {
    state = recordStage1PreviewOpened(state, `s${i}`);
    assert.equal(
      resolveUpgradeBannerReason(state, {
        stopAction: "preview",
        fromStopExport: true,
        currentSessionEdited: false,
      }),
      null
    );
  }
});

test("接受升级与设置页手动切换同步状态", () => {
  let state = { ...DEFAULT_QUICK_EXPORT_GUIDE_STATE };
  state = recordStage1PreviewOpened(state, "s1");
  state = recordStage1PreviewOpened(state, "s2");
  state = recordStage1PreviewOpened(state, "s3");

  // 接受升级 -> accepted
  state = recordUpgradeAccepted(state);
  assert.equal(
    resolveUpgradeBannerReason(state, {
      stopAction: "silentExport",
      fromStopExport: true,
      currentSessionEdited: false,
    }),
    null
  );

  // 手动切回 preview -> 永久静默不再推荐
  state = recordManualStopActionChange(state, "silentExport", "preview");
  assert.equal(state.status, "dismissed");
  assert.ok(state.dismissCount >= 2);
  state = recordStage1PreviewOpened(state, "s4");
  assert.equal(
    resolveUpgradeBannerReason(state, {
      stopAction: "preview",
      fromStopExport: true,
      currentSessionEdited: false,
    }),
    null
  );

  // 手动切换到 silentExport -> accepted
  state = recordManualStopActionChange(state, "preview", "silentExport");
  assert.equal(state.status, "accepted");
});

test("第二阶段 Toast 安全网副提示仅前 2 次展示", () => {
  let state = { ...DEFAULT_QUICK_EXPORT_GUIDE_STATE };

  const first = consumeStage2OnboardingToastInState(state);
  assert.equal(first.shouldShowHint, true);
  state = first.nextState;

  const second = consumeStage2OnboardingToastInState(state);
  assert.equal(second.shouldShowHint, true);
  state = second.nextState;

  const third = consumeStage2OnboardingToastInState(state);
  assert.equal(third.shouldShowHint, false);
  assert.equal(third.nextState.stage2OnboardingToastCount, 2);
});

test("老用户迁移纯判定与存储迁移：阈值为 5 次，迁移后幂等不再重复执行", async () => {
  assert.equal(
    shouldMigrateLegacyStopAction({
      alreadyMigrated: false,
      currentStopAction: "preview",
      totalPromptCopies: 4,
      historicalSessionCount: 4,
    }),
    false
  );
  assert.equal(
    shouldMigrateLegacyStopAction({
      alreadyMigrated: false,
      currentStopAction: "preview",
      totalPromptCopies: 5,
      historicalSessionCount: 0,
    }),
    true
  );
  assert.equal(
    shouldMigrateLegacyStopAction({
      alreadyMigrated: false,
      currentStopAction: "preview",
      totalPromptCopies: 0,
      historicalSessionCount: 5,
    }),
    true
  );

  // 场景 A：新/低频用户（< 5 次）保持 preview，同时落盘已迁移标记
  const storeA = installMemoryStorage({
    [DIAGNOSTICS_STORAGE_KEY]: { metrics: { totalPromptCopies: 4 } },
  });
  const migratedA = await migrateLegacyStopActionIfNeeded(async () => 4);
  assert.equal(migratedA, false);
  assert.equal(storeA[STOP_ACTION_MIGRATED_STORAGE_KEY], true);
  assert.equal(storeA[APP_SETTINGS_STORAGE_KEY], undefined);

  // 场景 B：老用户（totalPromptCopies >= 5）自动迁移为 silentExport 并标为 accepted
  const storeB = installMemoryStorage({
    [DIAGNOSTICS_STORAGE_KEY]: { metrics: { totalPromptCopies: 5 } },
  });
  const migratedB = await migrateLegacyStopActionIfNeeded(async () => 0);
  assert.equal(migratedB, true);
  assert.equal(storeB[STOP_ACTION_MIGRATED_STORAGE_KEY], true);
  assert.equal(
    (storeB[APP_SETTINGS_STORAGE_KEY] as { workflow?: { stopAction?: string } })
      ?.workflow?.stopAction,
    "silentExport"
  );
  assert.equal(
    (storeB[QUICK_EXPORT_GUIDE_STORAGE_KEY] as { status?: string })?.status,
    "accepted"
  );

  // 二次调用因已标记 STOP_ACTION_MIGRATED_STORAGE_KEY，直接幂等返回 false
  const migratedBAgain = await migrateLegacyStopActionIfNeeded(async () => 99);
  assert.equal(migratedBAgain, false);

  // 场景 C：历史会话 >= 5 的老用户（即使复制次数为 0）同样自动迁移
  const storeC = installMemoryStorage({
    [DIAGNOSTICS_STORAGE_KEY]: { metrics: { totalPromptCopies: 0 } },
  });
  const migratedC = await migrateLegacyStopActionIfNeeded(async () => 5);
  assert.equal(migratedC, true);
  assert.equal(
    (storeC[APP_SETTINGS_STORAGE_KEY] as { workflow?: { stopAction?: string } })
      ?.workflow?.stopAction,
    "silentExport"
  );
});

test("渐进式快捷导出新增 i18n 词条在双语字典齐全且英文无中文残留", () => {
  const zhDict = JSON.parse(
    readFileSync(
      resolve(process.cwd(), "src/_locales/zh_CN/messages.json"),
      "utf8"
    )
  ) as Record<string, { message: string }>;
  const enDict = JSON.parse(
    readFileSync(
      resolve(process.cwd(), "src/_locales/en/messages.json"),
      "utf8"
    )
  ) as Record<string, { message: string }>;

  const keys = [
    "stopActionPreview",
    "stopActionSilentExport",
    "quickExportBannerBadge",
    "quickExportBannerStrong",
    "quickExportBannerFallback",
    "quickExportEnableBtn",
    "quickExportKeepPreviewBtn",
    "quickExportEnabledToast",
    "stage2SilentExportToastHint",
  ];

  for (const key of keys) {
    assert.ok(key in zhDict, `zh_CN 缺少 ${key}`);
    assert.ok(key in enDict, `en 缺少 ${key}`);
    assert.ok(zhDict[key].message.trim().length > 0, `zh_CN ${key} 为空`);
    assert.ok(enDict[key].message.trim().length > 0, `en ${key} 为空`);
    assert.ok(
      !/[\u4e00-\u9fff]/.test(enDict[key].message),
      `en ${key} 不得包含中文字符`
    );
  }
});

test("saveAppSettings 支持从 silentExport 及非默认枚举值切回默认值（P0 回归）", async () => {
  installMemoryStorage();
  await saveAppSettings({
    ...DEFAULT_APP_SETTINGS,
    workflow: { ...DEFAULT_APP_SETTINGS.workflow, stopAction: "silentExport" },
    defaultRecording: {
      ...DEFAULT_APP_SETTINGS.defaultRecording,
      privacyMode: "strict",
    },
    ai: { ...DEFAULT_APP_SETTINGS.ai, targetAssistant: "cursor" },
    storage: { ...DEFAULT_APP_SETTINGS.storage, compressionLevel: "small" },
  });

  let loaded = await loadAppSettings();
  assert.equal(loaded.workflow.stopAction, "silentExport");
  assert.equal(loaded.defaultRecording.privacyMode, "strict");
  assert.equal(loaded.ai.targetAssistant, "cursor");
  assert.equal(loaded.storage.compressionLevel, "small");

  await saveAppSettings({
    ...loaded,
    workflow: { ...loaded.workflow, stopAction: "preview" },
    defaultRecording: { ...loaded.defaultRecording, privacyMode: "safe" },
    ai: { ...loaded.ai, targetAssistant: "generic" },
    storage: { ...loaded.storage, compressionLevel: "balanced" },
  });

  loaded = await loadAppSettings();
  assert.equal(loaded.workflow.stopAction, "preview");
  assert.equal(loaded.defaultRecording.privacyMode, "safe");
  assert.equal(loaded.ai.targetAssistant, "generic");
  assert.equal(loaded.storage.compressionLevel, "balanced");
});

test("migrateLegacyStopActionIfNeeded 读取 storage 或会话数异常时不写死迁移标记", async () => {
  const written: Record<string, unknown> = {};
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: async () => {
          throw new Error("Transient storage read error");
        },
        set: async (patch: Record<string, unknown>) => {
          Object.assign(written, patch);
        },
      },
    },
  };
  const res1 = await migrateLegacyStopActionIfNeeded(async () => 10);
  assert.equal(res1, false);
  assert.equal(written[STOP_ACTION_MIGRATED_STORAGE_KEY], undefined);

  const store2 = installMemoryStorage();
  const res2 = await migrateLegacyStopActionIfNeeded(async () => {
    throw new Error("IDB unavailable");
  });
  assert.equal(res2, false);
  assert.equal(store2[STOP_ACTION_MIGRATED_STORAGE_KEY], undefined);
});
