import { Zip, ZipDeflate, ZipPassThrough } from "fflate";

import type { MediaChunkRecord } from "../storage/db";
import { Sha256, sha256 } from "./sha256.ts";

export type BinaryChunk = Uint8Array<ArrayBuffer>;

const isTextFile = (filename: string) => /\.(?:json|js|css|html|md)$/i.test(filename);

export type ArchiveSink = {
  write(chunk: BinaryChunk): Promise<void>;
  close(): Promise<void>;
  abort(reason?: unknown): Promise<void>;
};

export type ArchiveFile = {
  name: string;
  data: Uint8Array;
};

export type MediaChunkSource = {
  iterateMediaChunks(
    sessionId: string,
    visitor: (chunk: MediaChunkRecord) => void | Promise<void>
  ): Promise<number>;
};

export type ExportProgress = {
  entriesWritten: number;
  mediaChunksWritten: number;
  bytesWritten: number;
};

export type ArchiveEntryIntegrity = Record<string, { byteLength: number; sha256: string }>;

export async function writeEvidenceArchive(input: {
  files: ArchiveFile[];
  sessionId: string;
  mediaSource: MediaChunkSource;
  sink: ArchiveSink;
  onProgress?: (progress: ExportProgress) => void;
  createManifest?: (files: ArchiveEntryIntegrity) => ArchiveFile;
}): Promise<ExportProgress> {
  let outputQueue: Promise<void> = Promise.resolve();
  let finalResolve!: () => void;
  let finalReject!: (reason?: unknown) => void;
  let finalSeen = false;
  const finalOutput = new Promise<void>((resolve, reject) => {
    finalResolve = resolve;
    finalReject = reject;
  });
  const progress: ExportProgress = { entriesWritten: 0, mediaChunksWritten: 0, bytesWritten: 0 };
  const integrity: ArchiveEntryIntegrity = {};

  const zip = new Zip((error, data, final) => {
    if (error) {
      finalReject(error);
      return;
    }
    const stableChunk = new Uint8Array(data.byteLength);
    stableChunk.set(data);
    progress.bytesWritten += stableChunk.byteLength;
    outputQueue = outputQueue.then(() => input.sink.write(stableChunk));
    if (final) {
      finalSeen = true;
      void outputQueue.then(finalResolve, finalReject);
    }
  });

  const flushOutput = async () => {
    await outputQueue;
    input.onProgress?.({ ...progress });
  };

  try {
    for (const file of input.files) {
      const hash = await sha256(file.data);
      const entry = isTextFile(file.name) ? new ZipDeflate(file.name, { level: 9 }) : new ZipPassThrough(file.name);
      zip.add(entry);
      entry.push(file.data, true);
      integrity[file.name] = { byteLength: file.data.byteLength, sha256: hash };
      progress.entriesWritten += 1;
      await flushOutput();
    }

    let mediaEntry: ZipPassThrough | undefined;
    let mediaHash: Sha256 | undefined;
    let mediaBytes = 0;
    await input.mediaSource.iterateMediaChunks(input.sessionId, async (record) => {
      if (!(record.chunk instanceof ArrayBuffer) || record.chunk.byteLength === 0) return;
      if (!mediaEntry) {
        mediaEntry = new ZipPassThrough("media/recording.webm");
        zip.add(mediaEntry);
        progress.entriesWritten += 1;
        mediaHash = new Sha256();
      }
      const bytes = new Uint8Array(record.chunk);
      mediaEntry.push(bytes, false);
      mediaHash!.update(bytes);
      mediaBytes += bytes.byteLength;
      progress.mediaChunksWritten += 1;
      await flushOutput();
    });
    mediaEntry?.push(new Uint8Array(), true);
    if (mediaEntry && mediaHash) integrity["media/recording.webm"] = { byteLength: mediaBytes, sha256: mediaHash.digestHex() };
    if (input.createManifest) {
      const manifest = input.createManifest(integrity);
      const entry = isTextFile(manifest.name) ? new ZipDeflate(manifest.name, { level: 9 }) : new ZipPassThrough(manifest.name);
      zip.add(entry);
      entry.push(manifest.data, true);
      progress.entriesWritten += 1;
      await flushOutput();
    }
    zip.end();
    await finalOutput;
    if (!finalSeen) throw new Error("ZIP_STREAM_INCOMPLETE: 流式 ZIP 未产生结束标志");
    await input.sink.close();
    input.onProgress?.({ ...progress });
    return progress;
  } catch (error) {
    await input.sink.abort(error).catch(() => undefined);
    throw error;
  }
}

export async function validateArchiveIntegrity(
  files: ArchiveFile[],
  expectedIntegrity: ArchiveEntryIntegrity
): Promise<boolean> {
  const expectedKeys = Object.keys(expectedIntegrity);
  if (files.length !== expectedKeys.length) return false;
  for (const file of files) {
    const expected = expectedIntegrity[file.name];
    if (!expected) return false;
    if (file.data.byteLength !== expected.byteLength) return false;
    const actualHash = await sha256(file.data);
    if (actualHash !== expected.sha256) return false;
  }
  return true;
}
