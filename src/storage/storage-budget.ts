import { DevProfiler } from "../shared/dev-profiler.ts";
import { estimateBytes } from "../domain/storage-policy.ts";
import type { RecordingSession } from "../shared/protocol.ts";
import {
  closeEvidenceDatabase,
  openEvidenceDatabase,
  type StoreName,
} from "./indexed-db-schema.ts";
import { t } from "../shared/i18n.ts";

export type BudgetWriteResult = {
  stored: boolean;
  usedBytes: number;
  limitReached: boolean;
};
export type StorageBudgetListener = (
  sessionId: string,
  result: BudgetWriteResult
) => void;
/** 全局唯一的预算写入结果监听器（供存储健康协调模块订阅）。 */
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

/**
 * 批量合并窗口：高频证据写入（如交互/网络事件）在 200ms 内并入同一事务，
 * 将大量小事务合并为少量事务，显著降低 IndexedDB 提交开销。
 */
const BATCH_INTERVAL_MS = 200;
/** 单事务分片最大条目数：避免单个巨型事务长时间垄断锁表导致查询饥饿。 */
const MAX_BATCH_SIZE = 100;
/** 待批量写入队列（Promise 形式挂起，等待合并窗口关闭后统一处理）。 */
let pendingBatchQueue: PendingBatchItem<any>[] = [];
let batchTimer: ReturnType<typeof setTimeout> | undefined;
let activeFlushPromise: Promise<void> = Promise.resolve();

/** 立即清空队列并执行批量写入；通常由页面可见性切换等时机显式触发，避免数据滞留。 */
export function flushStorageBatchQueue(): Promise<void> {
  if (batchTimer) {
    clearTimeout(batchTimer);
    batchTimer = undefined;
  }
  if (pendingBatchQueue.length === 0) {
    return activeFlushPromise;
  }
  const itemsToFlush = pendingBatchQueue;
  pendingBatchQueue = [];
  const currentFlush = activeFlushPromise
    .catch(() => {})
    .then(() => executeBatchPut(itemsToFlush));
  activeFlushPromise = currentFlush;
  return currentFlush;
}

function batchPutWithinSessionBudget<T extends { sessionId: string }>(
  storeName: StoreName,
  value: T
): Promise<BudgetWriteResult> {
  return new Promise((resolve, reject) => {
    // 入队并延迟启动计时器：同一窗口内的后续写入复用该计时器，从而批量合并
    pendingBatchQueue.push({ storeName, value, resolve, reject });
    if (pendingBatchQueue.length >= MAX_BATCH_SIZE) {
      if (batchTimer) {
        clearTimeout(batchTimer);
        batchTimer = undefined;
      }
      flushStorageBatchQueue().catch(() => {});
    } else if (!batchTimer) {
      batchTimer = setTimeout(() => {
        batchTimer = undefined;
        flushStorageBatchQueue().catch(() => {});
      }, BATCH_INTERVAL_MS);
    }
  });
}

