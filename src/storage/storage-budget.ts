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
/** 待批量写入队列（Promise 形式挂起，等待合并窗口关闭后统一处理）。 */
let pendingBatchQueue: PendingBatchItem<any>[] = [];
let batchTimer: ReturnType<typeof setTimeout> | undefined;

/** 立即清空队列并执行批量写入；通常由页面可见性切换等时机显式触发，避免数据滞留。 */
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
    // 入队并延迟启动计时器：同一窗口内的后续写入复用该计时器，从而批量合并
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

  // 合并涉及的 store 并强制加入 sessions：预算计算与用量回写都落在该 store 上
  const storeNameSet = new Set<StoreName>();
  for (const item of items) {
    storeNameSet.add(item.storeName);
  }
  storeNameSet.add("sessions");
  const storeNames = Array.from(storeNameSet);

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeNames, "readwrite");
    const sessionsStore = transaction.objectStore("sessions");

    // 会话缓存：同一批内多次写入同一会话时复用内存中的用量快照，避免重复读库
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
          // 会话不存在则视为未存储（不写证据、不计预算）
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
          // 增量预算：只按「新值 - 旧值」的字节差计费，重复写入不重复累计
          const delta = Math.max(
            0,
            estimateBytes(value) - estimateBytes(previous)
          );
          const usedBytes = session.storage?.usedBytes ?? 0;

          if (usedBytes + delta > session.options.maxSessionBytes) {
            // 超出会话预算：拒绝写入并标记 limitReached，由上层决定是否提醒用户
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
          // 用量达到预算 90% 即标记 near-limit，提前预警而非等到完全拒绝
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

    // 事务成功提交后才统一 resolve：保证调用方拿到的结果对应的是已落盘状态
    transaction.oncomplete = () => {
      for (const { item, result } of itemResults) {
        // 通过全局监听器广播每个写入的预算结果（供存储健康协调通知 UI）
        if (budgetListener) {
          budgetListener(item.value.sessionId, result);
        }
        item.resolve(result);
      }
      resolve();
    };

    transaction.onerror = () => {
      const err = transaction.error ?? new Error("证据批量写入事务出错");
      // 仅当尚无单项错误被上报时统一兜底 reject，避免同一批次重复拒绝
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
