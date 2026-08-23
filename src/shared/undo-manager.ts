export interface UndoManagerOptions<T> {
  limit?: number;
  clone?: (state: T) => T;
}

function defaultClone<T>(state: T): T {
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(state);
    } catch {
      return JSON.parse(JSON.stringify(state));
    }
  }
  return JSON.parse(JSON.stringify(state));
}

/**
 * 泛型撤销/重做管理器（Deep Module）
 * 支持快照记录、撤销、重做、容量上限控制与重置。
 * 兼容原有既有撤销语义（列表非空时 pop 最后一个元素并暂存快照；列表为空时回退快照栈）。
 */
export class UndoManager<T> {
  private stack: T[] = [];
  private future: T[] = [];
  private readonly limit: number;
  private readonly cloneFn: (state: T) => T;

  constructor(options?: UndoManagerOptions<T>) {
    this.limit = options?.limit ?? 30;
    this.cloneFn = options?.clone ?? defaultClone;
  }

  get canUndo(): boolean {
    return this.stack.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  get historySize(): number {
    return this.stack.length;
  }

  /**
   * 记录一次新的状态快照（上限 limit），并清空未来重做栈
   */
  record(state: T): void {
    this.stack.push(this.cloneFn(state));
    if (this.stack.length > this.limit) {
      this.stack.shift();
    }
    this.future = [];
  }

  /**
   * 执行一次撤销，返回新的状态（调用方负责重新赋值与重绘）：
   * - 列表非空（若为数组）：先记录当前快照，将当前状态暂存进 future，再移除最后一个元素；
   * - 列表为空或普通对象：从历史快照栈中弹出最近一次快照，并将当前状态存入 future 栈。
   */
  undo(currentState: T): T {
    if (Array.isArray(currentState) && currentState.length > 0) {
      this.future.push(this.cloneFn(currentState));
      this.stack.push(this.cloneFn(currentState));
      if (this.stack.length > this.limit) {
        this.stack.shift();
      }
      return currentState.slice(0, -1) as unknown as T;
    }

    if (this.stack.length > 0) {
      const prev = this.stack.pop();
      if (prev !== undefined) {
        this.future.push(this.cloneFn(currentState));
        return prev;
      }
    }
    return currentState;
  }

  /**
   * 执行一次重做：
   * 从 future 栈弹出最近一次撤销掉的状态，将 currentState 暂存进 stack。
   */
  redo(currentState: T): T {
    if (this.future.length > 0) {
      const next = this.future.pop();
      if (next !== undefined) {
        this.stack.push(this.cloneFn(currentState));
        if (this.stack.length > this.limit) {
          this.stack.shift();
        }
        return next;
      }
    }
    return currentState;
  }

  /**
   * 清空所有撤销与重做快照
   */
  reset(): void {
    this.stack = [];
    this.future = [];
  }
}
