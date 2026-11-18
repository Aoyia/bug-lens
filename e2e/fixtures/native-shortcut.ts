import { execFile } from "node:child_process";
import path from "node:path";

export type ShortcutModifier = "command" | "ctrl" | "alt" | "shift" | "macctrl";

export type ActionShortcut = {
  raw: string;
  modifiers: ShortcutModifier[];
  key: string;
};

export type NativeShortcutDiagnostics = {
  platform: NodeJS.Platform;
  browserAppName: string;
  focusedWindow?: string;
  sentAtEpochMs?: number;
};

export interface NativeShortcutDriver {
  preflight(): Promise<NativeShortcutDiagnostics>;
  press(shortcut: ActionShortcut): Promise<NativeShortcutDiagnostics>;
}

/**
 * Action Popup 的驱动方式：
 * - `native`（默认）：原有 System Events 原生快捷键（⇧⌘Y）路径，需要 macOS 辅助功能权限；
 *   缺少权限时 global-setup 立即 fail-fast 中断，避免大量用例白跑到深层才失败。
 * - `extension-page`（显式 opt-in）：service worker 侧调用 `chrome.action.openPopup()`
 *   打开真实 Action Popup，不发送任何系统级按键，因此不依赖辅助功能权限。
 *   注意它只是**降级冒烟**：Chrome 的 activeTab 安全模型会让 tabCapture 一直失败，
 *   不能替代 native 驱动做完整录制验收（详见 e2e/README.md）。
 */
export type PopupDriverMode = "native" | "extension-page";

/**
 * 读取 BUG_LENS_POPUP_DRIVER。
 * 默认 `native`：保持 global-setup 的权限 fail-fast 语义；
 * `extension-page` 仅在无辅助功能权限、只想做 popup 冒烟时显式开启。
 */
export function popupDriverMode(): PopupDriverMode {
  const raw = (process.env.BUG_LENS_POPUP_DRIVER ?? "").trim().toLowerCase();
  if (raw === "" || raw === "native") return "native";
  if (raw === "extension-page") return "extension-page";
  throw new Error(
    `BUG_LENS_POPUP_DRIVER_UNSUPPORTED: 仅支持 extension-page | native，实际收到 ${JSON.stringify(
      process.env.BUG_LENS_POPUP_DRIVER
    )}`
  );
}

/** 当前是否为“不依赖系统级按键”的扩展内 popup 驱动。 */
export function isExtensionPagePopupDriver(): boolean {
  return popupDriverMode() === "extension-page";
}

/**
 * 是否显式跳过 macOS 辅助功能预检。
 * 默认（未设置任何环境变量）保持严格：global-setup 仍会强制预检并在失败时中断。
 */
export function isAccessibilityPreflightSkipped(): boolean {
  const raw =
    process.env.BUG_LENS_SKIP_ACCESSIBILITY_PREFLIGHT ??
    process.env.SKIP_ACCESSIBILITY_CHECK;
  if (!raw) return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true";
}

/** 跳过预检后仍强制运行依赖系统级键盘模拟的用例（用于暴露真实失败而非静默跳过）。 */
export function isNativeShortcutRunForced(): boolean {
  const raw = process.env.BUG_LENS_FORCE_RUN_SHORTCUT_TESTS;
  if (!raw) return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true";
}

/**
 * 依赖系统级键盘模拟的用例应被跳过时返回原因，否则返回 undefined。
 *
 * 两种触发条件（都会先被 BUG_LENS_FORCE_RUN_SHORTCUT_TESTS 覆盖）：
 * 1. BUG_LENS_POPUP_DRIVER=extension-page（显式 opt-in）：本次运行根本不会发送系统级按键，
 *    因此凡是真的要按物理快捷键的用例（原生快捷键录制）都不具备执行前提，必须跳过而不是伪装通过。
 * 2. 显式 BUG_LENS_SKIP_ACCESSIBILITY_PREFLIGHT=1 且驱动为 native：避免在缺少权限时
 *    把“未执行”包装成“通过”。
 *
 * 注意：只影响直接依赖 nativeShortcutDriver 的用例；openActionPopup 在 extension-page
 * 驱动下不再经过这里（它不需要系统级按键），因此不会被误跳过。
 */
