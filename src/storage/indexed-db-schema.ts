/** 证据库名称：Bug Lens 全部录制证据统一存放在该 IndexedDB 中。 */
const DB_NAME = "web-bug-recorder";
/** 库版本号：每次新增/修改 store 或索引时递增，触发 onupgradeneeded 迁移。 */
const DB_VERSION = 7;

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
  | "evidenceAssets"
  | "frameworkStates";

/** 复用已打开的连接：避免并发调用 openEvidenceDatabase 触发多次 open。 */
let openPromise: Promise<IDBDatabase> | undefined;

export function openEvidenceDatabase(): Promise<IDBDatabase> {
  if (openPromise) return openPromise;
  openPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      const transaction = request.transaction;
      if (!transaction) throw new Error("IndexedDB 数据库升级/迁移事务不可用");
      /** 幂等建表：store 或索引已存在时跳过创建，保证升级脚本可重复执行。 */
      const ensureStore = (
        name: StoreName,
        keyPath: string,
        indexes: Array<{ name: string; keyPath: string | string[] }> = []
      ) => {
        const store = database.objectStoreNames.contains(name)
          ? transaction.objectStore(name)
          : database.createObjectStore(name, { keyPath });
        for (const index of indexes) {
          if (!store.indexNames.contains(index.name))
            store.createIndex(index.name, index.keyPath);
        }
      };
      // 控制键值区：active-session、command:*、storage-policy 等全局状态
      ensureStore("control", "key");
      // 会话主记录：含 storage 用量缓存与 retentionDays 过期依据
      ensureStore("sessions", "id", [{ name: "status", keyPath: "status" }]);
      // 证据明细区：均按 sessionId 建索引，供按会话聚合与清理
      ensureStore("interactions", "id", [
        { name: "sessionId", keyPath: "sessionId" },
      ]);
      ensureStore("consoleEntries", "id", [
        { name: "sessionId", keyPath: "sessionId" },
      ]);
      ensureStore("networkEntries", "id", [
        { name: "sessionId", keyPath: "sessionId" },
      ]);
      // 录像分片：sessionIdSequence 复合索引支持按序游标分页读取
      ensureStore("mediaChunks", "id", [
        { name: "sessionId", keyPath: "sessionId" },
        { name: "sessionIdSequence", keyPath: ["sessionId", "sequence"] },
      ]);
      // 导出态：以 sessionId 为主键，每会话至多一份
      ensureStore("exportSelections", "sessionId");
      ensureStore("exportArtifacts", "sessionId");
      // 问题现场与证据资产：现场按时间排序，资产可经 issueSceneId 关联
      ensureStore("issueScenes", "id", [
        { name: "sessionId", keyPath: "sessionId" },
        {
          name: "sessionIdObservedAt",
          keyPath: ["sessionId", "observedAtEpochMs"],
        },
      ]);
      ensureStore("evidenceAssets", "id", [
        { name: "sessionId", keyPath: "sessionId" },
        { name: "issueSceneId", keyPath: "issueSceneId" },
      ]);
      // 框架状态帧（React/Vue 组件树快照）：按捕获时间排序
      ensureStore("frameworkStates", "id", [
        { name: "sessionId", keyPath: "sessionId" },
        {
          name: "sessionIdCapturedAt",
          keyPath: ["sessionId", "capturedAtEpochMs"],
        },
      ]);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return openPromise;
}
