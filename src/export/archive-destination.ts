import type { ArchiveSink } from "./export-pipeline";

export type TemporaryArchive = {
  sink: ArchiveSink;
  getFile(): Promise<File>;
  cleanup(): Promise<void>;
  storage: "opfs" | "memory";
};

// 内存兜底实现：OPFS 不可用时把 ZIP 字节暂存于内存数组
function memoryArchive(filename: string): TemporaryArchive {
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let closed = false;
  return {
    storage: "memory",
    sink: {
      async write(chunk) {
        if (closed) throw new Error("ARCHIVE_SINK_CLOSED");
        chunks.push(chunk);
      },
      async close() {
        closed = true;
      },
      async abort() {
        closed = true;
        chunks.length = 0;
      },
    },
    async getFile() {
      // 仅允许在 close 之后取文件，保证返回的是完整 ZIP
      if (!closed) throw new Error("ARCHIVE_SINK_NOT_CLOSED");
      return new File(chunks, filename, { type: "application/zip" });
    },
    async cleanup() {
      chunks.length = 0;
    },
  };
}

export async function createTemporaryArchive(
  filename: string
): Promise<TemporaryArchive> {
  // 环境不支持 OPFS（如非安全上下文）时直接回退内存
  if (!navigator.storage?.getDirectory) return memoryArchive(filename);
  try {
    // OPFS 路径：专用目录 + 随机 UUID 文件名，规避并发导出时的命名冲突
    const root = await navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle("bug-lens-exports", {
      create: true,
    });
    const temporaryName = `${crypto.randomUUID()}.zip`;
    const handle = await directory.getFileHandle(temporaryName, {
      create: true,
    });
    // createWritable 支持流式写入，逐块落盘无需整包驻留内存
    const writable = await handle.createWritable();
    let closed = false;
    return {
      storage: "opfs",
      sink: {
        async write(chunk) {
          if (closed) throw new Error("ARCHIVE_SINK_CLOSED");
          await writable.write(chunk);
        },
        async close() {
          if (closed) return;
          closed = true;
          await writable.close();
        },
        async abort(reason) {
          if (closed) return;
          closed = true;
          await writable.abort(reason);
        },
      },
      async getFile() {
        if (!closed) throw new Error("ARCHIVE_SINK_NOT_CLOSED");
        // 重新包装为带导出文件名的 File，并保留落盘文件的最后修改时间
        const stored = await handle.getFile();
        return new File([stored], filename, {
          type: "application/zip",
          lastModified: stored.lastModified,
        });
      },
      async cleanup() {
        await directory.removeEntry(temporaryName).catch(() => undefined);
      },
    };
  } catch {
    // OPFS 初始化或写入失败（如配额不足）时回退内存，保证导出不中断
    return memoryArchive(filename);
  }
}
