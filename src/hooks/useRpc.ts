import { useCallback } from "preact/hooks";
import {
  message,
  type RuntimeMessage,
  type RuntimeMessageResponseMap,
} from "../shared/protocol.ts";

type MessageOf<T extends RuntimeMessage["type"]> = Extract<
  RuntimeMessage,
  { type: T }
>;

export type RpcOk<T> = { ok: true; data: T };
export type RpcErr = { ok: false; error: string };
export type RpcResult<T> = RpcOk<T> | RpcErr;

/**
 * Type-safe RPC wrapper over chrome.runtime.sendMessage.
 *
 * Eliminates the repetitive pattern of:
 *   `await chrome.runtime.sendMessage(message(type, payload))` + error handling
 *
 * Usage:
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
        const response: unknown = await chrome.runtime.sendMessage(
          message(type, payload, sessionId, "background")
        );
        if (
          response &&
          typeof response === "object" &&
          "ok" in response &&
          !(response as { ok: boolean }).ok
        ) {
          const errorVal = (response as { error?: unknown }).error;
          return {
            ok: false,
            error: typeof errorVal === "string" ? errorVal : "Unknown error",
          };
        }
        return { ok: true, data: response as RuntimeMessageResponseMap[T] };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
    []
  );

  return { send };
}
