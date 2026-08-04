import { estimateBytes } from "../domain/storage-policy.ts";
import type { RecordingSession } from "../shared/protocol.ts";
import { openEvidenceDatabase, type StoreName } from "./indexed-db-schema.ts";

export type BudgetWriteResult = {
  stored: boolean;
  usedBytes: number;
  limitReached: boolean;
};
export type StorageBudgetListener = (
  sessionId: string,
  result: BudgetWriteResult
) => void;
let budgetListener: StorageBudgetListener | undefined;

export function setStorageBudgetListener(
  listener: StorageBudgetListener | undefined
): void {
  budgetListener = listener;
}

export async function putWithinSessionBudget<T extends { sessionId: string }>(
  storeName: StoreName,
  value: T
): Promise<BudgetWriteResult> {
  return batchPutWithinSessionBudget(storeName, value);
}

type PendingBatchItem<T> = {
  storeName: StoreName;
  value: T;
  resolve: (result: BudgetWriteResult) => void;
  reject: (error: unknown) => void;
};

const BATCH_INTERVAL_MS = 200;
let pendingBatchQueue: PendingBatchItem<any>[] = [];
let batchTimer: ReturnType<typeof setTimeout> | undefined;

export function flushStorageBatchQueue(): Promise<void> {
  if (batchTimer) {
    clearTimeout(batchTimer);
    batchTimer = undefined;
  }
  if (pendingBatchQueue.length === 0) {
    return Promise.resolve();
  }
  const itemsToFlush = pendingBatchQueue;
  pendingBatchQueue = [];
  return executeBatchPut(itemsToFlush);
}

function batchPutWithinSessionBudget<T extends { sessionId: string }>(
  storeName: StoreName,
  value: T
): Promise<BudgetWriteResult> {
  return new Promise((resolve, reject) => {
    pendingBatchQueue.push({ storeName, value, resolve, reject });
    if (!batchTimer) {
      batchTimer = setTimeout(() => {
        batchTimer = undefined;
        flushStorageBatchQueue().catch(() => {});
      }, BATCH_INTERVAL_MS);
    }
  });
}

async function executeBatchPut(items: PendingBatchItem<any>[]): Promise<void> {
  if (items.length === 0) return;

  const database = await openEvidenceDatabase();

  const storeNameSet = new Set<StoreName>();
  for (const item of items) {
    storeNameSet.add(item.storeName);
  }
  storeNameSet.add("sessions");
  const storeNames = Array.from(storeNameSet);

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeNames, "readwrite");
    const sessionsStore = transaction.objectStore("sessions");

    const sessionCache = new Map<
      string,
      { session: RecordingSession; updated: boolean }
    >();
    const itemResults: Array<{
      item: PendingBatchItem<any>;
      result: BudgetWriteResult;
    }> = [];

    let hasError = false;

    const processItem = (index: number) => {
      if (index >= items.length) return;
      const item = items[index];
      const { storeName, value } = item;
      const sessionId = value.sessionId;

      const continueWithSession = (session: RecordingSession | undefined) => {
        if (!session) {
          itemResults.push({
            item,
            result: { stored: false, usedBytes: 0, limitReached: false },
          });
          processItem(index + 1);
          return;
        }

        const store = transaction.objectStore(storeName);
        const key = (value as { id?: IDBValidKey }).id ?? value.sessionId;
        const valueRequest = store.get(key);

        valueRequest.onsuccess = () => {
          const previous = valueRequest.result;
          const delta = Math.max(
            0,
            estimateBytes(value) - estimateBytes(previous)
          );
          const usedBytes = session.storage?.usedBytes ?? 0;

          if (usedBytes + delta > session.options.maxSessionBytes) {
            session.storage = { usedBytes, limitReached: true };
            sessionsStore.put(session);
            itemResults.push({
              item,
              result: { stored: false, usedBytes, limitReached: true },
            });
            processItem(index + 1);
            return;
          }

          const nextUsedBytes = Math.max(
            0,
            usedBytes + estimateBytes(value) - estimateBytes(previous)
          );
          const isNearLimit =
            nextUsedBytes >= session.options.maxSessionBytes * 0.9;
          store.put(value);

          session.storage = {
            usedBytes: nextUsedBytes,
            limitReached: isNearLimit,
          };
          sessionCache.set(sessionId, { session, updated: true });
          sessionsStore.put(session);

          itemResults.push({
            item,
            result: {
              stored: true,
              usedBytes: nextUsedBytes,
              limitReached: isNearLimit,
            },
          });
          processItem(index + 1);
        };

        valueRequest.onerror = () => {
          hasError = true;
          item.reject(valueRequest.error);
          processItem(index + 1);
        };
      };

      const cached = sessionCache.get(sessionId);
      if (cached) {
        continueWithSession(cached.session);
      } else {
        const sessionRequest = sessionsStore.get(sessionId);
        sessionRequest.onsuccess = () => {
          const session = sessionRequest.result as RecordingSession | undefined;
          if (session) {
            sessionCache.set(sessionId, {
              session: { ...session },
              updated: false,
            });
          }
          continueWithSession(sessionCache.get(sessionId)?.session);
        };
        sessionRequest.onerror = () => {
          hasError = true;
          item.reject(sessionRequest.error);
          processItem(index + 1);
        };
      }
    };

    processItem(0);

    transaction.oncomplete = () => {
      for (const { item, result } of itemResults) {
        if (budgetListener) {
          budgetListener(item.value.sessionId, result);
        }
        item.resolve(result);
      }
      resolve();
    };

    transaction.onerror = () => {
      const err = transaction.error ?? new Error("证据批量写入事务出错");
      if (!hasError) {
        for (const item of items) {
          item.reject(err);
        }
      }
      reject(err);
    };

    transaction.onabort = () => {
      const err = transaction.error ?? new Error("证据批量写入事务已中止");
      if (!hasError) {
        for (const item of items) {
          item.reject(err);
        }
      }
      reject(err);
    };
  });
}
