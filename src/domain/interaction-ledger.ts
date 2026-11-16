import type { InteractionRecord } from "../shared/protocol";

export type InteractionEvent =
  | { type: "candidate"; interaction: InteractionRecord }
  | { type: "confirmed"; interaction: InteractionRecord }
  | { type: "cancelled"; interaction?: InteractionRecord }
  | {
      type: "screenshot-captured";
      assetId?: string;
      dataUrl?: string;
      source: "primary" | "fallback" | "video-frame";
    }
  | {
      type: "settled-captured";
      settledAssetId: string;
      settledDurationMs: number;
    }
  | { type: "screenshot-unavailable"; issue: string };

export function applyInteractionEvent(
  current: InteractionRecord | undefined,
  event: InteractionEvent
): InteractionRecord | undefined {
  switch (event.type) {
    case "candidate":
      return current ?? event.interaction;

    case "confirmed":
      if (current?.status === "cancelled") return current;
      return {
        ...event.interaction,
        screenshot: current?.screenshot ?? event.interaction.screenshot,
      };

    case "cancelled":
      if (!current)
        return event.interaction
          ? { ...event.interaction, status: "cancelled" }
          : undefined;
      if (current.status === "confirmed" || current.status === "cancelled")
        return current;
      return { ...current, status: "cancelled" };

    case "screenshot-captured":
      if (!current || current.status === "cancelled") return current;
      return {
        ...current,
        screenshot: {
          status: "captured",
          source: event.source,
          ...(event.assetId ? { assetId: event.assetId } : {}),
          ...(event.dataUrl ? { dataUrl: event.dataUrl } : {}),
          ...(current.screenshot?.settledAssetId
            ? { settledAssetId: current.screenshot.settledAssetId }
            : {}),
          ...(current.screenshot?.settledDurationMs !== undefined
            ? { settledDurationMs: current.screenshot.settledDurationMs }
            : {}),
        },
      };

    case "settled-captured":
      if (!current || current.status === "cancelled") return current;
      if (current.screenshot?.status !== "captured") return current;
      return {
        ...current,
        screenshot: {
          ...current.screenshot,
          settledAssetId: event.settledAssetId,
          settledDurationMs: event.settledDurationMs,
        },
      };

    case "screenshot-unavailable":
      if (!current || current.status === "cancelled") return current;
      if (current.screenshot?.status === "captured") return current;
      return {
        ...current,
        screenshot: { status: "unavailable", issue: event.issue },
      };
  }
}
