import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { h } from "preact";
import render from "preact-render-to-string";
import {
  createTestRuntime,
  makeSession,
} from "./helpers/background-runtime-harness.ts";
import { installChromeMock } from "./helpers/chrome-mock.ts";
import {
  message,
  type FrameworkStateEvidence,
  type FrameworkProbeEntry,
} from "../src/shared/protocol.ts";
import { FrameworkStateTab } from "../src/components/preview/FrameworkStateTab.tsx";
import {
  captureFrameworkState,
  isMeaningfulFrameworkState,
} from "../src/domain/framework-state-capture.ts";

const { handlers } = installChromeMock();

describe("Challenger M3 Empirical Adversarial Suite: R5 框架探测、Background 权威路由与 Preview 帧徽章深度压测", () => {
  describe("1. Background 消息路由与权威绑定极限压测 (R5.1 & R5.2)", () => {
    test("1.1 边界与异常 frameId (0, undefined, 999999, -1) 下的权威绑定", async () => {
      const { runtime, db } = createTestRuntime();
      const session = makeSession({ id: "sess-adv-r5-1", status: "RECORDING" });
      db.sessions.set(session.id, session);
      db.activeSessionId = session.id;

      const savedStates: FrameworkStateEvidence[] = [];
      db.saveFrameworkStateWithinBudget = async (st: any) => {
        savedStates.push(JSON.parse(JSON.stringify(st)));
        return { stored: true };
      };

      // 1.1a sender.frameId = 0 (顶层主帧)
      // 内容脚本由于沙箱隔离可能上报 frameId: -1 或 99，Background 必须强制覆写为 0
      const res0 = (await runtime.handleMessage(
        message("framework/state", {
          state: {
            sessionId: "sess-adv-r5-1",
            capturedAtEpochMs: 1_700_000_000_100,
            trigger: "start",
            page: {
              url: "https://example.com/top",
              title: "Top Frame",
              frameId: -1,
            },
            tree: {},
          },
        }),
        { tab: { id: 42 }, frameId: 0, url: "https://example.com/top" } as any
      )) as { ok: boolean; stored: boolean };

      assert.equal(res0.ok, true);
      assert.equal(res0.stored, true);
      const state0 = savedStates.find(
        (s) => s.page?.url === "https://example.com/top"
      );
      assert.ok(state0, "应当存入主帧状态");
      assert.equal(
        state0.page.frameId,
        0,
        "sender.frameId=0 必须权威覆写为 0，不能被 falsy 误判忽略"
      );

      // 1.1b sender.frameId = undefined (未定义 frameId 的异常 sender)
      const resUndef = (await runtime.handleMessage(
        message("framework/state", {
          state: {
            sessionId: "sess-adv-r5-1",
            capturedAtEpochMs: 1_700_000_000_200,
            trigger: "start",
            page: {
              url: "https://example.com/no-frame-sender",
              title: "No Frame Sender",
              frameId: 3, // 内容脚本原先带的
            },
            tree: {},
          },
        }),
        { tab: { id: 42 }, url: "https://example.com/no-frame-sender" } as any // sender.frameId is undefined
      )) as { ok: boolean; stored: boolean };

      assert.equal(resUndef.ok, true);
      assert.equal(resUndef.stored, true);
      const stateUndef = savedStates.find(
        (s) => s.page?.url === "https://example.com/no-frame-sender"
      );
      assert.ok(stateUndef);
      assert.equal(
        stateUndef.page.frameId,
        3,
        "当 sender.frameId 为 undefined 时，Background 不应无故覆盖原有 frameId"
      );

      // 1.1c sender.frameId = 999999 (极端超大整数)
      const resHuge = (await runtime.handleMessage(
        message("framework/state", {
          state: {
            sessionId: "sess-adv-r5-1",
            capturedAtEpochMs: 1_700_000_000_300,
            trigger: "start",
            page: {
              url: "https://example.com/microfront-999999",
              title: "Huge Frame Sub",
              frameId: 0,
            },
            tree: {},
          },
        }),
        {
          tab: { id: 42 },
          frameId: 999999,
          url: "https://example.com/microfront-999999",
        } as any
      )) as { ok: boolean; stored: boolean };

      assert.equal(resHuge.ok, true);
      assert.equal(resHuge.stored, true);
      const stateHuge = savedStates.find(
        (s) => s.page?.url === "https://example.com/microfront-999999"
      );
      assert.ok(stateHuge);
      assert.equal(
        stateHuge.page.frameId,
        999999,
        "sender.frameId=999999 必须准确绑定为 999999"
      );

      // 1.1d sender.frameId = -1
      const resNeg = (await runtime.handleMessage(
        message("framework/state", {
          state: {
            sessionId: "sess-adv-r5-1",
            capturedAtEpochMs: 1_700_000_000_400,
            trigger: "start",
            page: {
              url: "https://example.com/neg-frame",
              title: "Neg Frame",
              frameId: 10,
            },
            tree: {},
          },
        }),
        {
          tab: { id: 42 },
          frameId: -1,
          url: "https://example.com/neg-frame",
        } as any
      )) as { ok: boolean; stored: boolean };

      assert.equal(resNeg.ok, true);
      const stateNeg = savedStates.find(
        (s) => s.page?.url === "https://example.com/neg-frame"
      );
      assert.ok(stateNeg);
      assert.equal(stateNeg.page.frameId, -1);
    });

    test("1.2 state.page 缺失或损坏时的自动修复与防御", async () => {
      const { runtime, db } = createTestRuntime();
      const session = makeSession({ id: "sess-adv-r5-2", status: "RECORDING" });
      db.sessions.set(session.id, session);
      db.activeSessionId = session.id;

      let saved: any = null;
      db.saveFrameworkStateWithinBudget = async (st: any) => {
        saved = st;
        return { stored: true };
      };

      // 恶意/残缺消息：没有 state.page 字段
      const res = (await runtime.handleMessage(
        message("framework/state", {
          state: {
            sessionId: "sess-adv-r5-2",
            capturedAtEpochMs: 1_700_000_000_500,
            trigger: "start",
            // page 字段故意省略
          },
        }),
        { tab: { id: 42 }, frameId: 17 } as any
      )) as { ok: boolean; stored: boolean };

      assert.equal(res.ok, true);
      assert.equal(res.stored, true);
      assert.ok(saved, "应当安全存储");
      assert.equal(
        saved.page?.frameId,
        17,
        "缺失 page 字段时，Background 应当安全补全 page 并绑定 frameId: 17，无 TypeError"
      );
    });

    test("1.3 会话非法或 TabId 不匹配时的严格拒收", async () => {
      const { runtime, db } = createTestRuntime();
      const session = makeSession({ id: "sess-adv-r5-3", status: "STOPPING" }); // 非录制中
      db.sessions.set(session.id, session);
      db.activeSessionId = session.id;

      let savedCalled = false;
      db.saveFrameworkStateWithinBudget = async () => {
        savedCalled = true;
        return { stored: true };
      };

      // 发送至非录制会话
      const res1 = (await runtime.handleMessage(
        message("framework/state", {
          state: {
            sessionId: "sess-adv-r5-3",
            page: { url: "https://example.com", title: "" },
          },
        }),
        { tab: { id: 42 }, frameId: 0 } as any
      )) as { ok: boolean; stored: boolean };

      assert.equal(res1.ok, true);
      assert.equal(res1.stored, false, "非 RECORDING 状态不应当存库");
      assert.equal(savedCalled, false);

      // 恢复会话为 RECORDING，但 sender.tab.id 不匹配
      session.status = "RECORDING";
      const res2 = (await runtime.handleMessage(
        message("framework/state", {
          state: {
            sessionId: "sess-adv-r5-3",
            page: { url: "https://example.com", title: "" },
          },
        }),
        { tab: { id: 999 }, frameId: 0 } as any // 目标 tab 是 42，发送方是 999
      )) as { ok: boolean; stored: boolean };

      assert.equal(res2.ok, true);
      assert.equal(res2.stored, false, "来自非录制目标 Tab 的框架上报应当丢弃");
      assert.equal(savedCalled, false);
    });

    test("1.4 screenshot/framework-probe 在 allFrames 及不同 frameId 下的目标参数构建与结果聚合", async () => {
      const { runtime, db } = createTestRuntime();
      const session = makeSession({ id: "sess-adv-r5-4", status: "RECORDING" });
      db.sessions.set(session.id, session);
      db.activeSessionId = session.id;

      let lastTarget: any = null;
      handlers.executeScript = async (details: any) => {
        lastTarget = details.target;
        if (details.target.allFrames) {
          // 模拟返回 3 个 frame 的探测结果，其中一个包含 null/空
          return [
            {
              frameId: 0,
              result: {
                probe_1: {
                  componentName: "AppRoot",
                  framework: "vue3",
                  componentChain: ["AppRoot"],
                },
              },
            },
            {
              frameId: 2,
              result: {
                probe_2: {
                  componentName: "MicroButton",
                  framework: "react",
                  componentChain: ["MicroButton", "Card"],
                },
              },
            },
            {
              frameId: 5,
              result: null, // 异常/空探针结果
            },
          ];
        } else {
          return [
            {
              frameId: details.target.frameIds?.[0] ?? 0,
              result: {
                probe_1: {
                  componentName: "SingleFrameComp",
                  framework: "vue3",
                  componentChain: ["SingleFrameComp"],
                },
              },
            },
          ];
        }
      };

      // 1.4a allFrames: true
      const resAll = (await runtime.handleMessage(
        message("screenshot/framework-probe", {
          probeIds: ["probe_1", "probe_2"],
          allFrames: true,
        }),
        { tab: { id: 42 }, frameId: 0 } as any
      )) as {
        ok: boolean;
        results: Record<string, FrameworkProbeEntry | null>;
      };

      assert.equal(resAll.ok, true);
      assert.deepEqual(lastTarget, { tabId: 42, allFrames: true });
      assert.ok(resAll.results.probe_1);
      assert.equal(resAll.results.probe_1.componentName, "AppRoot");
      assert.ok(resAll.results.probe_2);
      assert.equal(resAll.results.probe_2.componentName, "MicroButton");

      // 1.4b allFrames: false, sender.frameId = 999999
      const resSub = (await runtime.handleMessage(
        message("screenshot/framework-probe", {
          probeIds: ["probe_1"],
          allFrames: false,
        }),
        { tab: { id: 42 }, frameId: 999999 } as any
      )) as {
        ok: boolean;
        results: Record<string, FrameworkProbeEntry | null>;
      };

      assert.equal(resSub.ok, true);
      assert.deepEqual(lastTarget, { tabId: 42, frameIds: [999999] });
      assert.equal(resSub.results.probe_1?.componentName, "SingleFrameComp");

      // 1.4c allFrames: false, sender.frameId = undefined
      const resUndefTarget = (await runtime.handleMessage(
        message("screenshot/framework-probe", {
          probeIds: ["probe_1"],
          allFrames: false,
        }),
        { tab: { id: 42 } } as any // frameId undefined
      )) as { ok: boolean; results: any };

      assert.equal(resUndefTarget.ok, true);
      assert.deepEqual(
        lastTarget,
        { tabId: 42, frameIds: [0] },
        "sender.frameId 为 undefined 时回退到 [0]"
      );
    });
  });

  describe("2. 多微前端高并发 framework/state 消息投递与稳定性 (Concurrency & Isolation)", () => {
    test("2.1 55 个并发微前端上报：数据隔离、高并发无死锁、无串扰", async () => {
      const { runtime, db } = createTestRuntime();
      const session = makeSession({
        id: "sess-concurrency",
        status: "RECORDING",
      });
      db.sessions.set(session.id, session);
      db.activeSessionId = session.id;

      const storedStates: FrameworkStateEvidence[] = [];
      db.saveFrameworkStateWithinBudget = async (st: any) => {
        // 模拟微小的非确定性异步延迟以暴露潜在 race condition
        await new Promise((r) => setTimeout(r, Math.random() * 5));
        storedStates.push(JSON.parse(JSON.stringify(st)));
        return { stored: true };
      };

      // 模拟：1 个 Top Frame (0) + 10 个微前端子 frame (frameId: 1 ~ 10)
      // 每个 frame 发送 5 条状态变更快照，总计 55 条并发消息
      const frames = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const sendPromises: Promise<any>[] = [];

      for (const fId of frames) {
        for (let seq = 0; seq < 5; seq++) {
          const uniqueUrl =
            fId === 0
              ? `https://example.com/top?seq=${seq}`
              : `https://example.com/micro-app-${fId}?seq=${seq}`;

          const p = runtime.handleMessage(
            message("framework/state", {
              state: {
                id: `state-f${fId}-${seq}`,
                sessionId: "sess-concurrency",
                capturedAtEpochMs: 1_700_000_000_000 + fId * 1000 + seq,
                trigger: seq === 0 ? "start" : "evidence-tick",
                page: {
                  url: uniqueUrl,
                  title: `Frame ${fId} Seq ${seq}`,
                  frameId: -99, // 假占位值
                },
                tree: { nodeCount: seq },
              },
            }),
            {
              tab: { id: 42 },
              frameId: fId,
              url: uniqueUrl,
            } as any
          );
          sendPromises.push(p);
        }
      }

      // 55 条消息在同一微任务环路中完全并发触发
      const results = await Promise.all(sendPromises);

      // 断言 1：所有并发调用都返回成功
      assert.equal(results.length, 55);
      for (const res of results) {
        assert.equal(res.ok, true);
        assert.equal(res.stored, true);
      }

      // 断言 2：入库总条数严格为 55
      assert.equal(storedStates.length, 55);

      // 断言 3：验证每一条存储记录的 state.page.frameId 与其来源 sender.frameId 严格匹配
      for (const st of storedStates) {
        const idMatch = /^state-f(\d+)-(\d+)$/.exec(st.id);
        assert.ok(idMatch, `State ID 格式正确: ${st.id}`);
        const expectedFrameId = parseInt(idMatch[1], 10);
        assert.equal(
          st.page.frameId,
          expectedFrameId,
          `State ${st.id} 的 frameId (${st.page.frameId}) 必须严格匹配期望的 sender.frameId (${expectedFrameId})，不能存在并发串扰`
        );
      }
    });

    test("2.2 微前端交互与框架状态交替混合并发下，activity-ping 正确派发至 Top Frame", async () => {
      const { runtime, db } = createTestRuntime();
      const session = makeSession({
        id: "sess-mixed-concurrency",
        status: "RECORDING",
      });
      db.sessions.set(session.id, session);
      db.activeSessionId = session.id;

      const topActivityPings: any[] = [];
      const originalTabsSendMessage = (globalThis as any).chrome.tabs
        .sendMessage;
      // 直接拦截全局 chrome.tabs.sendMessage 捕获包含 options 的完整调用
      (globalThis as any).chrome.tabs.sendMessage = async (
        tabId: number,
        msg: any,
        options?: any
      ) => {
        if (msg?.type === "content/activity-ping") {
          topActivityPings.push({ tabId, options, msg });
        }
        return {};
      };

      try {
        const promises: Promise<any>[] = [];

        // 20 个子 frame 并发交替发送 interaction/confirmed 与 framework/state
        for (let i = 1; i <= 20; i++) {
          // 子 frame 交互，应当触发 activity-ping 发送到 frameId: 0
          promises.push(
            runtime.handleMessage(
              message("interaction/confirmed", {
                interaction: {
                  id: `act-${i}`,
                  kind: "click",
                  coordinates: { clientX: 100, clientY: 100 },
                },
              }),
              {
                tab: { id: 42 },
                frameId: i,
                url: `https://sub-${i}.com`,
              } as any
            )
          );

          // 子 frame 框架状态
          promises.push(
            runtime.handleMessage(
              message("framework/state", {
                state: {
                  id: `state-sub-${i}`,
                  sessionId: "sess-mixed-concurrency",
                  capturedAtEpochMs: Date.now(),
                  trigger: "interaction",
                  page: { url: `https://sub-${i}.com`, title: `Sub ${i}` },
                },
              }),
              {
                tab: { id: 42 },
                frameId: i,
                url: `https://sub-${i}.com`,
              } as any
            )
          );
        }

        await Promise.all(promises);

        // 确认 20 个来自子 frame 的 interaction 都向 top frame (frameId: 0) 发送了 activity-ping
        assert.equal(
          topActivityPings.length,
          20,
          "20 个子 iframe 交互均应通过 background 向 top frame (frameId: 0) 触发 activity-ping"
        );
        for (const ping of topActivityPings) {
          assert.equal(ping.tabId, 42);
          assert.equal(
            ping.options?.frameId,
            0,
            "activity-ping 必须精确路由至 frameId: 0"
          );
        }
      } finally {
        (globalThis as any).chrome.tabs.sendMessage = originalTabsSendMessage;
      }
    });
  });

  describe("3. FrameworkStateTab 面板渲染健壮性与无崩溃压测 (Preact Robustness)", () => {
    test("3.1 极端缺失属性、超大 frameId、循环引用及各种边界下的渲染无崩溃", () => {
      // 构造一系列异常与对抗性数据
      const circularObj: any = { name: "circular" };
      circularObj.self = circularObj;

      const adversarialStates: any[] = [
        // 3.1a frameId: 0 (Top Frame)
        {
          id: "state-top-0",
          sessionId: "sess-render",
          trigger: "start",
          capturedAtEpochMs: 1_700_000_000_000,
          page: {
            url: "https://example.com/top",
            title: "Top Frame",
            frameId: 0,
          },
        },
        // 3.1b frameId: undefined (缺失 frameId，应安全归为 Top Frame)
        {
          id: "state-top-undef",
          sessionId: "sess-render",
          trigger: "interaction",
          capturedAtEpochMs: 1_700_000_001_000,
          page: {
            url: "https://example.com/no-frame-id",
            title: "No Frame ID",
            // frameId undefined
          },
        },
        // 3.1c frameId: 999999 (极大值)
        {
          id: "state-huge",
          sessionId: "sess-render",
          trigger: "issue-scene",
          capturedAtEpochMs: 1_700_000_002_000,
          page: {
            url: "https://example.com/huge-frame",
            title: "Huge Frame",
            frameId: 999999,
          },
        },
        // 3.1d frameId: 42 且 url 为空字符串
        {
          id: "state-empty-url",
          sessionId: "sess-render",
          trigger: "resume",
          capturedAtEpochMs: 1_700_000_003_000,
          page: {
            url: "",
            title: "",
            frameId: 42,
          },
        },
        // 3.1e 包含循环引用的 globalState (renderJsonValue 必须优雅 catch)
        {
          id: "state-circular",
          sessionId: "sess-render",
          trigger: "start",
          capturedAtEpochMs: 1_700_000_004_000,
          page: {
            url: "https://example.com/circular",
            title: "Circular",
            frameId: 2,
          },
          globalState: circularObj,
        },
        // 3.1f webStorage 含脱敏标记与部分字段缺失
        {
          id: "state-storage",
          sessionId: "sess-render",
          trigger: "start",
          capturedAtEpochMs: 1_700_000_005_000,
          page: {
            url: "https://example.com/storage",
            title: "Storage",
            frameId: 3,
          },
          webStorage: {
            localStorage: { token: "[REDACTED]" },
            sessionStorage: undefined,
            redactedValues: true,
          },
        },
        // 3.1g 未知 trigger 字符串与特殊字符 url
        {
          id: "state-unknown-trigger",
          sessionId: "sess-render",
          trigger: "non-standard-custom-trigger",
          capturedAtEpochMs: 1_700_000_006_000,
          page: {
            url: "https://example.com/path?foo=bar&test=<script>alert(1)</script>",
            title: "XSS Test",
            frameId: 5,
          },
        },
        // 3.1h 完全无 snapshot, globalState, webStorage 的空状态卡片
        {
          id: "state-empty-content",
          sessionId: "sess-render",
          trigger: "start",
          capturedAtEpochMs: 1_700_000_007_000,
          page: {
            url: "https://example.com/empty",
            title: "Empty Content",
            frameId: 0,
          },
        },
      ];

      // 验证 Preact 渲染不会抛出任何异常
      let html = "";
      assert.doesNotThrow(() => {
        html = render(
          h(FrameworkStateTab, {
            states: adversarialStates,
            startedAtEpochMs: 1_700_000_000_000,
          })
        );
      }, "FrameworkStateTab 在所有对抗性输入下均不得抛出渲染错误");

      // 验证生成的 HTML 关键结构
      assert.ok(html.includes("Top Frame"), "应当包含 Top Frame");
      assert.ok(html.includes("Frame [999999]"), "应当包含 Frame [999999]");
      assert.ok(html.includes("badge-topframe"), "应当包含 badge-topframe");
      assert.ok(html.includes("badge-subframe"), "应当包含 badge-subframe");
      assert.ok(html.includes("Frame [42]"), "应当包含 Frame [42]");
      assert.ok(
        html.includes("non-standard-custom-trigger"),
        "应当容错未知 trigger"
      );
      assert.ok(
        html.includes("[object Object]"),
        "循环引用 JSON.stringify 降级为 String(value) 输出"
      );
    });

    test("3.2 15 个多微前端混合帧的 Badge 数量与样式精准分类", () => {
      const mixedStates: any[] = [];
      // 5 个 Top Frame (frameId: 0 或者 undefined)
      mixedStates.push(
        {
          id: "m-0",
          capturedAtEpochMs: 1000,
          trigger: "start",
          page: { frameId: 0, url: "http://top.com" },
        },
        {
          id: "m-1",
          capturedAtEpochMs: 2000,
          trigger: "start",
          page: { frameId: 0, url: "http://top.com" },
        },
        {
          id: "m-2",
          capturedAtEpochMs: 3000,
          trigger: "start",
          page: { frameId: 0, url: "http://top.com" },
        },
        {
          id: "m-3",
          capturedAtEpochMs: 4000,
          trigger: "start",
          page: { url: "http://top.com" },
        }, // frameId undefined
        {
          id: "m-4",
          capturedAtEpochMs: 5000,
          trigger: "start",
          page: { url: "http://top.com" },
        } // frameId undefined
      );

      // 10 个子 Frame (不同 frameId)
      const subFrameIds = [1, 2, 3, 7, 10, 42, 100, 9999, 88888, 999999];
      for (let i = 0; i < subFrameIds.length; i++) {
        mixedStates.push({
          id: `m-sub-${i}`,
          capturedAtEpochMs: 6000 + i * 1000,
          trigger: "evidence-tick",
          page: {
            frameId: subFrameIds[i],
            url: `http://sub-${subFrameIds[i]}.com`,
          },
        });
      }

      const html = render(
        h(FrameworkStateTab, {
          states: mixedStates,
          startedAtEpochMs: 1000,
        })
      );

      // 统计 badge-topframe 出现次数
      const topFrameBadges = (html.match(/badge-topframe/g) || []).length;
      assert.equal(topFrameBadges, 5, "恰好 5 个状态应当带有 badge-topframe");

      // 统计 badge-subframe 出现次数
      const subFrameBadges = (html.match(/badge-subframe/g) || []).length;
      assert.equal(subFrameBadges, 10, "恰好 10 个状态应当带有 badge-subframe");

      // 验证每个 subFrameId 都在文本中存在
      for (const fId of subFrameIds) {
        assert.ok(
          html.includes(`Frame [${fId}]`),
          `必须呈现 Frame [${fId}] 徽章文本`
        );
      }
    });

    test("3.3 空状态与边界保护 (null, undefined, [])", () => {
      // 空数组
      const htmlEmpty = render(h(FrameworkStateTab, { states: [] }));
      assert.ok(htmlEmpty.includes("framework-state-empty"));

      // undefined / null states
      const htmlUndef = render(
        h(FrameworkStateTab, { states: undefined as any })
      );
      assert.ok(htmlUndef.includes("framework-state-empty"));

      const htmlNull = render(h(FrameworkStateTab, { states: null as any }));
      assert.ok(htmlNull.includes("framework-state-empty"));
    });
  });

  describe("4. captureFrameworkState 采集层与探测判据对抗验证", () => {
    test("4.1 captureFrameworkState 正确传递与记录 frameId", () => {
      const state0 = captureFrameworkState({
        sessionId: "sess-cap",
        trigger: "start",
        privacyMode: "safe",
        frameId: 0,
      });
      assert.equal(state0.page.frameId, 0, "frameId: 0 必须准确记录");

      const stateHuge = captureFrameworkState({
        sessionId: "sess-cap",
        trigger: "start",
        privacyMode: "safe",
        frameId: 999999,
      });
      assert.equal(
        stateHuge.page.frameId,
        999999,
        "frameId: 999999 必须准确记录"
      );

      // 未显式指定 frameId 时，Node 环境无 window，安全回退到占位值 -1
      const stateDefault = captureFrameworkState({
        sessionId: "sess-cap",
        trigger: "start",
        privacyMode: "safe",
      });
      assert.equal(
        stateDefault.page.frameId,
        -1,
        "无 window 环境下安全降级为 -1，等待 Background 权威覆写"
      );
    });

    test("4.2 isMeaningfulFrameworkState 对边界快照的判定准确性", () => {
      // 只有 page 的空快照
      const emptyState = captureFrameworkState({
        sessionId: "sess-empty",
        trigger: "start",
        privacyMode: "safe",
        frameId: 4,
      });
      emptyState.snapshot = undefined;
      emptyState.globalState = undefined;
      emptyState.webStorage = undefined;

      // 无 snapshot、无 globalState、无 webStorage -> 非 meaningful
      assert.equal(
        isMeaningfulFrameworkState(emptyState),
        false,
        "空快照不能被判定为 meaningful"
      );

      // 带有 rootComponent 的快照 -> meaningful
      emptyState.snapshot = {
        rootComponent: { name: "RootComponent" } as any,
        parentChain: [],
      };
      assert.equal(
        isMeaningfulFrameworkState(emptyState),
        true,
        "含有 rootComponent 的快照应判定为 meaningful"
      );

      // 仅带有 webStorage 的快照 -> meaningful
      const storageState = captureFrameworkState({
        sessionId: "sess-storage",
        trigger: "start",
        privacyMode: "safe",
        frameId: 4,
      });
      storageState.snapshot = undefined;
      storageState.globalState = undefined;
      storageState.webStorage = {
        localStorage: { theme: "dark" },
        redactedValues: false,
      };
      assert.equal(
        isMeaningfulFrameworkState(storageState),
        true,
        "含有 localStorage 的快照应判定为 meaningful"
      );
    });
  });
});
