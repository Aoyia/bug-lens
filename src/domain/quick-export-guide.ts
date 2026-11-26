import { DIAGNOSTICS_STORAGE_KEY } from "../diagnostics/diagnostics-store";
import {
  APP_SETTINGS_STORAGE_KEY,
  loadAppSettings,
  saveAppSettings,
} from "../shared/settings";

export const QUICK_EXPORT_GUIDE_STORAGE_KEY = "quick-export-guide-state";
export const STOP_ACTION_MIGRATED_STORAGE_KEY = "stop-action-migrated-v1";

export const LEGACY_STOP_ACTION_MIGRATION_THRESHOLD = 5;
export const STRONG_SIGNAL_MIN_EXPORTS = 3;
export const STRONG_SIGNAL_MIN_UNEDITED = 2;
export const FALLBACK_SIGNAL_MIN_EXPORTS = 5;
export const COOLDOWN_EXPORTS_AFTER_DISMISS = 10;
export const COOLDOWN_MIN_UNEDITED = 3;
export const MAX_DISMISS_BEFORE_PERMANENT_MUTE = 2;
export const STAGE2_ONBOARDING_TOAST_LIMIT = 2;

export interface QuickExportGuideState {
  stage1ExportCount: number;
  consecutiveUneditedCount: number;
  lastStopExportSessionId?: string;
  lastStopExportEdited?: boolean;
  status: "idle" | "accepted" | "dismissed";
  dismissCount: number;
  dismissedAtExportCount?: number;
  stage2OnboardingToastCount: number;
}

export const DEFAULT_QUICK_EXPORT_GUIDE_STATE: QuickExportGuideState =
  Object.freeze({
    stage1ExportCount: 0,
    consecutiveUneditedCount: 0,
    status: "idle",
    dismissCount: 0,
    stage2OnboardingToastCount: 0,
  });

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

function toNonNegativeInt(val: unknown, fallback = 0): number {
  if (typeof val !== "number" || !Number.isFinite(val)) return fallback;
  return Math.max(0, Math.floor(val));
}

export function normalizeQuickExportGuideState(
  raw: unknown
): QuickExportGuideState {
  if (!isRecord(raw)) {
    return { ...DEFAULT_QUICK_EXPORT_GUIDE_STATE };
  }
  const status =
    raw.status === "accepted" || raw.status === "dismissed"
      ? raw.status
      : "idle";
  const lastStopExportSessionId =
    typeof raw.lastStopExportSessionId === "string" &&
    raw.lastStopExportSessionId.trim().length > 0
      ? raw.lastStopExportSessionId
      : undefined;
  const lastStopExportEdited =
    typeof raw.lastStopExportEdited === "boolean"
      ? raw.lastStopExportEdited
      : undefined;
  const dismissedAtExportCount =
    typeof raw.dismissedAtExportCount === "number" &&
    Number.isFinite(raw.dismissedAtExportCount)
      ? Math.max(0, Math.floor(raw.dismissedAtExportCount))
      : undefined;

  return {
    stage1ExportCount: toNonNegativeInt(raw.stage1ExportCount),
    consecutiveUneditedCount: toNonNegativeInt(raw.consecutiveUneditedCount),
    lastStopExportSessionId,
    lastStopExportEdited,
    status,
    dismissCount: toNonNegativeInt(raw.dismissCount),
    dismissedAtExportCount,
    stage2OnboardingToastCount: toNonNegativeInt(
      raw.stage2OnboardingToastCount
    ),
  };
}

/**
 * 第一阶段预览页通过 stop-export 打开时推进引导状态：
 * - 同一 sessionId 幂等（刷新预览页不重复计数）
 * - 打开新会话时结算上一条会话是否“零编辑”
 */
export function recordStage1PreviewOpened(
  state: QuickExportGuideState,
  sessionId: string
): QuickExportGuideState {
  if (!sessionId || state.lastStopExportSessionId === sessionId) {
    return state;
  }
  const settledUnedited = state.lastStopExportSessionId
    ? state.lastStopExportEdited
      ? 0
      : state.consecutiveUneditedCount + 1
    : state.consecutiveUneditedCount;

  return {
    ...state,
    stage1ExportCount: state.stage1ExportCount + 1,
    consecutiveUneditedCount: settledUnedited,
    lastStopExportSessionId: sessionId,
    lastStopExportEdited: false,
  };
}

