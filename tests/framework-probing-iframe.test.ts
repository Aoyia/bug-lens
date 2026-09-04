import assert from "node:assert/strict";
import test, { describe } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { h } from "preact";
import render from "preact-render-to-string";
import {
  createTestRuntime,
  makeSession,
} from "./helpers/background-runtime-harness.ts";
import { installChromeMock } from "./helpers/chrome-mock.ts";
import { message } from "../src/shared/protocol.ts";
import { FrameworkStateTab } from "../src/components/preview/FrameworkStateTab.tsx";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

installChromeMock();

describe("R5: 框架状态多帧探测、权威绑定与 Preview 帧徽章 (tests/framework-probing-iframe.test.ts)", () => {
  test("用例 1：manifest.json 中 vue-devtools-hook-inject.js 声明了 all_frames: true", () => {
    const manifestPath = path.resolve(__dirname, "../src/manifest.json");
    const raw = fs.readFileSync(manifestPath, "utf8");
    const manifest = JSON.parse(raw);

    assert.ok(
      Array.isArray(manifest.content_scripts),
      "content_scripts 需为数组"
    );
    const vueHookEntry = manifest.content_scripts.find(
      (cs: any) =>
        Array.isArray(cs.js) && cs.js.includes("vue-devtools-hook-inject.js")
    );

    assert.ok(
      vueHookEntry,
      "必须包含 vue-devtools-hook-inject.js 的 content_scripts 规则"
    );
    assert.equal(
      vueHookEntry.all_frames,
      true,
      "vue-devtools-hook-inject.js 必须开启 all_frames: true 以注入子 frame"
    );
    assert.equal(vueHookEntry.world, "MAIN", "必须在 MAIN world 执行");
    assert.equal(
      vueHookEntry.run_at,
      "document_start",
      "必须在 document_start 注入"
    );
  });

  test("用例 2：Background 消息路由对 framework/state 权威覆写 sender.frameId", async () => {
    const { runtime, db } = createTestRuntime();
    const session = makeSession({
      id: "sess-frame-probe",
      status: "RECORDING",
    });
    db.sessions.set(session.id, session);
    db.activeSessionId = session.id;

    let receivedState: any = null;
    const originalSave = db.saveFrameworkStateWithinBudget.bind(db);
    db.saveFrameworkStateWithinBudget = async (st: any) => {
      receivedState = st;
      return originalSave(st);
    };

    const sender = {
      tab: { id: 42 },
      frameId: 7,
      url: "https://example.com/subframe",
    } as chrome.runtime.MessageSender;

    const res = (await runtime.handleMessage(
      message("framework/state", {
        state: {
          sessionId: "sess-frame-probe",
          page: {
            url: "https://example.com/subframe",
            title: "Subframe",
            frameId: -1, // 内容脚本沙箱填写的占位值
          },
          tree: {},
        },
      }),
      sender
    )) as { ok: boolean; stored: boolean };

    assert.equal(res.ok, true);
    assert.equal(res.stored, true);
    assert.ok(receivedState, "应当持久化状态对象");
    assert.equal(
      receivedState.page?.frameId,
      7,
      "Background 应当使用 sender.frameId 权威覆写 state.page.frameId 为 7（而非 -1）"
    );
  });

  test("用例 3：FrameworkStateTab 正确渲染 Top Frame 与 Frame [frameId] 徽章", () => {
    const states: any[] = [
      {
        id: "fs-top",
        sessionId: "sess-1",
        trigger: "start",
        capturedAtEpochMs: 1_700_000_000_000,
        page: {
          url: "https://example.com/top",
          title: "Top Frame",
          frameId: 0,
        },
      },
      {
        id: "fs-sub",
        sessionId: "sess-1",
        trigger: "evidence-tick",
        capturedAtEpochMs: 1_700_000_002_000,
        page: {
          url: "https://example.com/sub",
          title: "Subframe",
          frameId: 3,
        },
      },
    ];

    const html = render(
      h(FrameworkStateTab, {
        states,
        startedAtEpochMs: 1_700_000_000_000,
      })
    );

    assert.ok(
      html.includes('class="framework-frame-badge badge-topframe"'),
      "卡片头部必须包含 class='framework-frame-badge badge-topframe'"
    );
    assert.ok(html.includes("Top Frame"), "必须渲染 'Top Frame' 徽章文本");

    assert.ok(
      html.includes('class="framework-frame-badge badge-subframe"'),
      "卡片头部必须包含 class='framework-frame-badge badge-subframe'"
    );
    assert.ok(html.includes("Frame [3]"), "必须渲染 'Frame [3]' 徽章文本");
  });
});
