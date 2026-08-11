/** 停止中会话 ID 的可选持久化适配器，用于跨 Service Worker 重启保留停止状态。 */
export type StoppingPersistence = {
  save(ids: string[]): void;
  load(): Promise<string[]>;
};

export class RecordingCoordinator {
  private lifecycleQueue: Promise<unknown> = Promise.resolve();
  private readonly stopFlights = new Map<string, Promise<unknown>>();
  private readonly stoppingSessionIds = new Set<string>();
  private readonly persistence?: StoppingPersistence;

  constructor(persistence?: StoppingPersistence) {
    this.persistence = persistence;
  }

  /** 从持久化存储恢复停止中的会话 ID（bootstrap 时调用一次，配合 background 恢复）。 */
  async restoreStoppingIds(): Promise<void> {
    if (!this.persistence) return;
    const ids = await this.persistence.load();
    for (const id of ids) this.stoppingSessionIds.add(id);
  }

  /** 全局串行队列：保证 start/stop 等生命周期操作按序执行、互不并发。 */
  runLifecycle<T>(work: () => Promise<T>): Promise<T> {
    const current = this.lifecycleQueue.catch(() => undefined).then(work);
    this.lifecycleQueue = current.catch(() => undefined);
    return current;
  }

  /**
   * 按 sessionId 合并并发 stop：同一会话的并发停止调用共用同一个 Promise，
   * 避免重复执行停止流程；完成后（成功或失败）自动从队列移除。
   */
  runStop<T>(sessionId: string, work: () => Promise<T>): Promise<T> {
    const existing = this.stopFlights.get(sessionId) as Promise<T> | undefined;
    if (existing) return existing;
    const flight = work();
    this.stopFlights.set(sessionId, flight);
    void flight.then(
      () => {
        if (this.stopFlights.get(sessionId) === flight)
          this.stopFlights.delete(sessionId);
      },
      () => {
        if (this.stopFlights.get(sessionId) === flight)
          this.stopFlights.delete(sessionId);
      }
    );
    return flight;
  }

  // 标记会话进入停止中并持久化；SW 重启后由 restoreStoppingIds 恢复，
  // 防止停止期间新到的交互/截图请求误写入该会话。
  beginStopping(sessionId: string): void {
    this.stoppingSessionIds.add(sessionId);
    this.persistStoppingIds();
  }

  finishStopping(sessionId: string): void {
    this.stoppingSessionIds.delete(sessionId);
    this.persistStoppingIds();
  }

  isStopping(sessionId: string): boolean {
    return this.stoppingSessionIds.has(sessionId);
  }

  private persistStoppingIds(): void {
    this.persistence?.save([...this.stoppingSessionIds]);
  }
}