async function executeBatchPut(items: PendingBatchItem<any>[]): Promise<void> {
  if (items.length === 0) return;

  for (let i = 0; i < items.length; i += MAX_BATCH_SIZE) {
    const chunk = items.slice(i, i + MAX_BATCH_SIZE);
    try {
      await executeBatchChunk(chunk);
    } catch {
      // 分片异常已在事务级别 reject 给对应 item，此处继续消化后续分片
    }
    if (i + MAX_BATCH_SIZE < items.length) {
      // 分片之间 yield 事件循环，给读取和其他并发事务释放调度窗口
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
}

async function executeBatchChunk(
  chunk: PendingBatchItem<any>[]
): Promise<void> {
  if (chunk.length === 0) return;

  const endBatchTimer = DevProfiler.time(
    `IndexedDB 批量分片写入 (${chunk.length} 条记录)`
  );
  let database: IDBDatabase;
  try {
    database = await openEvidenceDatabase();
  } catch (err) {
    for (const item of chunk) {
      item.reject(err);
    }
    throw err;
  }

  // Store 粒度隔离：仅锁定当前分片实际涉及的 Object Stores + sessions
  const storeNameSet = new Set<StoreName>();
  for (const item of chunk) {
    storeNameSet.add(item.storeName);
  }
  storeNameSet.add("sessions");
  const storeNames = Array.from(storeNameSet);

  return new Promise((resolve, reject) => {
    let transaction: IDBTransaction;
    try {
      transaction = database.transaction(storeNames, "readwrite");
    } catch (err) {
      closeEvidenceDatabase();
      for (const item of chunk) {
        item.reject(err);
      }
      reject(err);
      return;
    }
    const sessionsStore = transaction.objectStore("sessions");

    // 会话缓存：同一分片内多次写入同一会话时复用内存中的用量快照，避免重复读库
    const sessionCache = new Map<
      string,
      { session: RecordingSession; updated: boolean }
    >();
    const itemResults: Array<{
      item: PendingBatchItem<any>;
      result: BudgetWriteResult;
    }> = [];
    const failedItemIndices = new Set<number>();

    let hasError = false;

    const finishChunk = (previousValues: any[]) => {
      for (let j = 0; j < chunk.length; j++) {
        if (failedItemIndices.has(j)) continue;

        const it = chunk[j];
        const prev = previousValues[j];
        const cached = it.value?.sessionId
          ? sessionCache.get(it.value.sessionId)
          : undefined;
        const session = cached?.session;

        if (!session) {
          itemResults.push({
            item: it,
            result: { stored: false, usedBytes: 0, limitReached: false },
          });
          continue;
        }

        const delta = Math.max(
          0,
          estimateBytes(it.value) - estimateBytes(prev)
        );
        const usedBytes = session.storage?.usedBytes ?? 0;

        if (usedBytes + delta > session.options.maxSessionBytes) {
          session.storage = { usedBytes, limitReached: true };
          cached.updated = true;
          itemResults.push({
            item: it,
            result: { stored: false, usedBytes, limitReached: true },
          });
          continue;
        }

        const nextUsedBytes = Math.max(0, usedBytes + delta);
        const isNearLimit =
          nextUsedBytes >= session.options.maxSessionBytes * 0.9;
        try {
          const s = transaction.objectStore(it.storeName);
          s.put(it.value);
        } catch (err) {
          hasError = true;
          it.reject(err);
          failedItemIndices.add(j);
          continue;
        }

        session.storage = {
          usedBytes: nextUsedBytes,
          limitReached: isNearLimit,
        };
        cached.updated = true;

        itemResults.push({
          item: it,
          result: {
            stored: true,
            usedBytes: nextUsedBytes,
            limitReached: isNearLimit,
          },
        });
      }

      // 会话用量单次回写：单批次全部完成时才对有变动的会话执行一次 sessionsStore.put
      for (const { session, updated } of sessionCache.values()) {
        if (updated) {
          try {
            sessionsStore.put(session);
          } catch {
            hasError = true;
          }
        }
      }
    };

    const startProcessingItems = () => {
      let pendingGets = 0;
      const previousValues = new Array(chunk.length);

      for (let i = 0; i < chunk.length; i++) {
        const item = chunk[i];
        // 仅可能存在“更新旧记录”的 Store（如网络请求体补全、导出态更新）需要读取旧值以计算增量；
        // 纯追加写入的 Store（日志、交互、媒体分片、框架状态）每条记录 ID 均为新 UUID，旧值必为 undefined，直接跳过 get
        if (
          item.storeName === "networkEntries" ||
          item.storeName === "exportSelections" ||
          item.storeName === "exportArtifacts"
        ) {
          const key =
            (item.value as { id?: IDBValidKey }).id ?? item.value.sessionId;
          if (key == null) {
            continue;
          }

          pendingGets++;
          try {
            const store = transaction.objectStore(item.storeName);
            const req = store.get(key);

            req.onsuccess = () => {
              previousValues[i] = req.result;
              pendingGets--;
              if (pendingGets === 0) {
                finishChunk(previousValues);
              }
            };

            req.onerror = (event) => {
              event.preventDefault();
              event.stopPropagation();
              hasError = true;
              item.reject(req.error);
              failedItemIndices.add(i);
              pendingGets--;
              if (pendingGets === 0) {
                finishChunk(previousValues);
              }
            };
          } catch (err) {
            hasError = true;
            item.reject(err);
            failedItemIndices.add(i);
            pendingGets--;
            if (pendingGets === 0) {
              finishChunk(previousValues);
            }
          }
        }
      }

      if (pendingGets === 0) {
        finishChunk(previousValues);
      }
    };

    const sessionIds = Array.from(
      new Set(
        chunk
          .map((it) => it.value?.sessionId)
          .filter(
            (sid): sid is string => typeof sid === "string" && sid.length > 0
          )
      )
    );

    if (sessionIds.length === 0) {
      startProcessingItems();
    } else {
      let loadedSessions = 0;
      for (const sid of sessionIds) {
        try {
          const sReq = sessionsStore.get(sid);
          sReq.onsuccess = () => {
            const s = sReq.result as RecordingSession | undefined;
            if (s) {
              sessionCache.set(sid, { session: { ...s }, updated: false });
            }
            loadedSessions++;
            if (loadedSessions === sessionIds.length) {
              startProcessingItems();
            }
          };
          sReq.onerror = (event) => {
            event.preventDefault();
            event.stopPropagation();
            hasError = true;
            loadedSessions++;
            if (loadedSessions === sessionIds.length) {
              startProcessingItems();
            }
          };
        } catch {
          hasError = true;
          loadedSessions++;
          if (loadedSessions === sessionIds.length) {
            startProcessingItems();
          }
        }
      }
    }

    // 事务成功提交后才统一 resolve：保证调用方拿到的结果对应的是已落盘状态
    transaction.oncomplete = () => {
      endBatchTimer({
        分片写入条数: chunk.length,
        "参与 Store": storeNames.join(", "),
      });
      for (const { item, result } of itemResults) {
        // 通过全局监听器广播每个写入的预算结果（供存储健康协调通知 UI）
        if (budgetListener && item.value?.sessionId) {
          budgetListener(item.value.sessionId, result);
        }
        item.resolve(result);
      }
      resolve();
    };

    transaction.onerror = () => {
      const err = transaction.error ?? new Error(t("evidenceBatchWriteError"));
      for (const item of chunk) {
        item.reject(err);
      }
      reject(err);
    };

    transaction.onabort = () => {
      const err =
        transaction.error ?? new Error(t("evidenceBatchWriteAborted"));
      for (const item of chunk) {
        item.reject(err);
      }
      reject(err);
    };
  });
}
