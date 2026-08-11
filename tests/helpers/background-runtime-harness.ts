import {
  createBackgroundRuntime,
  type BackgroundDeps,
  type BackgroundRuntime,
} from "../../src/entrypoints/background/runtime.ts";
import type {
  CaptureIssue,
  InteractionRecord,
  NetworkEntry,
  RecordingSession,
} from "../../src/shared/protocol.ts";
import { MemoryDb, makeSession } from "./background-test-utils.ts";

/** 记录所有调用轨迹的 fake 依赖。 */
export class FakeStreamHealthMonitor {
  calls: string[] = [];
  sessionId: string | undefined;
  private health = {
    code: "RECORDING",
    badgeText: "REC",
    badgeColor: "#d92d20",
    streams: {
      media: "ok" as const,
      cdp: "ok" as const,
      content: "ok" as const,
      storage: "ok" as const,
    },
  };
  initialize(tabId: number, sessionId: string, _options: unknown) {
    this.calls.push(`initialize:${tabId}:${sessionId}`);
    this.sessionId = sessionId;
  }
  getSessionId() {
    return this.sessionId;
  }
  updateStream(stream: string, state: string) {
    this.calls.push(`updateStream:${stream}:${state}`);
    return this.health;
  }
  getHealth() {
    return this.health;
  }
  reset(tabId?: number) {
    this.calls.push(`reset:${tabId ?? "none"}`);
  }
  async sync() {
    this.calls.push("sync");
  }
}

export class FakeRecordingCoordinator {
  calls: string[] = [];
  stopping = new Set<string>();
  async restoreStoppingIds() {
    this.calls.push("restoreStoppingIds");
  }
  runLifecycle<T>(work: () => Promise<T>): Promise<T> {
    this.calls.push("runLifecycle");
    return work();
  }
  runStop<T>(sessionId: string, work: () => Promise<T>): Promise<T> {
    this.calls.push(`runStop:${sessionId}`);
    return work();
  }
  beginStopping(sessionId: string) {
    this.calls.push(`beginStopping:${sessionId}`);
    this.stopping.add(sessionId);
  }
  finishStopping(sessionId: string) {
    this.calls.push(`finishStopping:${sessionId}`);
    this.stopping.delete(sessionId);
  }
  isStopping(sessionId: string) {
    return this.stopping.has(sessionId);
  }
}

export class FakeContentScripts {
  calls: string[] = [];
  async activate(tabId: number) {
    this.calls.push(`activate:${tabId}`);
  }
  async restore(tabId: number) {
    this.calls.push(`restore:${tabId}`);
  }
  async remove(tabId?: number) {
    this.calls.push(`remove:${tabId ?? "none"}`);
  }
}

export class FakeCdpCollector {
  calls: string[] = [];
  attached = false;
  attachIssue: CaptureIssue | undefined;
  async verifyOwnership(tabId: number) {
    this.calls.push(`verifyOwnership:${tabId}`);
    return this.attached;
  }
  async attach(tabId: number, _session: RecordingSession) {
    this.calls.push(`attach:${tabId}`);
    if (this.attachIssue) return this.attachIssue;
    this.attached = true;
    return undefined;
  }
  async detach(tabId: number) {
    this.calls.push(`detach:${tabId}`);
    this.attached = false;
  }
  async drain() {
    this.calls.push("drain");
    return [];
  }
  async finalizeNetworkBodies(_session: RecordingSession) {
    this.calls.push("finalizeNetworkBodies");
  }
  handleEvent(_source: unknown, _method: string, _params?: object) {
    this.calls.push("handleEvent");
  }
  async handleDetach(
    _source: unknown,
    _reason: string,
    onReattached: () => void
  ) {
    this.calls.push("handleDetach");
    onReattached();
  }
}

export class FakeInteractionCapture {
  calls: string[] = [];
  async handle(_interaction: InteractionRecord, _sender: unknown) {
    this.calls.push("handle");
  }
  async cancel(
    _interactionId: string,
    _interaction: InteractionRecord,
    _sessionId: string | undefined,
    _sender: unknown
  ) {
    this.calls.push("cancel");
  }
  async upgrade(_interactionId: string, _kind: string) {
    this.calls.push("upgrade");
  }
  async drain() {
    this.calls.push("drain");
    return [];
  }
}

export class FakeIssueSceneCapture {
  calls: string[] = [];
  async capture(_payload: unknown, _sender: unknown) {
    this.calls.push("capture");
    return { scene: undefined, dataUrl: undefined };
  }
  async commit(_payload: unknown, _sender: unknown) {
    this.calls.push("commit");
    return undefined;
  }
  async cancel(_issueSceneId: string, _nonce: string, _sender: unknown) {
    this.calls.push("cancel");
  }
  async drain() {
    this.calls.push("drain");
    return [];
  }
  async finalizeUnfinished(_sessionId: string) {
    this.calls.push("finalizeUnfinished");
  }
}

export class FakeNavigationCapture {
  calls: string[] = [];
  attach() {
    this.calls.push("attach");
  }
  detach() {
    this.calls.push("detach");
  }
  setCurrentUrl(url: string) {
    this.calls.push(`setCurrentUrl:${url}`);
  }
}

export type TestHarness = {
  runtime: BackgroundRuntime;
  db: MemoryDb;
  streamHealthMonitor: FakeStreamHealthMonitor;
  recordingCoordinator: FakeRecordingCoordinator;
  contentScripts: FakeContentScripts;
  cdpCollector: FakeCdpCollector;
  interactionCapture: FakeInteractionCapture;
  issueSceneCapture: FakeIssueSceneCapture;
  navigationCapture: FakeNavigationCapture;
  deps: BackgroundDeps;
};

/** 构造一个带 fake deps 的 runtime 测试装配。 */
export function createTestRuntime(): TestHarness {
  const db = new MemoryDb();
  const streamHealthMonitor = new FakeStreamHealthMonitor();
  const recordingCoordinator = new FakeRecordingCoordinator();
  const contentScripts = new FakeContentScripts();
  const cdpCollector = new FakeCdpCollector();
  const interactionCapture = new FakeInteractionCapture();
  const issueSceneCapture = new FakeIssueSceneCapture();
  const navigationCapture = new FakeNavigationCapture();

  const deps = {
    db,
    extensionVersion: "0.6.0",
    browserEpochPromise: Promise.resolve("epoch-1"),
    streamHealthMonitor,
    recordingCoordinator,
    contentScripts,
    cdpCollector,
    interactionCapture,
    issueSceneCapture,
    navigationCapture,
  } as unknown as BackgroundDeps;

  const runtime = createBackgroundRuntime(deps);
  return {
    runtime,
    db,
    streamHealthMonitor,
    recordingCoordinator,
    contentScripts,
    cdpCollector,
    interactionCapture,
    issueSceneCapture,
    navigationCapture,
    deps,
  };
}

export { makeSession };
export type { CaptureIssue, NetworkEntry, RecordingSession };
