import { UndoManager as GenericUndoManager } from "../shared/undo-manager.ts";
import type { AnnotationItem } from "../domain/screenshot-payload.ts";

/**
 * 撤销栈：封装通用 UndoManager<AnnotationItem[]> 并保持与既有调用点和语义向前兼容。
 */
export class UndoManager extends GenericUndoManager<AnnotationItem[]> {
  constructor() {
    super({ limit: 30 });
  }
}
