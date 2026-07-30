const DB_NAME = "web-bug-recorder";
const DB_VERSION = 6;

export type StoreName =
  | "control"
  | "sessions"
  | "interactions"
  | "consoleEntries"
  | "networkEntries"
  | "mediaChunks"
  | "exportSelections"
  | "exportArtifacts"
  | "issueScenes"
  | "evidenceAssets";

let openPromise: Promise<IDBDatabase> | undefined;

export function openEvidenceDatabase(): Promise<IDBDatabase> {
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
      ensureStore("issueScenes", "id", [
        { name: "sessionId", keyPath: "sessionId" },
        { name: "sessionIdObservedAt", keyPath: ["sessionId", "observedAtEpochMs"] }
      ]);
      ensureStore("evidenceAssets", "id", [
        { name: "sessionId", keyPath: "sessionId" },
        { name: "issueSceneId", keyPath: "issueSceneId" }
      ]);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return openPromise;
}
