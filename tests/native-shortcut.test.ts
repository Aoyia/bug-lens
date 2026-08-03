import test from "node:test";
import assert from "node:assert/strict";
import {
  formatMacOSInputPermissionError,
  parseChromeShortcut,
} from "../e2e/fixtures/native-shortcut.ts";

test("parseChromeShortcut normalizes Chrome command shortcuts", () => {
  assert.deepEqual(parseChromeShortcut("Command+Shift+Y"), {
    raw: "Command+Shift+Y",
    modifiers: ["command", "shift"],
    key: "y",
  });
  assert.deepEqual(parseChromeShortcut("Ctrl+Shift+8"), {
    raw: "Ctrl+Shift+8",
    modifiers: ["ctrl", "shift"],
    key: "8",
  });
  assert.deepEqual(parseChromeShortcut("⇧⌘Y"), {
    raw: "⇧⌘Y",
    modifiers: ["shift", "command"],
    key: "y",
  });
});

test("parseChromeShortcut rejects missing and unsupported keys", () => {
  assert.throws(() => parseChromeShortcut(""), /ACTION_SHORTCUT_UNBOUND/);
  assert.throws(
    () => parseChromeShortcut("Ctrl+F12"),
    /ACTION_SHORTCUT_UNSUPPORTED/
  );
  assert.throws(
    () => parseChromeShortcut("Ctrl+Y+Z"),
    /ACTION_SHORTCUT_UNSUPPORTED/
  );
});

test("macOS input permission error explains per-application authorization", () => {
  const message = formatMacOSInputPermissionError(
    new Error("osascript 不允许发送按键 (1002)"),
    "Apple_Terminal"
  );

  assert.match(message, /MACOS_ACCESSIBILITY_PERMISSION_REQUIRED/);
  assert.match(message, /Apple_Terminal/);
  assert.match(message, /辅助功能/);
  assert.match(message, /自动化/);
  assert.match(message, /权限彼此独立/);
  assert.match(message, /完全退出并重新打开/);
});
