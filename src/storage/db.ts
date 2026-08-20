import type {
  ConsoleEntry,
  EvidenceAsset,
  ExportArtifact,
  ExportSelection,
  FrameworkStateEvidence,
  InteractionRecord,
  IssueScene,
  NetworkEntry,
  RecordingSession,
  SessionOverview,
  StorageOverview,
  StoragePolicy,
} from "../shared/protocol";
import { ACTIVE_STATUSES } from "../shared/protocol";
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
export {
  flushStorageBatchQueue,
  putWithinSessionBudget,
  type BudgetWriteResult,
} from "./storage-budget.ts";

/**
 * 证据仓储：封装 IndexedDB 的读写，供 background/offscreen 统一调用。
 * 方法按职责分组：会话管理、证据存取（含预算写入）、导出选择、存储策略与清理。
 */

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
  // 内部通用工具：按索引键取回某会话的整组记录
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
  // 按 (sessionId, sequence) 复合索引游标分页：只取 afterSequence 之后的一段，避免一次载入全部分片
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
  // 同时发起 count 与首个游标请求，二者都完成即可得到分片数量与首片类型
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
  // 跨 7 个证据 store 逐个游标累计字节数；仅在没有缓存用量（storage.usedBytes）时兜底调用
  const storeNames: StoreName[] = [
    "interactions",
    "consoleEntries",
    "networkEntries",
    "mediaChunks",
    "issueScenes",
    "evidenceAssets",
    "frameworkStates",
  ];
  let total = 0;
  for (const storeName of storeNames) {
    total += await sumBytesByCursor(database, storeName, sessionId);
  }
  return total;
}

async function deleteIssueScene(issueSceneId: string): Promise<void> {
  // 同事务删除问题现场及其证据资产，并把释放的字节数从会话用量中扣回
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
  const [media, networkEntries, issueScenes, frameworkStates] =
    await Promise.all([
      getMediaSummary(session.id),
      list<NetworkEntry>("networkEntries", "sessionId", session.id),
      list<IssueScene>("issueScenes", "sessionId", session.id),
      list<FrameworkStateEvidence>("frameworkStates", "sessionId", session.id),
    ]);
  return buildEvidenceSummary(
    session,
    media,
    networkEntries,
    issueScenes,
    frameworkStates.length
  );
}

export const db = {
  // ===== 会话管理 =====
  getSession: (id: string) => get<RecordingSession>("sessions", id),
  listSessions: async (limit = 10) =>
    (await listAll<RecordingSession>("sessions"))
      .sort(
        (left, right) =>
          right.timeline.createdAtEpochMs - left.timeline.createdAtEpochMs
      )
      .slice(0, Math.max(0, limit)),
  listSessionOverviews: async (query = ""): Promise<SessionOverview[]> => {
    // 关键词检索（标题/URL/状态/ID 任一命中）+ 按创建时间倒序；
    // 过期时间按 retentionDays 现算，用量优先取缓存、缺失时兜底实测
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
    // 会话收尾专用：同一事务内完成会话状态更新并清除活动标记，二者要么同时生效要么都回滚
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
    // 原子占用：仅当当前无活跃会话（或已有会话已结束）时抢注 active-session，
    // 防止 offscreen 与 background 并发启动导致双会话互相覆盖
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
              if (existing && ACTIVE_STATUSES.includes(existing.status)) {
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
    // 仅在当前活动会话匹配时才清除，避免误删后来者抢占的会话标记
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
    // 与 claimSession 同理：同一 start/stop 指令只被消费一次，防止重复处理
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
  // ===== 证据存取（*WithinBudget 走预算批量写入通道） =====
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
  saveFrameworkStateWithinBudget: (state: FrameworkStateEvidence) =>
    putWithinSessionBudget("frameworkStates", state),
  getFrameworkStates: async (sessionId: string) =>
    (
      await list<FrameworkStateEvidence>(
        "frameworkStates",
        "sessionId",
        sessionId
      )
    ).sort((left, right) => left.capturedAtEpochMs - right.capturedAtEpochMs),
  getMediaSummary,
  getMediaChunks: async (sessionId: string) =>
    (await list<MediaChunkRecord>("mediaChunks", "sessionId", sessionId)).sort(
      (left, right) => left.sequence - right.sequence
    ),
  iterateMediaChunks: async (
    sessionId: string,
    visitor: (chunk: MediaChunkRecord) => void | Promise<void>,
    batchSize = 128
  ) => {
    // 以 afterSequence 为游标分批拉取录像分片，逐片交给 visitor 处理后翻页，
    // 避免把大体积媒体数据一次性读入内存（导出/打包场景专用）
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
  // ===== 导出选择与导出产物（以 sessionId 为主键，每会话各存一份） =====
  getExportSelection: (sessionId: string) =>
    get<ExportSelection>("exportSelections", sessionId),
  saveExportSelection: (selection: ExportSelection) =>
    put("exportSelections", selection),
  getExportArtifact: (sessionId: string) =>
    get<ExportArtifact>("exportArtifacts", sessionId),
  saveExportArtifact: (artifact: ExportArtifact) =>
    put("exportArtifacts", artifact),
  // ===== 存储策略与用量总览 =====
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
    // 总用量 = 各会话用量之和；配额优先取浏览器 storage.estimate，失败时兜底为策略下限
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
  // ===== 会话清理 =====
  deleteSession: deleteSessionAndEvidence,
  cleanupExpiredSessions: async (now = Date.now()): Promise<string[]> => {
    // 按 retentionDays 清理过期会话，跳过仍处于活动状态的会话
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
    // 清空历史记录但保留活动会话，避免删除正在录制的数据
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
  | "saveFrameworkStateWithinBudget"
  | "getFrameworkStates"
  | "getMediaSummary"
  | "getMediaChunks"
  | "iterateMediaChunks"
>;
