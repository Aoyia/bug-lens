import { openEvidenceDatabase, type StoreName } from "./indexed-db-schema.ts";

/**
 * 单事务删除会话及其全部证据：一次 readwrite 事务覆盖 10 个 store，
 * 要么全部删除成功、要么整体回滚，避免残留半删除状态。
 */
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
    // 证据明细类 store 没有以 sessionId 为主键，需经 sessionId 索引用 openKeyCursor 遍历逐个删除
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
    // 若删除的正是活动会话，需同步清理 control.active-session 标记，避免悬空引用
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
