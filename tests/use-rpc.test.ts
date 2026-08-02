import assert from "node:assert/strict";
import test from "node:test";
import { h } from "preact";
import render from "preact-render-to-string";
import { useRpc } from "../src/hooks/useRpc.ts";
import type { RecordingSession, SessionOverview, StorageOverview } from "../src/shared/protocol.ts";

type Expect<T extends true> = T;
type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false;

// 静态类型推断验证函数（编译期检查）
async function _typeCheckAssertions() {
  const { send } = useRpc();

  // 1. session/status
  const statusRes = await send("session/status", {});
  if (statusRes.ok) {
    type _T1 = Expect<Equal<typeof statusRes.data, { ok: true; session?: RecordingSession }>>;
  }

  // 2. session/start
  const startRes = await send("session/start", { tabId: 1, options: {} as any, commandId: "cmd" });
  if (startRes.ok) {
    type _T2 = Expect<Equal<typeof startRes.data, { ok: true; session: RecordingSession }>>;
  }

  // 3. session/list
  const listRes = await send("session/list", { query: "" });
  if (listRes.ok) {
    type _T3 = Expect<Equal<typeof listRes.data, { ok: true; sessions: SessionOverview[] }>>;
  }

  // 4. storage/get
  const storageRes = await send("storage/get", {});
  if (storageRes.ok) {
    type _T4 = Expect<Equal<typeof storageRes.data, { ok: true; storage: StorageOverview }>>;
  }

  // 5. session/delete
  const deleteRes = await send("session/delete", { sessionId: "s1" });
  if (deleteRes.ok) {
    type _T5 = Expect<Equal<typeof deleteRes.data, { ok: true; deleted: boolean }>>;
  }
}

function renderRpcHook(callback: (rpc: ReturnType<typeof useRpc>) => void) {
  function Component() {
    const rpc = useRpc();
    callback(rpc);
    return h("div", null);
  }
  render(h(Component, null));
}

test("useRpc - chrome.runtime.sendMessage 正常返回成功响应", async () => {
  const mockSession = { id: "test-session-1", status: "RECORDING" } as RecordingSession;
  (globalThis as any).chrome = {
    runtime: {
      sendMessage: async (msg: any) => {
        assert.equal(msg.type, "session/status");
        return { ok: true, session: mockSession };
      }
    }
  };

  let rpcInstance!: ReturnType<typeof useRpc>;
  renderRpcHook((rpc) => { rpcInstance = rpc; });

  const res = await rpcInstance.send("session/status", {});
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.deepEqual(res.data, { ok: true, session: mockSession });
  }
});

test("useRpc - background 返回 { ok: false, error: '...' }", async () => {
  (globalThis as any).chrome = {
    runtime: {
      sendMessage: async () => {
        return { ok: false, error: "Session limit exceeded" };
      }
    }
  };

  let rpcInstance!: ReturnType<typeof useRpc>;
  renderRpcHook((rpc) => { rpcInstance = rpc; });

  const res = await rpcInstance.send("session/start", { tabId: 1, options: {} as any, commandId: "c1" });
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.error, "Session limit exceeded");
  }
});

test("useRpc - sendMessage 抛出异常", async () => {
  (globalThis as any).chrome = {
    runtime: {
      sendMessage: async () => {
        throw new Error("Extension context invalidated");
      }
    }
  };

  let rpcInstance!: ReturnType<typeof useRpc>;
  renderRpcHook((rpc) => { rpcInstance = rpc; });

  const res = await rpcInstance.send("storage/get", {});
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.error, "Error: Extension context invalidated");
  }
});
