import fs from "node:fs";
import path from "node:path";
import type { FullConfig } from "@playwright/test";
import {
  checkMacOSAccessibilityPermission,
  formatMacOSInputPermissionError,
  isAccessibilityPreflightSkipped,
  isExtensionPagePopupDriver,
  isNativeShortcutRunForced,
} from "./fixtures/native-shortcut.ts";

/**
 * 真正依赖系统级按键/系统对话框（System Events）的 fixture 标识。
 * 注意 openActionPopup 已不再属于此列：extension-page 驱动下它通过
 * chrome.action.openPopup() 打开真实 Action Popup，不需要辅助功能权限。
 */
const NATIVE_SHORTCUT_FIXTURE_MARKERS = [
  "nativeShortcutDriver",
  "nativeSaveDialogDriver",
];

/** 扫描 e2e 目录，列出仍依赖系统级按键模拟的 spec，供跳过告警精确指名。 */
function listNativeShortcutDependentSpecs(): string[] {
  const e2eDir = import.meta.dirname;
  return fs
    .readdirSync(e2eDir)
    .filter((name) => name.endsWith(".spec.ts"))
    .filter((name) => {
      const source = fs.readFileSync(path.join(e2eDir, name), "utf8");
      return NATIVE_SHORTCUT_FIXTURE_MARKERS.some((marker) =>
        source.includes(marker)
      );
    })
    .sort();
}

function formatSkipBanner(specs: string[]): string {
  return [
    "================================================================================",
    "⚠️  BUG_LENS_SKIP_ACCESSIBILITY_PREFLIGHT 已启用：本次运行跳过 macOS 辅助功能预检。",
    "⚠️  Chrome/Playwright 本身正常运行不需要该权限；被保护的是“系统级键盘模拟”，",
    "⚠️  即通过 System Events 发送 ⌘⇧ 等原生快捷键来唤起真实 Action Popup。",
    "⚠️  以下 spec 依赖该能力，本次运行中它们会被 test.skip 精确跳过（不会计为通过）：",
    ...(specs.length > 0
      ? specs.map((spec) => `       - e2e/${spec}`)
      : ["       - (未扫描到依赖原生快捷键的 spec)"]),
    "⚠️  被跳过用例从未真正执行，其结果不可信；其余不依赖原生快捷键的用例照常运行。",
    "⚠️  如需强制运行以观察真实失败，设置 BUG_LENS_FORCE_RUN_SHORTCUT_TESTS=1（预期会失败）。",
    "================================================================================",
  ].join("\n");
}

function formatExtensionPageBanner(specs: string[]): string {
  return [
    "================================================================================",
    "ℹ️  BUG_LENS_POPUP_DRIVER=extension-page（显式 opt-in）：Action Popup 由 chrome.action.openPopup() 打开。",
    "ℹ️  该路径不发送任何系统级按键，因此本次运行不做 macOS 辅助功能预检。",
    "⚠️  但 Chrome 的 activeTab 安全模型会拒绝 tabCapture，凡依赖 waitForActive 的录制/导出用例都会失败。",
    "⚠️  extension-page 只是「无辅助功能权限环境下的降级冒烟」，不能替代 native 驱动的完整验收。",
    ...(specs.length > 0
      ? [
          "ℹ️  以下 spec 仍依赖 System Events 系统级按键/系统对话框，本次会自行 skip：",
          ...specs.map((spec) => `       - e2e/${spec}`),
        ]
      : ["ℹ️  未扫描到仍依赖系统级按键的 spec。"]),
    "ℹ️  完整验收：授予辅助功能权限并设置 BUG_LENS_POPUP_DRIVER=native（默认）。",
    "================================================================================",
  ].join("\n");
}

export default async function globalSetup(_config: FullConfig): Promise<void> {
  // extension-page 驱动（显式 opt-in）完全不触碰 System Events，无需辅助功能权限，
  // 因此也不应该因为 osascript 预检失败而中断整个运行。
  if (isExtensionPagePopupDriver()) {
    console.warn(formatExtensionPageBanner(listNativeShortcutDependentSpecs()));
    return;
  }

  // 显式开关：允许跳过 macOS 辅助功能预检（例如针对无需全局快捷键的用例）。
  // 默认行为保持严格不变：未设置开关时仍然强制预检，失败即中断。
  if (isAccessibilityPreflightSkipped()) {
    console.warn(formatSkipBanner(listNativeShortcutDependentSpecs()));
    if (isNativeShortcutRunForced()) {
      console.warn(
        "⚠️  BUG_LENS_FORCE_RUN_SHORTCUT_TESTS 已启用：依赖原生快捷键的用例不会被跳过，" +
          "在未授权辅助功能的情况下它们将以真实错误失败（而不是伪装通过）。"
      );
    }
    return;
  }

  if (process.platform === "darwin") {
    const status = await checkMacOSAccessibilityPermission();
    if (!status.granted) {
      const formatted = formatMacOSInputPermissionError(status.error);
      throw new Error(
        `\n================================================================================\n${formatted}\n================================================================================\n💡 如仅需运行不需要系统级快捷键的用例（如 options-preview、screenshot 等），可使用：\n   BUG_LENS_SKIP_ACCESSIBILITY_PREFLIGHT=1 pnpm test:e2e <spec-file>\n   该开关会把依赖原生快捷键的用例 test.skip 掉并打印醒目告警。\n`
      );
    }
  }
}