/**
 * 标记当前从 stop-export 打开的会话在预览页发生了编辑操作。
 */
export function recordPreviewEdited(
  state: QuickExportGuideState,
  sessionId: string
): QuickExportGuideState {
  if (!sessionId || state.lastStopExportSessionId !== sessionId) {
    return state;
  }
  if (state.lastStopExportEdited) return state;
  return {
    ...state,
    lastStopExportEdited: true,
  };
}

export function recordUpgradeAccepted(
  state: QuickExportGuideState
): QuickExportGuideState {
  return {
    ...state,
    status: "accepted",
  };
}

export function recordUpgradeDismissed(
  state: QuickExportGuideState
): QuickExportGuideState {
  return {
    ...state,
    status: "dismissed",
    dismissCount: state.dismissCount + 1,
    dismissedAtExportCount: state.stage1ExportCount,
  };
}

export function recordManualStopActionChange(
  state: QuickExportGuideState,
  prevAction: "preview" | "silentExport",
  nextAction: "preview" | "silentExport"
): QuickExportGuideState {
  if (nextAction === "silentExport") {
    return {
      ...state,
      status: "accepted",
    };
  }
  if (prevAction === "silentExport" && nextAction === "preview") {
    return {
      ...state,
      status: "dismissed",
      dismissCount: Math.max(
        state.dismissCount,
        MAX_DISMISS_BEFORE_PERMANENT_MUTE
      ),
      dismissedAtExportCount: state.stage1ExportCount,
    };
  }
  return state;
}

export function consumeStage2OnboardingToastInState(
  state: QuickExportGuideState
): { nextState: QuickExportGuideState; shouldShowHint: boolean } {
  if (state.stage2OnboardingToastCount < STAGE2_ONBOARDING_TOAST_LIMIT) {
    return {
      nextState: {
        ...state,
        stage2OnboardingToastCount: state.stage2OnboardingToastCount + 1,
      },
      shouldShowHint: true,
    };
  }
  return {
    nextState: state,
    shouldShowHint: false,
  };
}

export function resolveUpgradeBannerReason(
  state: QuickExportGuideState,
  opts: {
    stopAction: "preview" | "silentExport";
    fromStopExport: boolean;
    currentSessionEdited: boolean;
  }
): "strong" | "fallback" | null {
  if (
    opts.stopAction !== "preview" ||
    !opts.fromStopExport ||
    opts.currentSessionEdited ||
    state.status === "accepted"
  ) {
    return null;
  }
  if (state.status === "idle") {
    if (
      state.stage1ExportCount >= STRONG_SIGNAL_MIN_EXPORTS &&
      state.consecutiveUneditedCount >= STRONG_SIGNAL_MIN_UNEDITED
    ) {
      return "strong";
    }
    if (state.stage1ExportCount >= FALLBACK_SIGNAL_MIN_EXPORTS) {
      return "fallback";
    }
    return null;
  }
  if (
    state.status === "dismissed" &&
    state.dismissCount === 1 &&
    state.stage1ExportCount - (state.dismissedAtExportCount ?? 0) >=
      COOLDOWN_EXPORTS_AFTER_DISMISS &&
    state.consecutiveUneditedCount >= COOLDOWN_MIN_UNEDITED
  ) {
    return "strong";
  }
  return null;
}

export function shouldMigrateLegacyStopAction(input: {
  alreadyMigrated: boolean;
  currentStopAction: "preview" | "silentExport";
  totalPromptCopies: number;
  historicalSessionCount: number;
}): boolean {
  if (input.alreadyMigrated || input.currentStopAction === "silentExport") {
    return false;
  }
  return (
    input.totalPromptCopies >= LEGACY_STOP_ACTION_MIGRATION_THRESHOLD ||
    input.historicalSessionCount >= LEGACY_STOP_ACTION_MIGRATION_THRESHOLD
  );
}

