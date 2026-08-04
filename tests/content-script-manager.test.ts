import assert from "node:assert/strict";
import test from "node:test";

import { ContentScriptManager } from "../src/recording/content-script-manager.ts";

function installChromeScripting(options: { registered?: boolean } = {}) {
  const calls: string[] = [];
  (globalThis as any).chrome = {
    scripting: {
      async getRegisteredContentScripts() {
        calls.push("getRegisteredContentScripts");
        return options.registered ? [{ id: "web-bug-recorder-content" }] : [];
      },
      async registerContentScripts(scripts: Array<{ id: string }>) {
        calls.push(`register:${scripts[0].id}`);
        if (options.registered) throw new Error("already exists");
      },
      async executeScript(details: {
        target: { tabId: number; allFrames?: boolean };
        files: string[];
      }) {
        calls.push(
          `execute:${details.target.tabId}:${details.target.allFrames}:${details.files.join(",")}`
        );
      },
      async unregisterContentScripts() {
        calls.push("unregister");
      },
    },
  };
  return calls;
}

test("ContentScriptManager.restore re-executes content.js for the new document", async () => {
  const calls = installChromeScripting({ registered: true });
  const manager = new ContentScriptManager();

  await manager.restore(42);

  assert.deepEqual(calls, [
    "register:web-bug-recorder-content",
    "getRegisteredContentScripts",
    "execute:42:true:content.js",
  ]);
});

test("ContentScriptManager.restore registers the script before executing it when needed", async () => {
  const calls = installChromeScripting({ registered: false });
  const manager = new ContentScriptManager();

  await manager.restore(7);

  assert.deepEqual(calls, [
    "register:web-bug-recorder-content",
    "getRegisteredContentScripts",
    "execute:7:true:content.js",
  ]);
});

test("ContentScriptManager 注入失败时自动重试一次", async () => {
  let attempts = 0;
  const calls: string[] = [];
  (globalThis as any).chrome = {
    scripting: {
      async getRegisteredContentScripts() {
        calls.push("getRegisteredContentScripts");
        return [{ id: "web-bug-recorder-content" }];
      },
      async registerContentScripts() {},
      async executeScript(details: { target: { tabId: number } }) {
        attempts += 1;
        calls.push(`execute:${details.target.tabId}:attempt${attempts}`);
        if (attempts === 1) throw new Error("injection failed");
      },
      async unregisterContentScripts() {},
    },
  };
  const manager = new ContentScriptManager();

  await manager.activate(42);

  assert.deepEqual(calls, [
    "getRegisteredContentScripts",
    "execute:42:attempt1",
    "execute:42:attempt2",
  ]);
});
