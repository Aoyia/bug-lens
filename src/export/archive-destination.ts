import type { ArchiveSink } from "./export-pipeline";

export type TemporaryArchive = {
  sink: ArchiveSink;
  getFile(): Promise<File>;
  cleanup(): Promise<void>;
  storage: "opfs" | "memory";
};

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
  if (!navigator.storage?.getDirectory) return memoryArchive(filename);
  try {
    const root = await navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle("bug-lens-exports", {
      create: true,
    });
    const temporaryName = `${crypto.randomUUID()}.zip`;
    const handle = await directory.getFileHandle(temporaryName, {
      create: true,
    });
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
    return memoryArchive(filename);
  }
}
