import type {
  ConsoleEntry,
  EvidenceAsset,
  ExportArtifact,
  ExportSelection,
  InteractionRecord,
  IssueScene,
  NetworkEntry,
  RecordingSession,
  SessionOverview,
  StorageOverview,
  StoragePolicy,
} from "../shared/protocol";
import {
  DEFAULT_STORAGE_POLICY,
  estimateBytes,
  expiresAt,
  isExpired,
  normalizeStoragePolicy,
} from "../domain/storage-policy.ts";
import { buildEvidenceSummary } from "./evidence-summary.ts";
import {
  openEvidenceDatabase as openDb,
  type StoreName,
} from "./indexed-db-schema.ts";
import { deleteSessionAndEvidence } from "./session-deletion.ts";
import {
  putWithinSessionBudget,
  type BudgetWriteResult,
} from "./storage-budget.ts";

export type CommandRecord = {
  key: string;
  commandId: string;
  kind: "start" | "stop";
  sessionId: string;
  createdAtEpochMs: number;
};
export type MediaChunkRecord = {
  id: string;
  sessionId: string;
  sequence: number;
  recordedAt: number;
  mimeType: string;
  chunk: ArrayBuffer;
};
export type { BudgetWriteResult } from "./storage-budget.ts";

async function put(storeName: StoreName, value: unknown): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function get<T>(
  storeName: StoreName,
  key: IDBValidKey
): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(storeName).objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function list<T>(
  storeName: StoreName,
  indexName: string,
  key: IDBValidKey
): Promise<T[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db
      .transaction(storeName)
      .objectStore(storeName)
      .index(indexName)
      .getAll(key);
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

async function update<T>(
  storeName: StoreName,
  key: IDBValidKey,
  mutate: (current: T) => T
): Promise<T | undefined> {
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
    tx.onabort = () =>
      reject(tx.error ?? new Error(`更新 ${storeName} 事务已被中止`));
  });
}

async function listMediaChunkBatch(
  sessionId: string,
  afterSequence: number,
  limit: number
): Promise<MediaChunkRecord[]> {
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

async function getMediaSummary(
  sessionId: string
): Promise<{ count: number; mimeType?: string }> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("mediaChunks");
    const index = tx.objectStore("mediaChunks").index("sessionIdSequence");
    const range = IDBKeyRange.bound(
      [sessionId, 0],
      [sessionId, Number.MAX_SAFE_INTEGER]
    );
    const countRequest = index.count(range);
    const firstRequest = index.openCursor(range);
    let count: number | undefined;
    let mimeType: string | undefined;
    const finish = () => {
      if (count != null && firstRequest.readyState === "done")
        resolve({ count, mimeType });
    };
    countRequest.onsuccess = () => {
      count = countRequest.result;
      finish();
    };
    countRequest.onerror = () => reject(countRequest.error);
    firstRequest.onsuccess = () => {
      const first = firstRequest.result?.value as MediaChunkRecord | undefined;
      mimeType = first?.mimeType;
      finish();
    };
    firstRequest.onerror = () => reject(firstRequest.error);
  });
}

function sumBytesByCursor(
  database: IDBDatabase,
  storeName: StoreName,
  sessionId: string
): Promise<number> {
  return new Promise((resolve, reject) => {
    const tx = database.transaction(storeName);
    const index = tx.objectStore(storeName).index("sessionId");
    const request = index.openCursor(IDBKeyRange.only(sessionId));
    let total = 0;
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(total);
        return;
      }
      total += estimateBytes(cursor.value);
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
}

async function measureSessionBytes(sessionId: string): Promise<number> {
  const database = await openDb();
  const storeNames: StoreName[] = [
    "interactions",
    "consoleEntries",
    "networkEntries",
    "mediaChunks",
    "issueScenes",
    "evidenceAssets",
  ];
  let total = 0;
  for (const storeName of storeNames) {
    total += await sumBytesByCursor(database, storeName, sessionId);
  }
  return total;
}

async function deleteIssueScene(issueSceneId: string): Promise<void> {
  const [scene, assets] = await Promise.all([
    get<IssueScene>("issueScenes", issueSceneId),
    list<EvidenceAsset>("evidenceAssets", "issueSceneId", issueSceneId),
  ]);
  if (!scene) return;
  const database = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction(
      ["issueScenes", "evidenceAssets", "sessions"],
      "readwrite"
    );
    const issueAssets = tx.objectStore("evidenceAssets");
    const sessions = tx.objectStore("sessions");
    const sessionRequest = sessions.get(scene.sessionId);
    sessionRequest.onsuccess = () => {
      const session = sessionRequest.result as RecordingSession | undefined;
      if (session) {
        const releasedBytes =
          estimateBytes(scene) +
          assets.reduce((total, asset) => total + estimateBytes(asset), 0);
        const usedBytes = Math.max(
          0,
          (session.storage?.usedBytes ?? 0) - releasedBytes
        );
        sessions.put({
          ...session,
          storage: { usedBytes, limitReached: false },
        });
      }
      for (const asset of assets) issueAssets.delete(asset.id);
    };
    sessionRequest.onerror = () => reject(sessionRequest.error);
    tx.objectStore("issueScenes").delete(issueSceneId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("问题现场删除事务已中止"));
  });
}

