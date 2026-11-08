import type { FullConfig } from "@playwright/test";
import {
  checkMacOSAccessibilityPermission,
  formatMacOSInputPermissionError,
} from "./fixtures/native-shortcut.ts";

export default async function globalSetup(_config: FullConfig): Promise<void> {
  // 允许通过环境变量显式跳过 macOS 快捷键辅助功能预检（例如针对无需全局快捷键的 UI 独立用例）
  if (
    process.env.SKIP_ACCESSIBILITY_CHECK === "true" ||
    process.env.SKIP_ACCESSIBILITY_CHECK === "1"
  ) {
    return;
  }

  if (process.platform === "darwin") {
    const status = await checkMacOSAccessibilityPermission();
    if (!status.granted) {
      const formatted = formatMacOSInputPermissionError(status.error);
      throw new Error(
        `\n================================================================================\n${formatted}\n================================================================================\n💡 如仅需运行不需要系统级快捷键的用例（如 options-preview、screenshot 等），可使用：\n   SKIP_ACCESSIBILITY_CHECK=true pnpm test:e2e <spec-file>\n`
      );
    }
  }
}
