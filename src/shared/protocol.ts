export const PROTOCOL_VERSION = 1 as const;

export type SessionStatus =
  | "IDLE"
  | "PREPARING"
  | "RECORDING"
  | "DEGRADED"
  | "STOPPING"
  | "PREVIEW_READY"
  | "EXPORTING"
  | "EXPORTED"
  | "FAILED";

export type CaptureIssue = {
  code: string;
  message: string;
  source: "media" | "debugger" | "interaction" | "screenshot" | "storage" | "export";
  recoverable: boolean;
  occurredAt: number;
};

export type RecordingOptions = {
  captureAudio: boolean;
  privacyMode: "safe" | "raw";
  mediaTimesliceMs: number;
};

export type QualitySummary = {
  overall: "complete" | "partial" | "failed";
  interactionCount: number;
  confirmedInteractionCount: number;
  primaryScreenshotCount: number;
  fallbackScreenshotCount: number;
  unavailableScreenshotCount: number;
  consoleEntryCount: number;
  networkEntryCount: number;
  issues: CaptureIssue[];
};

export type RecordingSession = {
  id: string;
  schemaVersion: 1;
  extensionVersion: string;
  status: SessionStatus;
  target: { tabId: number; windowId?: number; initialUrl: string; initialTitle: string };
  options: RecordingOptions;
  timeline: { createdAtEpochMs: number; startedAtEpochMs?: number; stoppedAtEpochMs?: number; durationMs?: number };
  quality: QualitySummary;
  nonce: string;
  error?: CaptureIssue;
};

export type ElementDescriptor = {
  tagName: string;
  id?: string;
  classNames: string[];
  attributes: Record<string, string>;
  text?: string;
  role?: string;
  accessibleName?: string;
  boundingBox: { x: number; y: number; width: number; height: number };
  locators: Array<{ kind: string; expression: string; matchCount: number; stabilityScore: number; reasons: string[] }>;
};

export type InteractionRecord = {
  id: string;
  sessionId: string;
  kind: "click";
  status: "candidate" | "confirmed" | "cancelled";
  createdAt: number;
  confirmedAt?: number;
  page: { url: string; title: string; frameId: number };
  input: { pointerType: string; button: number; isTrusted: boolean };
  coordinates: { clientX: number; clientY: number; pageX: number; pageY: number; scrollX: number; scrollY: number; devicePixelRatio: number; viewport: { width: number; height: number } };
  element: ElementDescriptor;
  screenshot: { status: "pending" | "captured" | "unavailable"; source?: "primary" | "video-frame"; dataUrl?: string; issue?: string };
};

export type ConsoleEntry = { id: string; sessionId: string; createdAt: number; level: string; text: string; source?: string };
export type NetworkEntry = { id: string; sessionId: string; createdAt: number; url: string; method: string; status?: number; type?: string; durationMs?: number; error?: string };
export type ExportSelection = { sessionId: string; excludedInteractionIds: string[]; updatedAtEpochMs: number };

export type Envelope<T extends string, P = unknown> = { protocolVersion: 1; messageId: string; type: T; sentAt: number; sessionId?: string; payload: P };
export type RuntimeMessage =
  | Envelope<"session/start", { tabId: number; options: RecordingOptions; commandId: string; streamId?: string }>
  | Envelope<"session/stop", { commandId: string }>
  | Envelope<"session/status", { session?: RecordingSession }>
  | Envelope<"session/open-preview", { sessionId: string }>
  | Envelope<"interaction/candidate", { interaction: InteractionRecord }>
  | Envelope<"interaction/confirmed", { interaction: InteractionRecord }>
  | Envelope<"interaction/cancelled", { interactionId: string }>
  | Envelope<"content/hello", { url: string; title: string }>
  | Envelope<"offscreen/start-media", { streamId: string; sessionId: string; captureAudio: boolean; timesliceMs: number }>
  | Envelope<"offscreen/stop-media", { sessionId: string }>
  | Envelope<"offscreen/annotate-image", { dataUrl: string; clientX: number; clientY: number; viewportWidth: number; viewportHeight: number }>
  | Envelope<"offscreen/media-chunk", { sessionId: string; chunk: ArrayBuffer; sequence: number; mimeType: string; recordedAt: number }>
  | Envelope<"offscreen/media-state", { sessionId: string; state: "started" | "stopped" | "error"; error?: string }>;

export function message<T extends RuntimeMessage["type"], P>(type: T, payload: P, sessionId?: string): Envelope<T, P> {
  return { protocolVersion: PROTOCOL_VERSION, messageId: crypto.randomUUID(), type, sentAt: Date.now(), sessionId, payload } as Envelope<T, P>;
}

export function isEnvelope(value: unknown): value is RuntimeMessage {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return candidate.protocolVersion === PROTOCOL_VERSION && typeof candidate.type === "string" && typeof candidate.messageId === "string";
}

export function uuid(): string { return crypto.randomUUID(); }