async function evidenceFor(session: RecordingSession) {
  const [media, networkEntries, issueScenes] = await Promise.all([
    getMediaSummary(session.id),
    list<NetworkEntry>("networkEntries", "sessionId", session.id),
    list<IssueScene>("issueScenes", "sessionId", session.id),
  ]);
  return buildEvidenceSummary(session, media, networkEntries, issueScenes);
}

export const db = {
  getSession: (id: string) => get<RecordingSession>("sessions", id),
  listSessions: async (limit = 10) =>
    (await listAll<RecordingSession>("sessions"))
      .sort(
        (left, right) =>
          right.timeline.createdAtEpochMs - left.timeline.createdAtEpochMs
      )
      .slice(0, Math.max(0, limit)),
  listSessionOverviews: async (query = ""): Promise<SessionOverview[]> => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const [policy, allSessions] = await Promise.all([
      db.getStoragePolicy(),
      listAll<RecordingSession>("sessions"),
    ]);
    const sessions = allSessions
      .filter(
        (session) =>
          !normalizedQuery ||
          [
            session.target.initialTitle,
            session.target.initialUrl,
            session.status,
            session.id,
          ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery))
      )
      .sort(
        (left, right) =>
          right.timeline.createdAtEpochMs - left.timeline.createdAtEpochMs
      );
    return Promise.all(
      sessions.map(async (session) => {
        const sizeBytes =
          session.storage?.usedBytes ?? (await measureSessionBytes(session.id));
        return {
          session,
          evidence: await evidenceFor(session),
          sizeBytes,
          expiresAtEpochMs: expiresAt(
            session.timeline.createdAtEpochMs,
            policy.retentionDays
          ),
        };
      })
    );
  },
  saveSession: (session: RecordingSession) => put("sessions", session),
  updateSession: async (
    id: string,
    update: (current: RecordingSession) => RecordingSession
  ) => {
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
  updateSessionAndClearActive: async (
    id: string,
    update: (current: RecordingSession) => RecordingSession
  ) => {
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
        const active = activeRequest.result as
          { sessionId?: string } | undefined;
        if (active?.sessionId === id) control.delete("active-session");
      };
      activeRequest.onerror = () => reject(activeRequest.error);

      tx.oncomplete = () => resolve(next);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("会话完成事务已被中止"));
    });
  },
  getActiveSession: async () => {
    const active = await get<{ key: string; sessionId?: string }>(
      "control",
      "active-session"
    );
    return active?.sessionId
      ? get<RecordingSession>("sessions", active.sessionId)
      : undefined;
  },
  claimSession: async (session: RecordingSession) => {
    const dbInstance = await openDb();
    return new Promise<{ session: RecordingSession; claimed: boolean }>(
      (resolve, reject) => {
        const tx = dbInstance.transaction(["control", "sessions"], "readwrite");
        const control = tx.objectStore("control");
        const sessions = tx.objectStore("sessions");
        let result: { session: RecordingSession; claimed: boolean } | undefined;
        const claim = () => {
          sessions.put(session);
          control.put({ key: "active-session", sessionId: session.id });
          if (session.commandIds?.start)
            control.put({
              key: `command:${session.commandIds.start}`,
              commandId: session.commandIds.start,
              kind: "start",
              sessionId: session.id,
              createdAtEpochMs: Date.now(),
            });
          result = { session, claimed: true };
        };
        const currentReq = control.get("active-session");
        currentReq.onsuccess = () => {
          const current = currentReq.result as
            { sessionId?: string } | undefined;
          if (current?.sessionId) {
            const existingReq = sessions.get(current.sessionId);
            existingReq.onsuccess = () => {
              const existing = existingReq.result as
                RecordingSession | undefined;
              if (
                existing &&
                ["PREPARING", "RECORDING", "DEGRADED", "STOPPING"].includes(
                  existing.status
                )
              ) {
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
        tx.oncomplete = () =>
          result
            ? resolve(result)
            : reject(new Error("会话占用事务已完成但无有效结果"));
        tx.onerror = () => reject(tx.error);
        tx.onabort = () =>
          reject(tx.error ?? new Error("会话占用事务已被中止"));
      }
    );
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
      tx.onabort = () =>
        reject(tx.error ?? new Error("活动会话清理事务已被中止"));
    });
  },
  getCommand: (commandId: string) =>
    get<CommandRecord>("control", `command:${commandId}`),
  claimCommand: async (command: Omit<CommandRecord, "key">) => {
    const dbInstance = await openDb();
    return new Promise<{ command: CommandRecord; claimed: boolean }>(
      (resolve, reject) => {
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
        tx.oncomplete = () =>
          result
            ? resolve(result)
            : reject(new Error("指令占用事务已完成但无有效结果"));
        tx.onerror = () => reject(tx.error);
        tx.onabort = () =>
          reject(tx.error ?? new Error("指令占用事务已被中止"));
      }
    );
  },
  getInteraction: (id: string) => get<InteractionRecord>("interactions", id),
  saveInteraction: (record: InteractionRecord) => put("interactions", record),
  saveInteractionWithinBudget: (record: InteractionRecord) =>
    putWithinSessionBudget("interactions", record),
  getInteractions: (sessionId: string) =>
    list<InteractionRecord>("interactions", "sessionId", sessionId),
  getIssueScene: (id: string) => get<IssueScene>("issueScenes", id),
  saveIssueScene: (scene: IssueScene) => put("issueScenes", scene),
  saveIssueSceneWithinBudget: (scene: IssueScene) =>
    putWithinSessionBudget("issueScenes", scene),
  updateIssueScene: (id: string, mutate: (current: IssueScene) => IssueScene) =>
    update<IssueScene>("issueScenes", id, mutate),
  getIssueScenes: async (sessionId: string) =>
    (await list<IssueScene>("issueScenes", "sessionId", sessionId)).sort(
      (left, right) => left.observedAtEpochMs - right.observedAtEpochMs
    ),
  getEvidenceAsset: (id: string) => get<EvidenceAsset>("evidenceAssets", id),
  saveEvidenceAsset: (asset: EvidenceAsset) => put("evidenceAssets", asset),
  saveEvidenceAssetWithinBudget: (asset: EvidenceAsset) =>
    putWithinSessionBudget("evidenceAssets", asset),
  getEvidenceAssets: (issueSceneId: string) =>
    list<EvidenceAsset>("evidenceAssets", "issueSceneId", issueSceneId),
  getEvidenceAssetsForSession: (sessionId: string) =>
    list<EvidenceAsset>("evidenceAssets", "sessionId", sessionId),
  deleteIssueScene,
  saveConsole: (entry: ConsoleEntry) => put("consoleEntries", entry),
  saveConsoleWithinBudget: (entry: ConsoleEntry) =>
    putWithinSessionBudget("consoleEntries", entry),
  getConsole: (sessionId: string) =>
    list<ConsoleEntry>("consoleEntries", "sessionId", sessionId),
  saveNetwork: (entry: NetworkEntry) => put("networkEntries", entry),
  saveNetworkWithinBudget: (entry: NetworkEntry) =>
    putWithinSessionBudget("networkEntries", entry),
  getNetworkEntry: (id: string) => get<NetworkEntry>("networkEntries", id),
  updateNetworkEntry: (
    id: string,
    mutate: (current: NetworkEntry) => NetworkEntry
  ) => update<NetworkEntry>("networkEntries", id, mutate),
  updateNetworkEntryWithinBudget: async (
    id: string,
    mutate: (current: NetworkEntry) => NetworkEntry
  ): Promise<BudgetWriteResult> => {
    const current = await get<NetworkEntry>("networkEntries", id);
    if (!current) return { stored: false, usedBytes: 0, limitReached: false };
    return putWithinSessionBudget("networkEntries", mutate(current));
  },
  getNetwork: async (sessionId: string) =>
    (await list<NetworkEntry>("networkEntries", "sessionId", sessionId)).sort(
      (left, right) => left.createdAt - right.createdAt
    ),
  saveMediaChunk: (chunk: MediaChunkRecord) => put("mediaChunks", chunk),
  saveMediaChunkWithinBudget: (chunk: MediaChunkRecord) =>
    putWithinSessionBudget("mediaChunks", chunk),
  getMediaSummary,
  getMediaChunks: async (sessionId: string) =>
    (await list<MediaChunkRecord>("mediaChunks", "sessionId", sessionId)).sort(
      (left, right) => left.sequence - right.sequence
    ),
  iterateMediaChunks: async (
    sessionId: string,
    visitor: (chunk: MediaChunkRecord) => void | Promise<void>,
    batchSize = 16
  ) => {
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
  getExportSelection: (sessionId: string) =>
    get<ExportSelection>("exportSelections", sessionId),
  saveExportSelection: (selection: ExportSelection) =>
    put("exportSelections", selection),
  getExportArtifact: (sessionId: string) =>
    get<ExportArtifact>("exportArtifacts", sessionId),
  saveExportArtifact: (artifact: ExportArtifact) =>
    put("exportArtifacts", artifact),
  getStoragePolicy: async (): Promise<StoragePolicy> => {
    const stored = await get<{ key: string; policy?: Partial<StoragePolicy> }>(
      "control",
      "storage-policy"
    );
    return normalizeStoragePolicy(stored?.policy ?? DEFAULT_STORAGE_POLICY);
  },
  saveStoragePolicy: async (
    policy: Partial<StoragePolicy>
  ): Promise<StoragePolicy> => {
    const next = normalizeStoragePolicy(policy);
    await put("control", { key: "storage-policy", policy: next });
    return next;
  },
  getStorageOverview: async (): Promise<StorageOverview> => {
    const [policy, sessions] = await Promise.all([
      db.getStoragePolicy(),
      listAll<RecordingSession>("sessions"),
    ]);
    const usedBytes = (
      await Promise.all(
        sessions.map(
          (session) =>
            session.storage?.usedBytes ?? measureSessionBytes(session.id)
        )
      )
    ).reduce((total, value) => total + value, 0);
    const estimate =
      typeof navigator !== "undefined" && navigator.storage?.estimate
        ? await navigator.storage.estimate().catch(() => undefined)
        : undefined;
    return {
      usedBytes,
      quotaBytes:
        estimate?.quota ?? Math.max(usedBytes, policy.maxSessionBytes),
      sessionCount: sessions.length,
      policy,
    };
  },
  deleteSession: deleteSessionAndEvidence,
  cleanupExpiredSessions: async (now = Date.now()): Promise<string[]> => {
    const [policy, sessions, active] = await Promise.all([
      db.getStoragePolicy(),
      listAll<RecordingSession>("sessions"),
      db.getActiveSession(),
    ]);
    const expired = sessions.filter(
      (session) =>
        session.id !== active?.id &&
        isExpired(session.timeline.createdAtEpochMs, policy.retentionDays, now)
    );
    await Promise.all(
      expired.map((session) => deleteSessionAndEvidence(session.id))
    );
    return expired.map((session) => session.id);
  },
  clearAllHistory: async (): Promise<string[]> => {
    const [sessions, active] = await Promise.all([
      listAll<RecordingSession>("sessions"),
      db.getActiveSession(),
    ]);
    const targetSessions = sessions.filter(
      (session) => session.id !== active?.id
    );
    await Promise.all(
      targetSessions.map((session) => deleteSessionAndEvidence(session.id))
    );
    return targetSessions.map((session) => session.id);
  },
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
  | "getIssueScene"
  | "saveIssueScene"
  | "saveIssueSceneWithinBudget"
  | "updateIssueScene"
  | "getIssueScenes"
  | "getEvidenceAsset"
  | "saveEvidenceAsset"
  | "saveEvidenceAssetWithinBudget"
  | "getEvidenceAssets"
  | "getEvidenceAssetsForSession"
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
