import type { ConsoleEntry, ExportArtifact, ExportSelection, InteractionRecord, NetworkEntry, RecordingSession } from "../shared/protocol";

const DB_NAME = "web-bug-recorder";
const DB_VERSION = 4;
type StoreName = "control" | "sessions" | "interactions" | "consoleEntries" | "networkEntries" | "mediaChunks" | "exportSelections" | "exportArtifacts";

let openPromise: Promise<IDBDatabase> | undefined;
function openDb(): Promise<IDBDatabase> {
  if (openPromise) return openPromise;
  openPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      const transaction = request.transaction;
      if (!transaction) throw new Error("IndexedDB migration transaction unavailable");
      const ensureStore = (name: StoreName, keyPath: string, indexes: Array<{ name: string; keyPath: string }> = []) => {
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
      ensureStore("mediaChunks", "id", [{ name: "sessionId", keyPath: "sessionId" }]);
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

export const db = {
  getSession: (id: string) => get<RecordingSession>("sessions", id),
  saveSession: (session: RecordingSession) => put("sessions", session),
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
      const currentReq = control.get("active-session");
      currentReq.onsuccess = () => {
        const current = currentReq.result as { sessionId?: string } | undefined;
        if (current?.sessionId) {
          const existingReq = sessions.get(current.sessionId);
          existingReq.onsuccess = () => resolve({ session: existingReq.result as RecordingSession, claimed: false });
          existingReq.onerror = () => reject(existingReq.error);
          return;
        }
        sessions.put(session);
        control.put({ key: "active-session", sessionId: session.id });
        resolve({ session, claimed: true });
      };
      tx.onerror = () => reject(tx.error);
    });
  },
  clearActive: async (sessionId: string) => {
    const current = await get<{ key: string; sessionId?: string }>("control", "active-session");
    if (current?.sessionId === sessionId) {
      const dbInstance = await openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = dbInstance.transaction("control", "readwrite");
        tx.objectStore("control").delete("active-session");
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }
  },
  saveInteraction: (record: InteractionRecord) => put("interactions", record),
  getInteractions: (sessionId: string) => list<InteractionRecord>("interactions", "sessionId", sessionId),
  saveConsole: (entry: ConsoleEntry) => put("consoleEntries", entry),
  getConsole: (sessionId: string) => list<ConsoleEntry>("consoleEntries", "sessionId", sessionId),
  saveNetwork: (entry: NetworkEntry) => put("networkEntries", entry),
  getNetwork: (sessionId: string) => list<NetworkEntry>("networkEntries", "sessionId", sessionId),
  saveMediaChunk: (chunk: { id: string; sessionId: string; sequence: number; recordedAt: number; mimeType: string; chunk: ArrayBuffer }) => put("mediaChunks", chunk),
  getMediaChunks: (sessionId: string) => list<{ id: string; sequence: number; recordedAt: number; mimeType: string; chunk: ArrayBuffer }>("mediaChunks", "sessionId", sessionId),
  getExportSelection: (sessionId: string) => get<ExportSelection>("exportSelections", sessionId),
  saveExportSelection: (selection: ExportSelection) => put("exportSelections", selection),
  getExportArtifact: (sessionId: string) => get<ExportArtifact>("exportArtifacts", sessionId),
  saveExportArtifact: (artifact: ExportArtifact) => put("exportArtifacts", artifact)
};
