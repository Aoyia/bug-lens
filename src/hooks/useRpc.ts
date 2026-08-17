import { useCallback } from "preact/hooks";
import {
  message,
  type RuntimeMessage,
  type RuntimeMessageResponseMap,
} from "../shared/protocol.ts";
import { t } from "../shared/i18n.ts";

type MessageOf<T extends RuntimeMessage["type"]> = Extract<
  RuntimeMessage,
  { type: T }
>;

export type RpcOk<T> = { ok: true; data: T };
export type RpcErr = { ok: false; error: string };
export type RpcResult<T> = RpcOk<T> | RpcErr;

/**
 * 基于 chrome.runtime.sendMessage 的类型安全 RPC 封装。
 *
 * 消除以下重复样板代码：
 *   const result = await chrome.runtime.sendMessage(message("session/stop", {...}));
 *   if (!result.ok) ...
 *
 * 用法：
 *   const { send } = useRpc();
 *   const result = await send("session/stop", { commandId: crypto.randomUUID() });
 *   if (!result.ok) setErrorText(result.error);
 */
export function useRpc() {
  const send = useCallback(
    async <T extends RuntimeMessage["type"]>(
      type: T,
      payload: MessageOf<T>["payload"],
      sessionId?: string
    ): Promise<RpcResult<RuntimeMessageResponseMap[T]>> => {
      try {
        // 统一发往 background：所有 RPC 的固定收件人
        const response: unknown = await chrome.runtime.sendMessage(
          message(type, payload, sessionId, "background")
        );
        // background 返回的 { ok:false, error } 信封 → 归约为 RpcErr
        if (
          response &&
          typeof response === "object" &&
          "ok" in response &&
          !(response as { ok: boolean }).ok
        ) {
          const errorVal = (response as { error?: unknown }).error;
          return {
            ok: false,
            error: typeof errorVal === "string" ? errorVal : t("unknownError"),
          };
        }
        return { ok: true, data: response as RuntimeMessageResponseMap[T] };
      } catch (err) {
        // 通道异常（如扩展被重载）同样归约为失败结果，调用方无需自行 try/catch
        return { ok: false, error: String(err) };
      }
    },
    []
  );

  return { send };
}
