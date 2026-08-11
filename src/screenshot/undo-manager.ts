import type { AnnotationItem } from "../domain/screenshot-payload.ts";

/**
 * 撤销栈：完全复刻既有撤销语义（pop 优先 + 快照回退），
 * 但深拷贝入栈、逻辑单点收敛。行为与旧实现逐字节等价。
 */
export class UndoManager {
  private stack: AnnotationItem[][] = [];

  /** 记录当前批注列表的深拷贝快照（上限 30，与旧实现一致） */
  record(annotations: AnnotationItem[]): void {
    this.stack.push(JSON.parse(JSON.stringify(annotations)));
    if (this.stack.length > 30) {
      this.stack.shift();
    }
  }

  /**
   * 执行一次撤销，返回新的批注列表（调用方负责重新赋值与重绘）：
   * - 列表非空：先记录当前快照，再移除最后一个元素；
   * - 列表为空：回退最近一次快照（若无快照则原样返回）。
   */
  undo(annotations: AnnotationItem[]): AnnotationItem[] {
    if (annotations.length > 0) {
      this.record(annotations);
      return annotations.slice(0, -1);
    }
    if (this.stack.length > 0) {
      const prev = this.stack.pop();
      if (prev) return prev;
    }
    return annotations;
  }

  reset(): void {
    this.stack = [];
  }
}
