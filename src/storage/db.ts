import type { ConsoleEntry, EvidenceState, EvidenceSummary, ExportArtifact, ExportSelection, InteractionRecord, NetworkEntry, RecordingSession, SessionOverview, StorageOverview, StoragePolicy } from "../shared/protocol";
import { DEFAULT_STORAGE_POLICY, estimateBytes, expiresAt, isExpired, normalizeStoragePolicy } from "../domain/storage-policy.ts";

const DB_NAME = "web-bug-recorder";
const DB_VERSION = 5;
type StoreName = "control" | "sessions" | "interactions" | "consoleEntries" | "networkEntries" | "mediaChunks" | "exportSelections" | "exportArtifacts";
export type CommandRecord = { key: string; commandId: string; kind: "start" | "stop"; sessionId: string; createdAtEpochMs: number };
export type MediaChunkRecord = { id: string; sessionId: string; sequence: number; recordedAt: number; mimeType: string; chunk: ArrayBuffer };
export type BudgetWriteResult = { stored: boolean; usedBytes: number; limitReached: boolean };

let openPromise: Promise<IDBDatabase> | undefined;
function openDb(): Promise<IDBDatabase> {
  if (openPromise) return openPromise;
  openPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      const transaction = request.transaction;
      if (!transaction) throw new Error("IndexedDB 数据库升级/迁移事务不可用");
      const ensureStore = (name: StoreName, keyPath: string, indexes: Array<{ name: string; keyPath: string | string[] }> = []) => {
        const store = database.objectStoreNames.contains(name)
          ? transaction.objectStore(name)
          : database.createObjectStore(name, { keyPath });
        for (const index of indexes) {
          if (!store.indexNames.contains(index.name)) store.createIndex(index.name, index.keyPath);
        }
      };
      ensureStore("control", "key");
      ensureStore("sessions", "id", [{ name: "status", keyPath: "status" }]);
      ensureStore("interactions", "id", [{ name: "sessionId", keyPath: "sessionId" }]);
      ensureStore("consoleEntries", "id", [{ name: "sessionId", keyPath: "sessionId" }]);
      ensureStore("networkEntries", "id", [{ name: "sessionId", keyPath: "sessionId" }]);
      ensureStore("mediaChunks", "id", [
        { name: "sessionId", keyPath: "sessionId" },
        { name: "sessionIdSequence", keyPath: ["sessionId", "sequence"] }
      ]);
      ensureStore("exportSelections", "sessionId");
      ensureStore("exportArtifacts", "sessionId");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return openPromise;
}

async function put(storeName: StoreName, value: unknown): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function get<T>(storeName: StoreName, key: IDBValidKey): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(storeName).objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function list<T>(storeName: StoreName, indexName: string, key: IDBValidKey): Promise<T[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(storeName).objectStore(storeName).index(indexName).getAll(key);
    req.onsuccess = () => resolve((req.result ?? []) as T[]);
    req.onerror = () => reject(req.error);
  });
}

async function listAll<T>(storeName: StoreName): Promise<T[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(storeName).objectStore(storeName).getAll();
    req.onsuccess = () => resolve((req.result ?? []) as T[]);
    req.onerror = () => reject(req.error);
  });
}

async function update<T>(storeName: StoreName, key: IDBValidKey, mutate: (current: T) => T): Promise<T | undefined> {
  const db = await openDb();
  return new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    let next: T | undefined;
    const request = store.get(key);
    request.onsuccess = () => {
      const current = request.result as T | undefined;
      if (!current) return;
      try {
        next = mutate(current);
        store.put(next);
      } catch (error) {
        tx.abort();
        reject(error);
      }
    };
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => resolve(next);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error(`更新 ${storeName} 事务已被中止`));
  });
}

async function listMediaChunkBatch(sessionId: string, afterSequence: number, limit: number): Promise<MediaChunkRecord[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("mediaChunks");
    const index = tx.objectStore("mediaChunks").index("sessionIdSequence");
    const range = IDBKeyRange.bound(
      [sessionId, Math.max(0, afterSequence)],
      [sessionId, Number.MAX_SAFE_INTEGER],
      afterSequence >= 0,
      false
    );
    const records: MediaChunkRecord[] = [];
    const request = index.openCursor(range);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || records.length >= limit) {
        resolve(records);
        return;
      }
      records.push(cursor.value as MediaChunkRecord);
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
}

