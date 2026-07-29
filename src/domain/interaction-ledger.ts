import type { InteractionRecord } from "../shared/protocol";

export type InteractionEvent =
  | { type: "candidate"; interaction: InteractionRecord }
  | { type: "confirmed"; interaction: InteractionRecord }
  | { type: "cancelled"; interaction?: InteractionRecord }
  | { type: "screenshot-captured"; dataUrl: string; source: "primary" | "video-frame" }
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
        screenshot: current?.screenshot ?? event.interaction.screenshot
      };

    case "cancelled":
      if (!current) return event.interaction ? { ...event.interaction, status: "cancelled" } : undefined;
      if (current.status === "confirmed" || current.status === "cancelled") return current;
      return { ...current, status: "cancelled" };

    case "screenshot-captured":
      if (!current || current.status === "cancelled") return current;
      return {
        ...current,
        screenshot: {
          status: "captured",
          source: event.source,
          dataUrl: event.dataUrl
        }
      };

    case "screenshot-unavailable":
      if (!current || current.status === "cancelled") return current;
      return {
        ...current,
        screenshot: { status: "unavailable", issue: event.issue }
      };
  }
}
