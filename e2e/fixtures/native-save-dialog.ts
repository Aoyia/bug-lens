import { execFile } from "node:child_process";
import path from "node:path";
import { formatMacOSInputPermissionError } from "./native-shortcut.ts";

function run(
  file: string,
  args: string[],
  timeout = 15_000
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

function appleScriptString(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function isMacOSInputPermissionError(error: unknown): boolean {
  return /not allowed to send keystrokes|不允许发送按键|accessibility permission|辅助功能权限|\(1002\)/i.test(
    String(error)
  );
}

export interface NativeSaveDialogDriver {
  saveToDirectory(absolutePath: string, timeoutMs?: number): Promise<void>;
}

export class MacOSSaveDialogDriver implements NativeSaveDialogDriver {
  private readonly browserAppName: string;

  constructor(browserAppName: string) {
    this.browserAppName = browserAppName;
  }

  async saveToDirectory(
    absolutePath: string,
    timeoutMs = 15_000
  ): Promise<void> {
    if (process.platform !== "darwin") {
      throw new Error(
        "NATIVE_SAVE_UNSUPPORTED: Native save dialog driver is only supported on macOS."
      );
    }

    const browserName = appleScriptString(this.browserAppName);
    const targetDir = appleScriptString(absolutePath);

    const script = [
      'tell application "System Events"',
      `  set targetProcess to first application process whose name is ${browserName}`,
      '  if UI elements enabled is false then error "Accessibility permission is disabled"',
      "",
      "  -- 1. Wait for Save sheet to appear",
      "  set sheetAppeared to false",
      "  repeat with i from 1 to 150",
      "    repeat with w in every window of targetProcess",
      "      if exists sheet 1 of w then",
      "        set frontmost of w to true",
      "        set sheetAppeared to true",
      "        exit repeat",
      "      end if",
      "    end repeat",
      "    if sheetAppeared is true then exit repeat",
      "    delay 0.2",
      "  end repeat",
      '  if sheetAppeared is false then error "Save sheet did not appear"',
      "",
      "  -- 2. Open Go to Folder dialog (Command + Shift + G)",
      "  set frontmost of targetProcess to true",
      '  keystroke "g" using {command down, shift down}',
      "  delay 0.5",
      "",
      "  -- 3. Enter the absolute path",
      `  keystroke ${targetDir}`,
      "  delay 0.5",
      "",
      "  -- 4. Press Return to confirm folder",
      "  key code 36",
      "  delay 0.5",
      "",
      "  -- 5. Press Return again to save",
      "  key code 36",
      "",
      "  -- 6. Wait for sheet to disappear",
      "  set sheetDisappeared to false",
      "  repeat with i from 1 to 50",
      "    if not (exists sheet 1 of front window of targetProcess) then",
      "      set sheetDisappeared to true",
      "      exit repeat",
      "    end if",
      "    delay 0.2",
      "  end repeat",
      '  if sheetDisappeared is false then error "Save button did not take effect or sheet stayed open"',
      "end tell",
    ].join("\n");

    try {
      await run("/usr/bin/osascript", ["-e", script], timeoutMs);
    } catch (error) {
      if (isMacOSInputPermissionError(error)) {
        throw new Error(formatMacOSInputPermissionError(error));
      }
      throw new Error(
        `NATIVE_SAVE_FAILED: 无法操作保存对话框。${String(error)}`
      );
    }
  }
}

export class UnsupportedSaveDialogDriver implements NativeSaveDialogDriver {
  async saveToDirectory(): Promise<void> {
    throw new Error(
      "NATIVE_SAVE_UNSUPPORTED: Native save dialog driver is only supported on macOS."
    );
  }
}

export function createNativeSaveDialogDriver(
  browserAppName: string
): NativeSaveDialogDriver {
  if (process.platform === "darwin")
    return new MacOSSaveDialogDriver(browserAppName);
  return new UnsupportedSaveDialogDriver();
}