export async function loadQuickExportGuideState(): Promise<QuickExportGuideState> {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local?.get) {
      const res = await chrome.storage.local.get([
        QUICK_EXPORT_GUIDE_STORAGE_KEY,
      ]);
      return normalizeQuickExportGuideState(
        res?.[QUICK_EXPORT_GUIDE_STORAGE_KEY]
      );
    }
  } catch {
    // 忽略读取异常，降级为默认状态
  }
  return { ...DEFAULT_QUICK_EXPORT_GUIDE_STATE };
}

export async function saveQuickExportGuideState(
  state: QuickExportGuideState
): Promise<QuickExportGuideState> {
  const normalized = normalizeQuickExportGuideState(state);
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local?.set) {
      await chrome.storage.local.set({
        [QUICK_EXPORT_GUIDE_STORAGE_KEY]: normalized,
      });
    }
  } catch {
    // 忽略写入异常
  }
  return normalized;
}

export async function updateQuickExportGuideState(
  updater: (prev: QuickExportGuideState) => QuickExportGuideState
): Promise<QuickExportGuideState> {
  const prev = await loadQuickExportGuideState();
  const next = updater(prev);
  return saveQuickExportGuideState(next);
}

export async function consumeStage2OnboardingToast(): Promise<boolean> {
  const prev = await loadQuickExportGuideState();
  const { nextState, shouldShowHint } =
    consumeStage2OnboardingToastInState(prev);
  if (shouldShowHint) {
    await saveQuickExportGuideState(nextState);
  }
  return shouldShowHint;
}

async function markStopActionMigrated(): Promise<void> {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local?.set) {
      await chrome.storage.local.set({
        [STOP_ACTION_MIGRATED_STORAGE_KEY]: true,
      });
    }
  } catch {
    // 忽略写入异常
  }
}

/**
 * 一次性老用户兼容迁移：
 * 若尚未迁移且历史提示词复制次数或历史会话数 >= 5，默认保留第二阶段直接导出，
 * 避免升级后把已习惯静默导出的高频用户拉回自动打开预览页。
 */
export async function migrateLegacyStopActionIfNeeded(
  getHistoricalSessionCount: () => Promise<number>
): Promise<boolean> {
  if (typeof chrome === "undefined" || !chrome.storage?.local?.get) {
    return false;
  }
  let res: Record<string, unknown>;
  try {
    res = await chrome.storage.local.get([
      STOP_ACTION_MIGRATED_STORAGE_KEY,
      APP_SETTINGS_STORAGE_KEY,
      DIAGNOSTICS_STORAGE_KEY,
    ]);
  } catch {
    return false;
  }

  if (res?.[STOP_ACTION_MIGRATED_STORAGE_KEY]) {
    return false;
  }

  let settings;
  try {
    settings = await loadAppSettings();
  } catch {
    return false;
  }
  if (settings.workflow.stopAction === "silentExport") {
    await updateQuickExportGuideState(recordUpgradeAccepted);
    await markStopActionMigrated();
    return false;
  }

  const diagnosticsRaw = res?.[DIAGNOSTICS_STORAGE_KEY] as
    { metrics?: { totalPromptCopies?: unknown } } | undefined;
  const totalPromptCopies = toNonNegativeInt(
    diagnosticsRaw?.metrics?.totalPromptCopies
  );

  let historicalSessionCount = 0;
  if (totalPromptCopies < LEGACY_STOP_ACTION_MIGRATION_THRESHOLD) {
    try {
      historicalSessionCount = await getHistoricalSessionCount();
    } catch {
      return false;
    }
  }

  const shouldMigrate = shouldMigrateLegacyStopAction({
    alreadyMigrated: false,
    currentStopAction: settings.workflow.stopAction,
    totalPromptCopies,
    historicalSessionCount,
  });

  if (shouldMigrate) {
    await saveAppSettings((prev) => ({
      ...prev,
      workflow: {
        ...prev.workflow,
        stopAction: "silentExport",
      },
    }));
    await updateQuickExportGuideState(recordUpgradeAccepted);
    await markStopActionMigrated();
    return true;
  }

  await markStopActionMigrated();
  return false;
}