async function getMediaSummary(sessionId: string): Promise<{ count: number; mimeType?: string }> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("mediaChunks");
    const index = tx.objectStore("mediaChunks").index("sessionIdSequence");
    const range = IDBKeyRange.bound([sessionId, 0], [sessionId, Number.MAX_SAFE_INTEGER]);
    const countRequest = index.count(range);
    const firstRequest = index.openCursor(range);
    let count: number | undefined;
    let mimeType: string | undefined;
    const finish = () => {
      if (count != null && firstRequest.readyState === "done") resolve({ count, mimeType });
    };
    countRequest.onsuccess = () => { count = countRequest.result; finish(); };
    countRequest.onerror = () => reject(countRequest.error);
    firstRequest.onsuccess = () => {
      const first = firstRequest.result?.value as MediaChunkRecord | undefined;
      mimeType = first?.mimeType;
      finish();
    };
    firstRequest.onerror = () => reject(firstRequest.error);
  });
}

function hasIssue(session: RecordingSession, source: string): boolean {
  return session.quality.issues.some((entry) => entry.source === source);
}

function enabledState(enabled: boolean, count: number, failed: boolean, detail: string): EvidenceState {
  if (!enabled) return "disabled";
  if (failed && count === 0) return "failed";
  if (failed) return "partial";
  return "captured";
}

async function measureSessionBytes(sessionId: string): Promise<number> {
  const [interactions, consoleEntries, networkEntries, chunks] = await Promise.all([
    list<InteractionRecord>("interactions", "sessionId", sessionId),
    list<ConsoleEntry>("consoleEntries", "sessionId", sessionId),
    list<NetworkEntry>("networkEntries", "sessionId", sessionId),
    list<MediaChunkRecord>("mediaChunks", "sessionId", sessionId)
  ]);
  return [...interactions, ...consoleEntries, ...networkEntries, ...chunks].reduce((total, entry) => total + estimateBytes(entry), 0);
}

async function evidenceFor(session: RecordingSession): Promise<EvidenceSummary[]> {
  const [media, networkEntries] = await Promise.all([getMediaSummary(session.id), list<NetworkEntry>("networkEntries", "sessionId", session.id)]);
  const screenshotCount = session.quality.primaryScreenshotCount + session.quality.fallbackScreenshotCount;
  const unavailableScreenshots = session.quality.unavailableScreenshotCount;
  const networkBodyEntries = networkEntries.filter((entry) => entry.response);
  const bodyBytes = networkBodyEntries.reduce((total, entry) => total + (entry.response?.capturedByteLength ?? entry.response?.byteLength ?? 0), 0);
  const redactedBodyCount = networkBodyEntries.filter((entry) => entry.response?.bodyStatus === "redacted").length;
  const truncatedBodyCount = networkBodyEntries.filter((entry) => entry.response?.truncated).length;
  const unavailableBodyCount = networkBodyEntries.filter((entry) => entry.response?.bodyStatus === "unavailable" || entry.response?.bodyStatus === "pending").length;
  const videoState = enabledState(session.options.captureVideo, media.count, hasIssue(session, "media"), media.count ? `${media.count} 个媒体分片` : "没有媒体分片");
  const screenshotState = !session.options.captureScreenshots ? "disabled" : unavailableScreenshots ? (screenshotCount ? "partial" : "failed") : "captured";
  const consoleState = enabledState(session.options.captureConsole, session.quality.consoleEntryCount, hasIssue(session, "debugger"), `${session.quality.consoleEntryCount} 条`);
  const networkState = enabledState(session.options.captureNetwork, session.quality.networkEntryCount, hasIssue(session, "debugger"), `${session.quality.networkEntryCount} 条`);
  let bodiesState: EvidenceState = "disabled";
  if (session.options.captureNetwork && session.options.captureNetworkBodies) {
    bodiesState = redactedBodyCount
      ? "redacted"
      : unavailableBodyCount ? (networkBodyEntries.length ? "partial" : "failed")
      : "captured";
  }
  return [
    { kind: "video", state: videoState, count: media.count, sizeBytes: 0, detail: media.count ? `${media.count} 个 WebM 分片` : "未写入录像" },
    { kind: "audio", state: !session.options.captureAudio ? "disabled" : videoState, count: session.options.captureAudio && media.count ? 1 : 0, sizeBytes: 0, detail: session.options.captureAudio ? "与标签页录像复用同一 WebM" : "未采集" },
    { kind: "screenshots", state: screenshotState, count: screenshotCount, sizeBytes: 0, detail: !session.options.captureScreenshots ? "未采集" : unavailableScreenshots ? `${screenshotCount} 成功，${unavailableScreenshots} 失败` : `${screenshotCount} 张` },
    { kind: "console", state: consoleState, count: session.quality.consoleEntryCount, sizeBytes: 0, detail: `${session.quality.consoleEntryCount} 条` },
    { kind: "network", state: networkState, count: session.quality.networkEntryCount, sizeBytes: 0, detail: `${session.quality.networkEntryCount} 条` },
    { kind: "networkBodies", state: bodiesState, count: networkBodyEntries.length, sizeBytes: bodyBytes, detail: !session.options.captureNetworkBodies ? "未采集" : redactedBodyCount ? `${redactedBodyCount} 条已脱敏${truncatedBodyCount ? `，${truncatedBodyCount} 条已截断` : ""}` : truncatedBodyCount ? `${truncatedBodyCount} 条已截断` : `${networkBodyEntries.length} 条` }
  ];
}

