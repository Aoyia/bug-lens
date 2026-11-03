import { formatInteractionLine } from "../format/element.ts";
import { formatDuration, formatRelativeTime } from "../format/time.ts";
import type { LoadedSessionPack } from "../pack/session-pack.ts";

export type TimelineEventKind = "interaction" | "console" | "network" | "scene";

export interface TimelineEventItem {
  kind: TimelineEventKind;
  epochMs: number;
  relativeMs: number;
  summary: string;
  refId?: string | number;
}

export interface TimelineQueryOptions {
  aroundSceneId?: string;
  fromMs?: number;
  toMs?: number;
  windowMs?: number;
  kinds?: TimelineEventKind[];
  includeAllConsole?: boolean;
  includeAllNetwork?: boolean;
  limit?: number;
}

export function queryTimeline(
  pack: LoadedSessionPack,
  options: TimelineQueryOptions = {}
): {
  windowDescription: string;
  totalMatched: number;
  events: TimelineEventItem[];
} {
  const allowedKinds = new Set<TimelineEventKind>(
    options.kinds && options.kinds.length > 0
      ? options.kinds
      : ["interaction", "console", "network", "scene"]
  );

  let fromRelMs = options.fromMs;
  let toRelMs = options.toMs;
  let windowDescription = "Full session timeline";

  if (
    options.aroundSceneId !== undefined ||
    (fromRelMs === undefined &&
      toRelMs === undefined &&
      options.windowMs !== undefined)
  ) {
    const scenes = pack.getIssueScenes();
    const targetScene = options.aroundSceneId
      ? (scenes.find(
          (s) =>
            s.id === options.aroundSceneId ||
            String(s.index) === options.aroundSceneId
        ) ?? scenes[0])
      : scenes[0];

    if (targetScene) {
      const anchorEpoch =
        targetScene.scene.selectionStartedAtEpochMs ??
        targetScene.scene.observedAtEpochMs ??
        targetScene.scene.sequenceContext?.anchorEpochMs;
      const anchorRel = pack.toRelativeMs(anchorEpoch);
      if (anchorRel !== undefined) {
        const win = options.windowMs ?? 15000;
        fromRelMs = anchorRel - win;
        toRelMs = anchorRel + Math.min(5000, Math.floor(win / 3));
        windowDescription = `Around scene "${targetScene.id}" (${formatRelativeTime(fromRelMs)} .. ${formatRelativeTime(toRelMs)})`;
      }
    }
  } else if (fromRelMs !== undefined || toRelMs !== undefined) {
    windowDescription = `Range ${formatRelativeTime(fromRelMs ?? 0)} .. ${formatRelativeTime(toRelMs ?? Infinity)}`;
  }

  const events: TimelineEventItem[] = [];

  if (allowedKinds.has("interaction")) {
    const interactions = pack.getInteractions();
    interactions.forEach((item, idx) => {
      const rel = pack.toRelativeMs(item.createdAt) ?? item.elapsedMs ?? 0;
      const epoch = item.createdAt ?? pack.toEpochMs(rel);
      events.push({
        kind: "interaction",
        epochMs: epoch,
        relativeMs: rel,
        refId: idx,
        summary: formatInteractionLine(item, idx, rel),
      });
    });
  }

  if (allowedKinds.has("console")) {
    const logs = pack.getConsoleEntries();
    logs.forEach((log, idx) => {
      const level = (log.level ?? "log").toLowerCase();
      if (
        !options.includeAllConsole &&
        level !== "error" &&
        level !== "warning" &&
        level !== "warn"
      ) {
        return;
      }
      const rel = pack.toRelativeMs(log.createdAt) ?? 0;
      const epoch = log.createdAt ?? pack.toEpochMs(rel);
      const text = (log.text ?? "").replace(/\s+/g, " ").trim().slice(0, 140);
      events.push({
        kind: "console",
        epochMs: epoch,
        relativeMs: rel,
        refId: log.id ?? idx,
        summary: `${formatRelativeTime(rel)} [console.${level}] ${text}`,
      });
    });
  }

  if (allowedKinds.has("network")) {
    const netEntries = pack.getNetworkEntries();
    netEntries.forEach((entry) => {
      const status = entry.status ?? 0;
      const isFailure =
        status === 0 || status >= 400 || Boolean(entry.errorText);
      const type = (entry.type ?? "").toLowerCase();
      const isApiCall =
        type === "xhr" || type === "fetch" || type === "document";
      if (!options.includeAllNetwork && !isFailure && !isApiCall) {
        return;
      }
      const rel = pack.toRelativeMs(entry.createdAt) ?? 0;
      const epoch = entry.createdAt ?? pack.toEpochMs(rel);
      const method = entry.method ?? "GET";
      const dur = formatDuration(entry.durationMs);
      const statusTag = isFailure ? `!${status || "ERR"}` : String(status);
      events.push({
        kind: "network",
        epochMs: epoch,
        relativeMs: rel,
        refId: entry.id,
        summary: `${formatRelativeTime(rel)} [net ${method} ${statusTag} ${dur}] ${entry.url} (id=${entry.id})`,
      });
    });
  }

  if (allowedKinds.has("scene")) {
    for (const s of pack.getIssueScenes()) {
      const epoch =
        s.scene.selectionStartedAtEpochMs ?? s.scene.observedAtEpochMs;
      const rel = pack.toRelativeMs(epoch) ?? 0;
      const actual = s.scene.narrative?.actual ?? "(no narrative)";
      events.push({
        kind: "scene",
        epochMs: epoch ?? pack.toEpochMs(rel),
        relativeMs: rel,
        refId: s.id,
        summary: `${formatRelativeTime(rel)} [ISSUE SCENE ${s.id}] actual="${actual}"`,
      });
    }
  }

  const filtered = events
    .filter((ev) => {
      if (fromRelMs !== undefined && ev.relativeMs < fromRelMs) return false;
      if (toRelMs !== undefined && ev.relativeMs > toRelMs) return false;
      return true;
    })
    .sort((a, b) => a.relativeMs - b.relativeMs);

  const limit = options.limit ?? 80;
  return {
    windowDescription,
    totalMatched: filtered.length,
    events: filtered.slice(0, limit),
  };
}
