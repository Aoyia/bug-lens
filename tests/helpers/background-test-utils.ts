import assert from "node:assert/strict";
import type { RecordingSession } from "../src/shared/protocol.ts";

/** 会话工厂：构造一个可用的 RecordingSession（默认 RECORDING 状态）。 */
export function makeSession(
  overrides: Partial<RecordingSession> = {}
): RecordingSession {
  const base: RecordingSession = {
    id: "sess-1",
    schemaVersion: 2,
    extensionVersion: "0.6.0",
    status: "RECORDING",
    target: {
      tabId: 42,
      windowId: 1,
      initialUrl: "https://example.com/",
      initialTitle: "Example",
    },
    options: {
      privacyMode: "standard",
      captureVideo: true,
      captureAudio: true,
      captureConsole: true,
      captureNetwork: true,
      captureFrameworkState: true,
      mediaTimesliceMs: 1000,
      videoBitsPerSecond: 8_000_000,
    },
    timeline: { createdAtEpochMs: 1_700_000_000_000 },
    quality: {
      overall: "complete",
      interactionCount: 0,
      confirmedInteractionCount: 0,
      primaryScreenshotCount: 0,
      fallbackScreenshotCount: 0,
      unavailableScreenshotCount: 0,
      issueSceneCount: 0,
      partialIssueSceneCount: 0,
      consoleEntryCount: 0,
      networkEntryCount: 0,
      issues: [],
    },
    nonce: "nonce-1",
    commandIds: { start: "cmd-start-1" },
    browserEpoch: "epoch-1",
    storage: { usedBytes: 0 },
  };
  return { ...base, ...overrides };
}

/** 简易内存 db：实现 runtime 使用的 db 方法子集。 */
export class MemoryDb {
  sessions = new Map<string, RecordingSession>();
  activeSessionId: string | undefined;
  commands = new Map<string, unknown>();
  storagePolicy = {
    retentionDays: 14,
    maxSessionBytes: 200 * 1024 * 1024,
    maxResponseBodyBytes: 2 * 1024 * 1024,
    compression: "balanced" as const,
  };
  interactions: unknown[] = [];
  consoleEntries: unknown[] = [];
  networkEntries: unknown[] = [];
  issueScenes: unknown[] = [];
  deleted: string[] = [];
  clearedActive: string[] = [];

  async getSession(id: string) {
    return this.sessions.get(id);
  }
  async getActiveSession() {
    return this.activeSessionId
      ? this.sessions.get(this.activeSessionId)
      : undefined;
  }
  async saveSession(session: RecordingSession) {
    this.sessions.set(session.id, session);
    return session;
  }
  async updateSession(
    id: string,
    update: (current: RecordingSession) => RecordingSession
  ) {
    const current = this.sessions.get(id);
    if (!current) return undefined;
    const next = update(current);
    this.sessions.set(id, next);
    return next;
  }
  async updateSessionAndClearActive(
    id: string,
    update: (current: RecordingSession) => RecordingSession
  ) {
    const current = this.sessions.get(id);
    if (!current) return undefined;
    const next = update(current);
    this.sessions.set(id, next);
    if (this.activeSessionId === id) this.activeSessionId = undefined;
    return next;
  }
  async claimSession(session: RecordingSession) {
    if (
      this.activeSessionId &&
      this.sessions.get(this.activeSessionId)?.status === "RECORDING"
    ) {
      return {
        session: this.sessions.get(this.activeSessionId)!,
        claimed: false,
      };
    }
    this.sessions.set(session.id, session);
    this.activeSessionId = session.id;
    if (session.commandIds?.start)
      this.commands.set(`command:${session.commandIds.start}`, {
        key: `command:${session.commandIds.start}`,
        commandId: session.commandIds.start,
        kind: "start",
        sessionId: session.id,
        createdAtEpochMs: Date.now(),
      });
    return { session, claimed: true };
  }
  async clearActive(sessionId: string) {
    if (this.activeSessionId === sessionId) this.activeSessionId = undefined;
    this.clearedActive.push(sessionId);
  }
  async getCommand(commandId: string) {
    return this.commands.get(`command:${commandId}`);
  }
  async claimCommand(command: {
    commandId: string;
    kind: "start" | "stop";
    sessionId: string;
    createdAtEpochMs: number;
  }) {
    const key = `command:${command.commandId}`;
    const existing = this.commands.get(key);
    if (existing) return { command: existing, claimed: false };
    this.commands.set(key, { key, ...command });
    return { command: { key, ...command }, claimed: true };
  }
  async getStoragePolicy() {
    return this.storagePolicy;
  }
  async saveStoragePolicy(policy: unknown) {
    this.storagePolicy = policy as typeof this.storagePolicy;
    return this.storagePolicy;
  }
  async getStorageOverview() {
    return { policy: this.storagePolicy, usedBytes: 0 };
  }
  async listSessionOverviews() {
    return [];
  }
  async deleteSession(id: string) {
    this.deleted.push(id);
    return this.sessions.delete(id);
  }
  async cleanupExpiredSessions() {
    return [];
  }
  async clearAllHistory() {
    const ids = [...this.sessions.keys()];
    this.sessions.clear();
    return ids;
  }
  async getInteractions(sessionId: string) {
    return this.interactions;
  }
  async getConsole(sessionId: string) {
    return this.consoleEntries;
  }
  async getNetwork(sessionId: string) {
    return this.networkEntries;
  }
  async getIssueScenes(sessionId: string) {
    return this.issueScenes;
  }
  async saveFrameworkStateWithinBudget(state: { sessionId: string }) {
    return { stored: true };
  }
}
