/** Optional persistence adapter for stopping state survival across SW restarts. */
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

  /** Restore stopping IDs from persistent storage (call once during bootstrap). */
  async restoreStoppingIds(): Promise<void> {
    if (!this.persistence) return;
    const ids = await this.persistence.load();
    for (const id of ids) this.stoppingSessionIds.add(id);
  }

  runLifecycle<T>(work: () => Promise<T>): Promise<T> {
    const current = this.lifecycleQueue.catch(() => undefined).then(work);
    this.lifecycleQueue = current.catch(() => undefined);
    return current;
  }

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