export function nativeShortcutSkipReason(): string | undefined {
  if (isNativeShortcutRunForced()) return undefined;
  if (isExtensionPagePopupDriver()) {
    return "SKIPPED_BY_POPUP_DRIVER: BUG_LENS_POPUP_DRIVER=extension-page 只驱动扩展内部 Action Popup，不发送 System Events 系统级物理按键；本用例真正依赖原生快捷键触发，无法在该驱动下验证真实行为，故不执行（结果不可信）。如已授予辅助功能权限，请设置 BUG_LENS_POPUP_DRIVER=native；若只想强制观察真实失败，设置 BUG_LENS_FORCE_RUN_SHORTCUT_TESTS=1。";
  }
  if (!isAccessibilityPreflightSkipped()) return undefined;
  return "SKIPPED_BY_ACCESSIBILITY_PREFLIGHT_BYPASS: BUG_LENS_SKIP_ACCESSIBILITY_PREFLIGHT 已跳过 macOS 辅助功能预检；本用例依赖 System Events 系统级按键模拟，缺少该权限时真实行为无法验证，故不执行（结果不可信）。若需强制观察真实失败，设置 BUG_LENS_FORCE_RUN_SHORTCUT_TESTS=1。";
}

const MODIFIER_ALIASES = new Map<string, ShortcutModifier>([
  ["command", "command"],
  ["cmd", "command"],
  ["⌘", "command"],
  ["control", "ctrl"],
  ["ctrl", "ctrl"],
  ["^", "ctrl"],
  ["alt", "alt"],
  ["option", "alt"],
  ["⌥", "alt"],
  ["shift", "shift"],
  ["⇧", "shift"],
  ["macctrl", "macctrl"],
]);

function run(
  file: string,
  args: string[],
  timeout = 10_000
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout }, (error, stdout, stderr) => {
      if (error) {
        const code = (error as NodeJS.ErrnoException).code ?? "";
        const detail = stderr.trim() || error.message;
        reject(
          new Error(
            `${path.basename(file)} failed${code ? ` (${code})` : ""}: ${detail}`
          )
        );
        return;
      }
      resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

export function parseChromeShortcut(raw: string): ActionShortcut {
  const expanded = raw
    .replaceAll("⇧", "Shift+")
    .replaceAll("⌘", "Command+")
    .replaceAll("⌥", "Alt+")
    .replaceAll("⌃", "Ctrl+");
  const tokens = expanded
    .split("+")
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length < 2)
    throw new Error(
      `ACTION_SHORTCUT_UNBOUND: 无效快捷键 ${JSON.stringify(raw)}`
    );

  const modifiers: ShortcutModifier[] = [];
  let key = "";
  for (const token of tokens) {
    const modifier =
      MODIFIER_ALIASES.get(token.toLocaleLowerCase()) ??
      MODIFIER_ALIASES.get(token);
    if (modifier) {
      if (!modifiers.includes(modifier)) modifiers.push(modifier);
      continue;
    }
    if (key)
      throw new Error(
        `ACTION_SHORTCUT_UNSUPPORTED: 快捷键包含多个主键 ${JSON.stringify(raw)}`
      );
    if (!/^[a-z0-9]$/i.test(token))
      throw new Error(
        `ACTION_SHORTCUT_UNSUPPORTED: 不支持的主键 ${JSON.stringify(token)}`
      );
    key = token.toLocaleLowerCase();
  }

  if (!key || !modifiers.length)
    throw new Error(
      `ACTION_SHORTCUT_UNSUPPORTED: 快捷键缺少主键或修饰键 ${JSON.stringify(raw)}`
    );
  return { raw, modifiers, key };
}

function validateBrowserName(value: string): string {
  if (!value || !/^[a-z0-9 ._-]+$/i.test(value)) {
    throw new Error(
      `NATIVE_DRIVER_UNAVAILABLE: 无效浏览器进程名 ${JSON.stringify(value)}`
    );
  }
  return value;
}