async function putWithinSessionBudget<T extends { sessionId: string }>(storeName: StoreName, value: T): Promise<BudgetWriteResult> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([storeName, "sessions"], "readwrite");
    const store = tx.objectStore(storeName);
    const sessions = tx.objectStore("sessions");
    let result: BudgetWriteResult | undefined;
    const sessionRequest = sessions.get(value.sessionId);
    sessionRequest.onsuccess = () => {
      const session = sessionRequest.result as RecordingSession | undefined;
      if (!session) { result = { stored: false, usedBytes: 0, limitReached: false }; return; }
      const valueRequest = store.get((value as { id?: IDBValidKey }).id ?? value.sessionId);
      valueRequest.onsuccess = () => {
        const previous = valueRequest.result;
        const delta = Math.max(0, estimateBytes(value) - estimateBytes(previous));
        const usedBytes = session.storage?.usedBytes ?? 0;
        const limit = session.options.maxSessionBytes;
        if (usedBytes + delta > limit) {
          sessions.put({ ...session, storage: { usedBytes, limitReached: true } });
          result = { stored: false, usedBytes, limitReached: true };
          return;
        }
        const nextUsedBytes = Math.max(0, usedBytes + estimateBytes(value) - estimateBytes(previous));
        store.put(value);
        sessions.put({ ...session, storage: { usedBytes: nextUsedBytes, limitReached: false } });
        result = { stored: true, usedBytes: nextUsedBytes, limitReached: false };
      };
      valueRequest.onerror = () => reject(valueRequest.error);
    };
    sessionRequest.onerror = () => reject(sessionRequest.error);
    tx.oncomplete = () => result ? resolve(result) : reject(new Error("证据写入事务未产生结果"));
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("证据写入事务已中止"));
  });
}

async function deleteSessionAndEvidence(sessionId: string): Promise<boolean> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const stores: StoreName[] = ["sessions", "interactions", "consoleEntries", "networkEntries", "mediaChunks", "exportSelections", "exportArtifacts", "control"];
    const tx = db.transaction(stores, "readwrite");
    let existed = false;
    const sessions = tx.objectStore("sessions");
    const sessionRequest = sessions.get(sessionId);
    sessionRequest.onsuccess = () => { existed = Boolean(sessionRequest.result); sessions.delete(sessionId); };
    sessionRequest.onerror = () => reject(sessionRequest.error);
    for (const storeName of ["interactions", "consoleEntries", "networkEntries", "mediaChunks"] as const) {
      const index = tx.objectStore(storeName).index("sessionId");
      const cursorRequest = index.openKeyCursor(IDBKeyRange.only(sessionId));
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) return;
        tx.objectStore(storeName).delete(cursor.primaryKey);
        cursor.continue();
      };
      cursorRequest.onerror = () => reject(cursorRequest.error);
    }
    tx.objectStore("exportSelections").delete(sessionId);
    tx.objectStore("exportArtifacts").delete(sessionId);
    const activeRequest = tx.objectStore("control").get("active-session");
    activeRequest.onsuccess = () => { if (activeRequest.result?.sessionId === sessionId) tx.objectStore("control").delete("active-session"); };
    activeRequest.onerror = () => reject(activeRequest.error);
    tx.oncomplete = () => resolve(existed);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("会话删除事务已中止"));
  });
}

