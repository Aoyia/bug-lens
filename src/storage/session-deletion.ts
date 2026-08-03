import { openEvidenceDatabase, type StoreName } from "./indexed-db-schema.ts";

export async function deleteSessionAndEvidence(
  sessionId: string
): Promise<boolean> {
  const database = await openEvidenceDatabase();
  return new Promise((resolve, reject) => {
    const stores: StoreName[] = [
      "sessions",
      "interactions",
      "consoleEntries",
      "networkEntries",
      "mediaChunks",
      "exportSelections",
      "exportArtifacts",
      "issueScenes",
      "evidenceAssets",
      "control",
    ];
    const transaction = database.transaction(stores, "readwrite");
    let existed = false;
    const sessions = transaction.objectStore("sessions");
    const sessionRequest = sessions.get(sessionId);
    sessionRequest.onsuccess = () => {
      existed = Boolean(sessionRequest.result);
      sessions.delete(sessionId);
    };
    sessionRequest.onerror = () => reject(sessionRequest.error);
    for (const storeName of [
      "interactions",
      "consoleEntries",
      "networkEntries",
      "mediaChunks",
      "issueScenes",
      "evidenceAssets",
    ] as const) {
      const cursorRequest = transaction
        .objectStore(storeName)
        .index("sessionId")
        .openKeyCursor(IDBKeyRange.only(sessionId));
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) return;
        transaction.objectStore(storeName).delete(cursor.primaryKey);
        cursor.continue();
      };
      cursorRequest.onerror = () => reject(cursorRequest.error);
    }
    transaction.objectStore("exportSelections").delete(sessionId);
    transaction.objectStore("exportArtifacts").delete(sessionId);
    const activeRequest = transaction
      .objectStore("control")
      .get("active-session");
    activeRequest.onsuccess = () => {
      if (activeRequest.result?.sessionId === sessionId)
        transaction.objectStore("control").delete("active-session");
    };
    activeRequest.onerror = () => reject(activeRequest.error);
    transaction.oncomplete = () => resolve(existed);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("会话删除事务已中止"));
  });
}
