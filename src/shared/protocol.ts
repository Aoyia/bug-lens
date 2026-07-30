export const PROTOCOL_VERSION = 2 as const;
export const EXPORT_FORMAT_VERSION = "2.0" as const;

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
  source: "media" | "debugger" | "interaction" | "screenshot" | "storage" | "export" | "migration";
  recoverable: boolean;
  occurredAt: number;
};

export type RecordingOptions = {
  captureAudio: boolean;
  captureVideo: boolean;
  captureScreenshots: boolean;
  captureConsole: boolean;
  captureNetwork: boolean;
  captureNetworkBodies: boolean;
  privacyMode: "safe" | "raw";
  mediaTimesliceMs: number;
  maxResponseBodyBytes: number;
  maxSessionBytes: number;
};

export type StoragePolicy = {
  retentionDays: number;
  maxSessionBytes: number;
  maxResponseBodyBytes: number;
  compression: "balanced" | "quality" | "small";
};

export type SessionStorage = {
  usedBytes: number;
  limitReached?: boolean;
};

export type EvidenceKind = "video" | "screenshots" | "console" | "network" | "networkBodies" | "audio";
export type EvidenceState = "captured" | "partial" | "failed" | "redacted" | "disabled" | "pending";
export type EvidenceSummary = {
  kind: EvidenceKind;
  state: EvidenceState;
  count: number;
  sizeBytes: number;
  detail: string;
};
export type SessionOverview = {
  session: RecordingSession;
  evidence: EvidenceSummary[];
  sizeBytes: number;
  expiresAtEpochMs: number;
};
export type StorageOverview = {
  usedBytes: number;
  quotaBytes: number;
  sessionCount: number;
  policy: StoragePolicy;
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
  schemaVersion: 1 | 2;
  extensionVersion: string;
  status: SessionStatus;
  target: { tabId: number; windowId?: number; initialUrl: string; initialTitle: string };
  options: RecordingOptions;
  timeline: { createdAtEpochMs: number; startedAtEpochMs?: number; stoppedAtEpochMs?: number; durationMs?: number };
  quality: QualitySummary;
  nonce: string;
  commandIds?: { start: string; stop?: string };
  browserEpoch?: string;
  previewPending?: boolean;
  resumedFromSessionId?: string;
  storage?: SessionStorage;
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
  screenshot: { status: "pending" | "captured" | "unavailable" | "disabled"; source?: "primary" | "video-frame"; dataUrl?: string; issue?: string };
};

export type ConsoleEntry = { id: string; sessionId: string; createdAt: number; level: string; text: string; source?: string };
export type NetworkEntry = {
  id: string;
  sessionId: string;
  createdAt: number;
  url: string;
  method: string;
  status?: number;
  type?: string;
  durationMs?: number;
  startedAtMonotonicMs?: number;
  error?: string;
  requestHeaders?: Record<string, string>;
  requestBody?: string;
  response?: {
    mimeType?: string;
    headers?: Record<string, string>;
    bodyStatus: "pending" | "captured" | "redacted" | "not-present" | "unavailable";
    body?: string;
    base64Encoded?: boolean;
    byteLength?: number;
    redactionReason?: "binary-body";
    truncated?: boolean;
    originalByteLength?: number;
    capturedByteLength?: number;
    error?: string;
  };
};
export type ExportSelection = {
  sessionId: string;
  excludedInteractionIds: string[];
  excludedConsoleEntryIds?: string[];
  excludedNetworkEntryIds?: string[];
  updatedAtEpochMs: number;
};
export type ExportArtifact = {
  sessionId: string;
  downloadId: number;
  state: "in_progress" | "complete" | "interrupted" | "cancelled";
  filename?: string;
  error?: string;
  updatedAtEpochMs: number;
};

export type ExportManifest = {
  format: typeof EXPORT_FORMAT_VERSION;
  schemaVersion: number;
  createdAtEpochMs: number;
  sessionId: string;
  files: Record<string, { byteLength: number; sha256: string }>;
  migration: { currentSchemaVersion: number; supportedFrom: number[] };
};

export type Envelope<T extends string, P = unknown> = { protocolVersion: typeof PROTOCOL_VERSION; messageId: string; type: T; sentAt: number; sessionId?: string; payload: P };
export type RuntimeMessage =
  | Envelope<"session/start", { tabId: number; options: RecordingOptions; commandId: string; streamId?: string; resumedFromSessionId?: string }>
  | Envelope<"session/stop", { commandId: string }>
  | Envelope<"session/status", { session?: RecordingSession }>
  | Envelope<"session/list", { query?: string }>
  | Envelope<"session/delete", { sessionId: string }>
  | Envelope<"session/open-preview", { sessionId: string }>
  | Envelope<"session/resume", { sessionId: string; commandId: string }>
  | Envelope<"storage/get", Record<string, never>>
  | Envelope<"storage/update", { policy: Partial<StoragePolicy> }>
  | Envelope<"storage/cleanup", Record<string, never>>
  | Envelope<"interaction/candidate", { interaction: InteractionRecord }>
  | Envelope<"interaction/confirmed", { interaction: InteractionRecord }>
  | Envelope<"interaction/cancelled", { interactionId: string; interaction?: InteractionRecord }>
  | Envelope<"content/hello", { url: string; title: string }>
  | Envelope<"content/reset", Record<string, never>>
  | Envelope<"offscreen/start-media", { streamId: string; sessionId: string; captureAudio: boolean; timesliceMs: number }>
  | Envelope<"offscreen/stop-media", { sessionId: string }>
  | Envelope<"offscreen/status", { sessionId: string }>
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