export const db = {
  getSession: (id: string) => get<RecordingSession>("sessions", id),
  listSessions: async (limit = 10) => (await listAll<RecordingSession>("sessions"))
    .sort((left, right) => right.timeline.createdAtEpochMs - left.timeline.createdAtEpochMs)
    .slice(0, Math.max(0, limit)),
  listSessionOverviews: async (query = ""): Promise<SessionOverview[]> => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const [policy, allSessions] = await Promise.all([db.getStoragePolicy(), listAll<RecordingSession>("sessions")]);
    const sessions = allSessions
      .filter((session) => !normalizedQuery || [session.target.initialTitle, session.target.initialUrl, session.status, session.id]
        .some((value) => value.toLocaleLowerCase().includes(normalizedQuery)))
      .sort((left, right) => right.timeline.createdAtEpochMs - left.timeline.createdAtEpochMs);
    return Promise.all(sessions.map(async (session) => {
      const sizeBytes = session.storage?.usedBytes ?? await measureSessionBytes(session.id);
      return {
        session,
        evidence: await evidenceFor(session),
        sizeBytes,
        expiresAtEpochMs: expiresAt(session.timeline.createdAtEpochMs, policy.retentionDays)
      };
    }));
  },
  saveSession: (session: RecordingSession) => put("sessions", session),
  updateSession: async (id: string, update: (current: RecordingSession) => RecordingSession) => {
    const dbInstance = await openDb();
    return new Promise<RecordingSession | undefined>((resolve, reject) => {
      const tx = dbInstance.transaction("sessions", "readwrite");
      const store = tx.objectStore("sessions");
      let next: RecordingSession | undefined;
      const request = store.get(id);
      request.onsuccess = () => {
        const current = request.result as RecordingSession | undefined;
        if (!current) return;
        try {
          next = update(current);
          store.put(next);
        } catch (error) {
          tx.abort();
          reject(error);
        }
      };
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => resolve(next);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("更新会话事务已被中止"));
    });
  },
  updateSessionAndClearActive: async (id: string, update: (current: RecordingSession) => RecordingSession) => {
    const dbInstance = await openDb();
    return new Promise<RecordingSession | undefined>((resolve, reject) => {
      const tx = dbInstance.transaction(["sessions", "control"], "readwrite");
      const sessions = tx.objectStore("sessions");
      const control = tx.objectStore("control");
      let next: RecordingSession | undefined;

      const sessionRequest = sessions.get(id);
      sessionRequest.onsuccess = () => {
        const current = sessionRequest.result as RecordingSession | undefined;
        if (!current) return;
        try {
          next = update(current);
          sessions.put(next);
        } catch (error) {
          tx.abort();
          reject(error);
        }
      };
      sessionRequest.onerror = () => reject(sessionRequest.error);

      const activeRequest = control.get("active-session");
      activeRequest.onsuccess = () => {
        const active = activeRequest.result as { sessionId?: string } | undefined;
        if (active?.sessionId === id) control.delete("active-session");
      };
      activeRequest.onerror = () => reject(activeRequest.error);

      tx.oncomplete = () => resolve(next);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("会话完成事务已被中止"));
    });
  },
  getActiveSession: async () => {
    const active = await get<{ key: string; sessionId?: string }>("control", "active-session");
    return active?.sessionId ? get<RecordingSession>("sessions", active.sessionId) : undefined;
  },
  claimSession: async (session: RecordingSession) => {
    const dbInstance = await openDb();
    return new Promise<{ session: RecordingSession; claimed: boolean }>((resolve, reject) => {
      const tx = dbInstance.transaction(["control", "sessions"], "readwrite");
      const control = tx.objectStore("control");
      const sessions = tx.objectStore("sessions");
      let result: { session: RecordingSession; claimed: boolean } | undefined;
      const claim = () => {
        sessions.put(session);
        control.put({ key: "active-session", sessionId: session.id });
        if (session.commandIds?.start) control.put({ key: `command:${session.commandIds.start}`, commandId: session.commandIds.start, kind: "start", sessionId: session.id, createdAtEpochMs: Date.now() });
        result = { session, claimed: true };
      };
      const currentReq = control.get("active-session");
      currentReq.onsuccess = () => {
        const current = currentReq.result as { sessionId?: string } | undefined;
        if (current?.sessionId) {
          const existingReq = sessions.get(current.sessionId);
          existingReq.onsuccess = () => {
            const existing = existingReq.result as RecordingSession | undefined;
            if (existing && ["PREPARING", "RECORDING", "DEGRADED", "STOPPING"].includes(existing.status)) {
              result = { session: existing, claimed: false };
            } else {
              claim();
            }
          };
          existingReq.onerror = () => reject(existingReq.error);
          return;
        }
        claim();
      };
      tx.oncomplete = () => result ? resolve(result) : reject(new Error("会话占用事务已完成但无有效结果"));
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("会话占用事务已被中止"));
    });
  },
  clearActive: async (sessionId: string) => {
    const dbInstance = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = dbInstance.transaction("control", "readwrite");
      const store = tx.objectStore("control");
      const request = store.get("active-session");
      request.onsuccess = () => {
        const current = request.result as { sessionId?: string } | undefined;
        if (current?.sessionId === sessionId) store.delete("active-session");
      };
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("活动会话清理事务已被中止"));
    });
  },
  getCommand: (commandId: string) => get<CommandRecord>("control", `command:${commandId}`),
  claimCommand: async (command: Omit<CommandRecord, "key">) => {
    const dbInstance = await openDb();
    return new Promise<{ command: CommandRecord; claimed: boolean }>((resolve, reject) => {
      const tx = dbInstance.transaction("control", "readwrite");
      const store = tx.objectStore("control");
      const key = `command:${command.commandId}`;
      let result: { command: CommandRecord; claimed: boolean } | undefined;
      const request = store.get(key);
      request.onsuccess = () => {
        const existing = request.result as CommandRecord | undefined;
        if (existing) {
          result = { command: existing, claimed: false };
          return;
        }
        const next = { key, ...command };
        store.put(next);
        result = { command: next, claimed: true };
      };
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => result ? resolve(result) : reject(new Error("指令占用事务已完成但无有效结果"));
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("指令占用事务已被中止"));
    });
  },
  getInteraction: (id: string) => get<InteractionRecord>("interactions", id),
  saveInteraction: (record: InteractionRecord) => put("interactions", record),
  saveInteractionWithinBudget: (record: InteractionRecord) => putWithinSessionBudget("interactions", record),
  getInteractions: (sessionId: string) => list<InteractionRecord>("interactions", "sessionId", sessionId),
  saveConsole: (entry: ConsoleEntry) => put("consoleEntries", entry),
  saveConsoleWithinBudget: (entry: ConsoleEntry) => putWithinSessionBudget("consoleEntries", entry),
  getConsole: (sessionId: string) => list<ConsoleEntry>("consoleEntries", "sessionId", sessionId),
  saveNetwork: (entry: NetworkEntry) => put("networkEntries", entry),
  saveNetworkWithinBudget: (entry: NetworkEntry) => putWithinSessionBudget("networkEntries", entry),
  getNetworkEntry: (id: string) => get<NetworkEntry>("networkEntries", id),
  updateNetworkEntry: (id: string, mutate: (current: NetworkEntry) => NetworkEntry) => update<NetworkEntry>("networkEntries", id, mutate),
  updateNetworkEntryWithinBudget: async (id: string, mutate: (current: NetworkEntry) => NetworkEntry): Promise<BudgetWriteResult> => {
    const current = await get<NetworkEntry>("networkEntries", id);
    if (!current) return { stored: false, usedBytes: 0, limitReached: false };
    return putWithinSessionBudget("networkEntries", mutate(current));
  },
  getNetwork: async (sessionId: string) => (await list<NetworkEntry>("networkEntries", "sessionId", sessionId)).sort((left, right) => left.createdAt - right.createdAt),
  saveMediaChunk: (chunk: MediaChunkRecord) => put("mediaChunks", chunk),
  saveMediaChunkWithinBudget: (chunk: MediaChunkRecord) => putWithinSessionBudget("mediaChunks", chunk),
  getMediaSummary,
  getMediaChunks: async (sessionId: string) => (await list<MediaChunkRecord>("mediaChunks", "sessionId", sessionId)).sort((left, right) => left.sequence - right.sequence),
  iterateMediaChunks: async (sessionId: string, visitor: (chunk: MediaChunkRecord) => void | Promise<void>, batchSize = 16) => {
    let afterSequence = -1;
    let visited = 0;
    const size = Math.max(1, Math.floor(batchSize));
    while (true) {
      const batch = await listMediaChunkBatch(sessionId, afterSequence, size);
      if (!batch.length) return visited;
      for (const chunk of batch) {
        await visitor(chunk);
        afterSequence = chunk.sequence;
        visited += 1;
      }
      if (batch.length < size) return visited;
    }
  },
  getExportSelection: (sessionId: string) => get<ExportSelection>("exportSelections", sessionId),
  saveExportSelection: (selection: ExportSelection) => put("exportSelections", selection),
  getExportArtifact: (sessionId: string) => get<ExportArtifact>("exportArtifacts", sessionId),
  saveExportArtifact: (artifact: ExportArtifact) => put("exportArtifacts", artifact),
  getStoragePolicy: async (): Promise<StoragePolicy> => {
    const stored = await get<{ key: string; policy?: Partial<StoragePolicy> }>("control", "storage-policy");
    return normalizeStoragePolicy(stored?.policy ?? DEFAULT_STORAGE_POLICY);
  },
  saveStoragePolicy: async (policy: Partial<StoragePolicy>): Promise<StoragePolicy> => {
    const next = normalizeStoragePolicy(policy);
    await put("control", { key: "storage-policy", policy: next });
    return next;
  },
  getStorageOverview: async (): Promise<StorageOverview> => {
    const [policy, sessions] = await Promise.all([db.getStoragePolicy(), listAll<RecordingSession>("sessions")]);
    const usedBytes = (await Promise.all(sessions.map((session) => session.storage?.usedBytes ?? measureSessionBytes(session.id))))
      .reduce((total, value) => total + value, 0);
    const estimate = typeof navigator !== "undefined" && navigator.storage?.estimate
      ? await navigator.storage.estimate().catch(() => undefined)
      : undefined;
    return { usedBytes, quotaBytes: estimate?.quota ?? Math.max(usedBytes, policy.maxSessionBytes), sessionCount: sessions.length, policy };
  },
  deleteSession: deleteSessionAndEvidence,
  cleanupExpiredSessions: async (now = Date.now()): Promise<string[]> => {
    const [policy, sessions, active] = await Promise.all([db.getStoragePolicy(), listAll<RecordingSession>("sessions"), db.getActiveSession()]);
    const expired = sessions.filter((session) => session.id !== active?.id && isExpired(session.timeline.createdAtEpochMs, policy.retentionDays, now));
    await Promise.all(expired.map((session) => deleteSessionAndEvidence(session.id)));
    return expired.map((session) => session.id);
  }
};

export type EvidenceRepository = Pick<
  typeof db,
  | "getSession"
  | "getActiveSession"
  | "saveSession"
  | "getInteraction"
  | "saveInteraction"
  | "saveInteractionWithinBudget"
  | "getInteractions"
  | "saveConsole"
  | "saveConsoleWithinBudget"
  | "getConsole"
  | "getNetworkEntry"
  | "updateNetworkEntry"
  | "updateNetworkEntryWithinBudget"
  | "saveNetwork"
  | "saveNetworkWithinBudget"
  | "getNetwork"
  | "saveMediaChunk"
  | "saveMediaChunkWithinBudget"
  | "getMediaSummary"
  | "getMediaChunks"
  | "iterateMediaChunks"
>;
