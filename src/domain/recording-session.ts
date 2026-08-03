import type {
  CaptureIssue,
  QualitySummary,
  RecordingSession,
} from "../shared/protocol";

type QualityCounters = Pick<
  QualitySummary,
  | "interactionCount"
  | "confirmedInteractionCount"
  | "primaryScreenshotCount"
  | "fallbackScreenshotCount"
  | "unavailableScreenshotCount"
  | "issueSceneCount"
  | "partialIssueSceneCount"
  | "consoleEntryCount"
  | "networkEntryCount"
>;

export type RecordingSessionEvent =
  | { type: "started"; atEpochMs: number; issues?: CaptureIssue[] }
  | { type: "capture-issue"; issue: CaptureIssue }
  | { type: "quality-delta"; delta: Partial<QualityCounters> }
  | { type: "quality-snapshot"; counts: QualityCounters }
  | { type: "stop-requested"; atEpochMs: number; commandId?: string }
  | { type: "stop-completed"; atEpochMs?: number; issue?: CaptureIssue }
  | { type: "recover"; atEpochMs: number; issue: CaptureIssue }
  | { type: "failed"; issue: CaptureIssue };

const ACTIVE_STATUSES = new Set<RecordingSession["status"]>([
  "PREPARING",
  "RECORDING",
  "DEGRADED",
  "STOPPING",
]);

function appendIssue(
  quality: QualitySummary,
  nextIssue: CaptureIssue
): QualitySummary {
  const duplicate = quality.issues.some(
    (item) => item.code === nextIssue.code && item.message === nextIssue.message
  );
  return {
    ...quality,
    overall: "partial",
    issues: duplicate ? quality.issues : [...quality.issues, nextIssue],
  };
}

function stoppedTimeline(
  session: RecordingSession,
  stoppedAtEpochMs: number
): RecordingSession["timeline"] {
  const startedAt =
    session.timeline.startedAtEpochMs ?? session.timeline.createdAtEpochMs;
  return {
    ...session.timeline,
    stoppedAtEpochMs,
    durationMs: Math.max(0, stoppedAtEpochMs - startedAt),
  };
}

export function applySessionEvent(
  session: RecordingSession,
  event: RecordingSessionEvent
): RecordingSession {
  switch (event.type) {
    case "started": {
      if (session.status !== "PREPARING" && session.status !== "DEGRADED")
        return session;
      const quality = (event.issues ?? []).reduce(appendIssue, session.quality);
      const degraded =
        session.status === "DEGRADED" || quality.issues.length > 0;
      return {
        ...session,
        status: degraded ? "DEGRADED" : "RECORDING",
        timeline: {
          ...session.timeline,
          startedAtEpochMs:
            session.timeline.startedAtEpochMs ?? event.atEpochMs,
        },
        quality,
      };
    }

    case "capture-issue":
      if (!ACTIVE_STATUSES.has(session.status)) return session;
      return {
        ...session,
        status:
          session.status === "PREPARING" || session.status === "RECORDING"
            ? "DEGRADED"
            : session.status,
        quality: appendIssue(session.quality, event.issue),
      };

    case "quality-delta": {
      if (!ACTIVE_STATUSES.has(session.status)) return session;
      const quality = { ...session.quality };
      for (const [key, delta] of Object.entries(event.delta) as Array<
        [keyof QualityCounters, number | undefined]
      >) {
        if (delta != null)
          quality[key] = Math.max(0, (quality[key] ?? 0) + delta);
      }
      return { ...session, quality };
    }

    case "quality-snapshot":
      if (!ACTIVE_STATUSES.has(session.status)) return session;
      return { ...session, quality: { ...session.quality, ...event.counts } };

    case "stop-requested":
      if (session.status === "STOPPING") {
        if (!event.commandId || session.commandIds?.stop === event.commandId)
          return session;
        if (session.commandIds?.stop) return session;
        return {
          ...session,
          commandIds: session.commandIds
            ? { ...session.commandIds, stop: event.commandId }
            : undefined,
        };
      }
      if (!ACTIVE_STATUSES.has(session.status)) return session;
      return {
        ...session,
        status: "STOPPING",
        timeline: {
          ...session.timeline,
          stoppedAtEpochMs: event.atEpochMs,
        },
        commandIds: session.commandIds
          ? {
              ...session.commandIds,
              stop: event.commandId ?? session.commandIds.stop,
            }
          : undefined,
      };

    case "stop-completed": {
      if (!ACTIVE_STATUSES.has(session.status)) return session;
      const stoppedAt =
        event.atEpochMs ?? session.timeline.stoppedAtEpochMs ?? Date.now();
      return {
        ...session,
        status: "PREVIEW_READY",
        timeline: stoppedTimeline(session, stoppedAt),
        quality: event.issue
          ? appendIssue(session.quality, event.issue)
          : session.quality,
      };
    }

    case "recover":
      if (!ACTIVE_STATUSES.has(session.status)) return session;
      return {
        ...session,
        status: "PREVIEW_READY",
        timeline: stoppedTimeline(session, event.atEpochMs),
        quality: appendIssue(session.quality, event.issue),
      };

    case "failed":
      if (!ACTIVE_STATUSES.has(session.status)) return session;
      return {
        ...session,
        status: "FAILED",
        error: event.issue,
        quality: {
          ...appendIssue(session.quality, event.issue),
          overall: "failed",
        },
      };
  }
}
