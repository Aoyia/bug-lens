import { estimateBytes } from "../domain/storage-policy.ts";
import type { RecordingSession } from "../shared/protocol.ts";
import { openEvidenceDatabase, type StoreName } from "./indexed-db-schema.ts";

export type BudgetWriteResult = { stored: boolean; usedBytes: number; limitReached: boolean };
export type StorageBudgetListener = (sessionId: string, result: BudgetWriteResult) => void;
let budgetListener: StorageBudgetListener | undefined;

export function setStorageBudgetListener(listener: StorageBudgetListener | undefined): void {
  budgetListener = listener;
}

export async function putWithinSessionBudget<T extends { sessionId: string }>(storeName: StoreName, value: T): Promise<BudgetWriteResult> {
  const database = await openEvidenceDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([storeName, "sessions"], "readwrite");
    const store = transaction.objectStore(storeName);
    const sessions = transaction.objectStore("sessions");
    let result: BudgetWriteResult | undefined;
    const sessionRequest = sessions.get(value.sessionId);
    sessionRequest.onsuccess = () => {
      const session = sessionRequest.result as RecordingSession | undefined;
      if (!session) {
        result = { stored: false, usedBytes: 0, limitReached: false };
        return;
      }
      const valueRequest = store.get((value as { id?: IDBValidKey }).id ?? value.sessionId);
      valueRequest.onsuccess = () => {
        const previous = valueRequest.result;
        const delta = Math.max(0, estimateBytes(value) - estimateBytes(previous));
        const usedBytes = session.storage?.usedBytes ?? 0;
        if (usedBytes + delta > session.options.maxSessionBytes) {
          sessions.put({ ...session, storage: { usedBytes, limitReached: true } });
          result = { stored: false, usedBytes, limitReached: true };
          return;
        }
        const nextUsedBytes = Math.max(0, usedBytes + estimateBytes(value) - estimateBytes(previous));
        const isNearLimit = nextUsedBytes >= session.options.maxSessionBytes * 0.9;
        store.put(value);
        sessions.put({ ...session, storage: { usedBytes: nextUsedBytes, limitReached: isNearLimit } });
        result = { stored: true, usedBytes: nextUsedBytes, limitReached: isNearLimit };
      };
      valueRequest.onerror = () => reject(valueRequest.error);
    };
    sessionRequest.onerror = () => reject(sessionRequest.error);
    transaction.oncomplete = () => {
      if (result) {
        if (budgetListener) budgetListener(value.sessionId, result);
        resolve(result);
      } else {
        reject(new Error("证据写入事务未产生结果"));
      }
    };
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("证据写入事务已中止"));
  });
}