function appleScriptString(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function macOSPermissionHost(): string {
  return (
    process.env.E2E_PERMISSION_HOST_APP ??
    process.env.TERM_PROGRAM ??
    process.env.__CFBundleIdentifier ??
    "当前终端、IDE 或 Runner"
  );
}

export function isMacOSInputPermissionError(error: unknown): boolean {
  return /not allowed to send keystrokes|不允许发送按键|accessibility permission|辅助功能权限|\(1002\)|-2700|-1712|AppleEvent|ETIMEDOUT|killed/i.test(
    String(error)
  );
}

export async function checkMacOSAccessibilityPermission(): Promise<{
  granted: boolean;
  error?: unknown;
}> {
  if (process.platform !== "darwin") {
    return { granted: true };
  }
  try {
    const { stdout } = await run("/usr/bin/osascript", [
      "-e",
      'tell application "System Events" to get UI elements enabled',
    ]);
    if (stdout.trim() === "true") {
      return { granted: true };
    }
    return {
      granted: false,
      error: new Error(
        "osascript failed: Accessibility permission is disabled (-2700)"
      ),
    };
  } catch (error) {
    return { granted: false, error };
  }
}

export function formatMacOSInputPermissionError(
  error: unknown,
  hostApp = macOSPermissionHost()
): string {
  return [
    "MACOS_ACCESSIBILITY_PERMISSION_REQUIRED: macOS 已阻止 E2E 发送系统级快捷键。",
    "这不是扩展录制失败，而是当前启动测试的应用没有获得模拟按键权限。",
    `当前启动应用：${hostApp}`,
    "请执行以下操作：",
    "1. 打开 系统设置 → 隐私与安全性 → 辅助功能。",
    `2. 启用 ${hostApp}；如果列表中没有，请手动添加实际使用的 Terminal、iTerm、Warp 或 IDE。`,
    "3. 在 隐私与安全性 → 自动化 中，允许该应用控制 System Events（若显示，也允许控制 Google Chrome for Testing）。",
    "4. 完全退出并重新打开该应用，然后再次运行 pnpm test:e2e。",
    "注意：Codex、Terminal、iTerm、Warp 和 IDE 的权限彼此独立；在 Codex 中能够运行，不代表终端已经获得权限。",
    `原始错误：${String(error)}`,
  ].join("\n");
}

class MacOSShortcutDriver implements NativeShortcutDriver {
  private readonly browserAppName: string;
  private readonly browserPid?: number;

  constructor(browserAppName: string, browserPid?: number) {
    this.browserAppName = browserAppName;
    this.browserPid = browserPid;
  }

  private async activateProcess(): Promise<void> {
    if (this.browserPid) {
      const jxa = [
        'ObjC.import("AppKit");',
        `var app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(${this.browserPid});`,
        "if (app && !app.isNil()) {",
        "  app.activateWithOptions($.NSApplicationActivateIgnoringOtherApps);",
        "}",
      ].join(" ");
      try {
        await run("/usr/bin/osascript", ["-l", "JavaScript", "-e", jxa]);
        return;
      } catch {
        // JXA 激活失败安全回退
      }
    }
    const browserName = appleScriptString(
      validateBrowserName(this.browserAppName)
    );
    await run("/usr/bin/osascript", [
      "-e",
      `tell application ${browserName} to activate`,
    ]).catch(() => undefined);
  }

  async preflight(): Promise<NativeShortcutDiagnostics> {
    await this.activateProcess();
    const script = [
      "delay 0.15",
      'tell application "System Events"',
      'if UI elements enabled is false then error "Accessibility permission is disabled"',
      'keystroke ""',
      "return name of first application process whose frontmost is true",
      "end tell",
    ].join("\n");
    let result: { stdout: string; stderr: string };
    try {
      result = await run("/usr/bin/osascript", ["-e", script]);
    } catch (error) {
      if (isMacOSInputPermissionError(error)) {
        throw new Error(formatMacOSInputPermissionError(error));
      }
      throw new Error(
        `NATIVE_SHORTCUT_PREFLIGHT_FAILED: 预检全局快捷键驱动失败。${String(error)}`
      );
    }
    return {
      platform: process.platform,
      browserAppName: this.browserAppName,
      focusedWindow: result.stdout,
    };
  }

  async press(shortcut: ActionShortcut): Promise<NativeShortcutDiagnostics> {
    const browserName = appleScriptString(
      validateBrowserName(this.browserAppName)
    );
    const modifierNames = shortcut.modifiers.map((modifier) => {
      if (modifier === "command") return "command down";
      if (modifier === "ctrl" || modifier === "macctrl") return "control down";
      if (modifier === "alt") return "option down";
      return "shift down";
    });

    if (this.browserPid) {
      const jxa = `ObjC.import("AppKit"); var app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(${this.browserPid}); if (app && !app.isNil()) { app.activateWithOptions($.NSApplicationActivateIgnoringOtherApps); }`;
      await run("/usr/bin/osascript", ["-l", "JavaScript", "-e", jxa]).catch(
        () => undefined
      );
    }

    const setFrontmostCommand = this.browserPid
      ? `set frontmost of (first process whose unix id is ${this.browserPid}) to true`
      : `set frontmost of (first process whose name is ${browserName}) to true`;

    // 核心契约：必须先通过 System Events 精确置顶测试实例，配合 200ms 等待确保 macOS WindowServer 完成物理窗口键盘焦点绑定，然后再触发物理按键。
    const script = [
      'tell application "System Events"',
      "  try",
      `    ${setFrontmostCommand}`,
      "  on error",
      "    -- fallback if process query fails",
      "  end try",
      "  delay 0.2",
      `  keystroke ${appleScriptString(shortcut.key)} using {${modifierNames.join(", ")}}`,
      "  return name of first application process whose frontmost is true",
      "end tell",
    ].join("\n");
    let result: { stdout: string; stderr: string };
    try {
      result = await run("/usr/bin/osascript", ["-e", script]);
    } catch (error) {
      if (isMacOSInputPermissionError(error)) {
        throw new Error(formatMacOSInputPermissionError(error));
      }
      throw new Error(
        `NATIVE_SHORTCUT_FAILED: 系统级全局快捷键发送失败，无法拉起 Action Popup。${String(error)}`
      );
    }
    return {
      platform: process.platform,
      browserAppName: this.browserAppName,
      focusedWindow: result.stdout,
      sentAtEpochMs: Date.now(),
    };
  }
}

class LinuxShortcutDriver implements NativeShortcutDriver {
  private readonly browserAppName: string;
  private readonly windowClass: string;

  constructor(browserAppName: string, windowClass: string) {
    this.browserAppName = browserAppName;
    this.windowClass = windowClass;
  }

  async preflight(): Promise<NativeShortcutDiagnostics> {
    if (!process.env.DISPLAY)
      throw new Error("NATIVE_DRIVER_UNAVAILABLE: Linux E2E 缺少 DISPLAY");
    await run("xdotool", ["getactivewindow"]);
    return { platform: process.platform, browserAppName: this.browserAppName };
  }

  async press(shortcut: ActionShortcut): Promise<NativeShortcutDiagnostics> {
    const search = await run("xdotool", [
      "search",
      "--onlyvisible",
      "--class",
      this.windowClass,
    ]);
    const windowId = search.stdout.split(/\s+/).filter(Boolean).at(-1);
    if (!windowId || !/^\d+$/.test(windowId))
      throw new Error("BROWSER_FOCUS_FAILED: 未找到 Chrome 窗口");
    await run("xdotool", ["windowactivate", "--sync", windowId]);
    const modifierNames = shortcut.modifiers.map((modifier) => {
      if (modifier === "command") return "super";
      if (modifier === "macctrl") return "ctrl";
      return modifier;
    });
    await run("xdotool", [
      "key",
      "--window",
      windowId,
      "--clearmodifiers",
      [...modifierNames, shortcut.key].join("+"),
    ]);
    return {
      platform: process.platform,
      browserAppName: this.browserAppName,
      focusedWindow: windowId,
      sentAtEpochMs: Date.now(),
    };
  }
}

class UnsupportedShortcutDriver implements NativeShortcutDriver {
  private readonly browserAppName: string;

  constructor(browserAppName: string) {
    this.browserAppName = browserAppName;
  }

  async preflight(): Promise<NativeShortcutDiagnostics> {
    throw new Error(
      `NATIVE_DRIVER_UNAVAILABLE: 尚未支持 ${process.platform} 系统快捷键驱动`
    );
  }

  async press(): Promise<NativeShortcutDiagnostics> {
    return this.preflight();
  }
}

export function browserAppNameFromExecutable(executablePath: string): string {
  return process.env.E2E_BROWSER_APP_NAME || path.basename(executablePath);
}

export function createNativeShortcutDriver(
  browserAppName: string,
  browserPid?: number
): NativeShortcutDriver {
  if (process.platform === "darwin")
    return new MacOSShortcutDriver(browserAppName, browserPid);
  if (process.platform === "linux") {
    return new LinuxShortcutDriver(
      browserAppName,
      process.env.E2E_BROWSER_WINDOW_CLASS || "chromium|google-chrome|chrome"
    );
  }
  return new UnsupportedShortcutDriver(browserAppName);
}
