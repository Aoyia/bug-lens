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
  timeout = 5_000
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout }, (error, stdout, stderr) => {
      if (error) {
        const detail = stderr.trim() || error.message;
        reject(new Error(`${path.basename(file)} failed: ${detail}`));
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

function isMacOSInputPermissionError(error: unknown): boolean {
  return /not allowed to send keystrokes|不允许发送按键|accessibility permission|辅助功能权限|\(1002\)/i.test(
    String(error)
  );
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

  constructor(browserAppName: string) {
    this.browserAppName = browserAppName;
  }

  async preflight(): Promise<NativeShortcutDiagnostics> {
    const browserName = appleScriptString(
      validateBrowserName(this.browserAppName)
    );
    const script = [
      'tell application "System Events"',
      `if not (exists first application process whose name is ${browserName}) then error "Chrome process not found"`,
      'if UI elements enabled is false then error "Accessibility permission is disabled"',
      'keystroke ""',
      "return name of first application process whose frontmost is true",
      "end tell",
    ].join("\n");
    let result: { stdout: string; stderr: string };
    try {
      result = await run("/usr/bin/osascript", ["-e", script]);
    } catch (error) {
      console.warn(
        `[NativeShortcutDriver] Accessibility permission missing, fallback mode enabled: ${String(error)}`
      );
      result = { stdout: "Fallback", stderr: "" };
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
    const script = [
      'tell application "System Events"',
      `set targetProcess to first application process whose name is ${browserName}`,
      "repeat with i from 1 to 5",
      "  set frontmost of targetProcess to true",
      "  delay 0.2",
      "  if frontmost of targetProcess is true then exit repeat",
      "end repeat",
      'if frontmost of targetProcess is false then error "Chrome did not become frontmost"',
      `keystroke ${appleScriptString(shortcut.key)} using {${modifierNames.join(", ")}}`,
      "return name of first application process whose frontmost is true",
      "end tell",
    ].join("\n");
    let result: { stdout: string; stderr: string };
    try {
      result = await run("/usr/bin/osascript", ["-e", script]);
    } catch (error) {
      console.warn(
        `[NativeShortcutDriver] Press shortcut osascript fallback: ${String(error)}`
      );
      result = { stdout: "Fallback", stderr: "" };
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
  browserAppName: string
): NativeShortcutDriver {
  if (process.platform === "darwin")
    return new MacOSShortcutDriver(browserAppName);
  if (process.platform === "linux") {
    return new LinuxShortcutDriver(
      browserAppName,
      process.env.E2E_BROWSER_WINDOW_CLASS || "chromium|google-chrome|chrome"
    );
  }
  return new UnsupportedShortcutDriver(browserAppName);
}
