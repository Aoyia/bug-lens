export class RecordingCoordinator {
  private lifecycleQueue: Promise<unknown> = Promise.resolve();
  private readonly stopFlights = new Map<string, Promise<unknown>>();
  private readonly stoppingSessionIds = new Set<string>();

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
      () => { if (this.stopFlights.get(sessionId) === flight) this.stopFlights.delete(sessionId); },
      () => { if (this.stopFlights.get(sessionId) === flight) this.stopFlights.delete(sessionId); }
    );
    return flight;
  }

  beginStopping(sessionId: string): void {
    this.stoppingSessionIds.add(sessionId);
  }

  finishStopping(sessionId: string): void {
    this.stoppingSessionIds.delete(sessionId);
  }

  isStopping(sessionId: string): boolean {
    return this.stoppingSessionIds.has(sessionId);
  }
}
