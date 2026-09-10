import { Zip, ZipDeflate, ZipPassThrough } from "fflate";

import {
  DevProfiler,
  type PerfMetricItem,
  type PerfReportData,
} from "../shared/dev-profiler";
import type { MediaChunkRecord } from "../storage/db";
import { Sha256, sha256 } from "./sha256.ts";
import type { Stage4Metrics } from "./export-trace.ts";

export type BinaryChunk = Uint8Array<ArrayBuffer>;

const isCompressible = (filename: string) =>
  /\.(?:json|js|css|html|md)$/i.test(filename);

// ZIP 字节流的目标写入端（OPFS 或内存），需按序支持 write / close / abort
export type ArchiveSink = {
  write(chunk: BinaryChunk): Promise<void>;
  close(): Promise<void>;
  abort(reason?: unknown): Promise<void>;
};

// 待打包的普通文件（完整数据已在内存中）
export type ArchiveFile = {
  name: string;
  data: Uint8Array;
};

// 媒体分片数据源：按 sessionId 流式回读分片，避免整段媒体载入内存
export type MediaChunkSource = {
  iterateMediaChunks(
    sessionId: string,
    visitor: (chunk: MediaChunkRecord) => void | Promise<void>
  ): Promise<number>;
};

// 导出进度：已写条目数、媒体分片数与字节数
export type ExportProgress = {
  entriesWritten: number;
  mediaChunksWritten: number;
  bytesWritten: number;
  stage4Metrics?: Stage4Metrics;
};

// 逐文件完整性记录（字节长度 + SHA-256），随导出清单写入供事后校验
export type ArchiveEntryIntegrity = Record<
  string,
  { byteLength: number; sha256: string }
>;

export async function writeEvidenceArchive(input: {
  files: ArchiveFile[];
  sessionId: string;
  mediaSource: MediaChunkSource;
  sink: ArchiveSink;
  onProgress?: (progress: ExportProgress) => void;
  createManifest?: (files: ArchiveEntryIntegrity) => ArchiveFile;
  precomputedMediaIntegrity?: { byteLength: number; sha256: string };
  onPerfReport?: (report: PerfReportData) => void;
}): Promise<ExportProgress> {
  // 背压队列：sink 写入速度慢于 zip 产出时按序排队，防止乱序与内存堆积
  let outputQueue: Promise<void> = Promise.resolve();
  let finalResolve!: () => void;
  let finalReject!: (reason?: unknown) => void;
  let finalSeen = false;
  // 仅当 fflate 回调携带 final=true 时 resolve，表示整个 ZIP 流完整结束
  const finalOutput = new Promise<void>((resolve, reject) => {
    finalResolve = resolve;
    finalReject = reject;
  });
  const progress: ExportProgress = {
    entriesWritten: 0,
    mediaChunksWritten: 0,
    bytesWritten: 0,
  };
  const integrity: ArchiveEntryIntegrity = {};

  let pendingSinkBytes = 0;
  let itemsSinceLastFlush = 0;
  let queueError: unknown | undefined;
  const BACKPRESSURE_BYTE_THRESHOLD = 1024 * 1024; // 1 MB 自适应缓冲水位
  const BACKPRESSURE_BATCH_COUNT = 16; // 批量排空阈值

  const zip = new Zip((error, data, final) => {
    if (error) {
      if (!queueError) queueError = error;
      finalReject(error);
      return;
    }
    // fflate 复用 data 缓冲，立即复制为稳定副本再入队，避免后续产出覆盖
    const stableChunk = new Uint8Array(data.byteLength);
    stableChunk.set(data);
    progress.bytesWritten += stableChunk.byteLength;
    pendingSinkBytes += stableChunk.byteLength;
    // 追加到背压队列末尾，保证写出顺序与 zip 产出一致
    outputQueue = outputQueue
      .then(async () => {
        if (queueError) return;
        await input.sink.write(stableChunk);
      })
      .catch((err) => {
        if (!queueError) queueError = err;
      })
      .finally(() => {
        pendingSinkBytes -= stableChunk.byteLength;
      });
    if (final) {
      finalSeen = true;
      // 等队列清空后再结束，确保所有字节都已落盘
      void outputQueue.then(() => {
        if (queueError) {
          finalReject(queueError);
        } else {
          finalResolve();
        }
      });
    }
  });

  // 排空队列后再回调进度，保证进度值对应已实际写入 sink 的数据
  const flushOutput = async () => {
    await outputQueue;
    if (queueError) {
      throw queueError;
    }
    itemsSinceLastFlush = 0;
    input.onProgress?.({ ...progress });
  };

  // 自适应背压控制：仅在堆积字节达到水位或条目批次到达上限时让出事件循环排空，避免单条逐次微任务挂起
  const maybeYieldBackpressure = async () => {
    itemsSinceLastFlush += 1;
    if (
      pendingSinkBytes >= BACKPRESSURE_BYTE_THRESHOLD ||
      itemsSinceLastFlush >= BACKPRESSURE_BATCH_COUNT
    ) {
      await flushOutput();
    }
  };

  const perfMetrics: PerfMetricItem[] = [];
  const startPipelineTime = performance.now();

  try {
    const staticFilesBytes = input.files.reduce(
      (acc, f) => acc + f.data.byteLength,
      0
    );
    const hashStartTime = performance.now();
    const fileHashes = await Promise.all(
      input.files.map(async (file) => ({
        file,
        hash: await sha256(file.data),
      }))
    );
    const hashDurationMs = performance.now() - hashStartTime;
    const hashThroughputMBps =
      hashDurationMs > 0 && staticFilesBytes > 0
        ? staticFilesBytes / (1024 * 1024) / (hashDurationMs / 1000)
        : 0;
    perfMetrics.push({
      step: "1. 静态与证据文件 SHA-256 计算",
      durationMs: hashDurationMs,
      size: `${input.files.length} 个文件`,
      note: `${(staticFilesBytes / (1024 * 1024)).toFixed(2)} MB (${hashThroughputMBps.toFixed(2)} MB/s)`,
    });

    const zipStartTime = performance.now();
    for (const { file, hash } of fileHashes) {
      // 文本用 Deflate 快速压缩档（level 1），避免 level 9 对大 JSON 的无谓 CPU 损耗；图片/视频走 PassThrough 零压缩
      const entry = isCompressible(file.name)
        ? new ZipDeflate(file.name, { level: 1 })
        : new ZipPassThrough(file.name);
      zip.add(entry);
      entry.push(file.data, true);
      integrity[file.name] = { byteLength: file.data.byteLength, sha256: hash };
      progress.entriesWritten += 1;
      await maybeYieldBackpressure();
    }
    // 静态文件集合写入完成，排空输出并同步进度
    await flushOutput();
    const deflateAndPassDurationMs = performance.now() - zipStartTime;
    perfMetrics.push({
      step: "2. 静态与证据文件写入 ZIP 条目",
      durationMs: deflateAndPassDurationMs,
      size: `${fileHashes.length} 条目`,
      note: "纯文本 Deflate 1 / 图片 PassThrough",
    });

    const mediaStartTime = performance.now();
    let mediaEntry: ZipPassThrough | undefined;
    let mediaHash: Sha256 | undefined;
    let mediaBytes = 0;

    let mediaFilename = "media/recording.webm";

    await input.mediaSource.iterateMediaChunks(
      input.sessionId,
      async (record) => {
        if (
          !(record.chunk instanceof ArrayBuffer) ||
          record.chunk.byteLength === 0
        )
          return;
        if (!mediaEntry) {
          const isMp4 =
            record.mimeType?.includes("mp4") ||
            (record.chunk.byteLength >= 8 &&
              new Uint8Array(record.chunk)[4] === 0x66 && // 'f'
              new Uint8Array(record.chunk)[5] === 0x74 && // 't'
              new Uint8Array(record.chunk)[6] === 0x79 && // 'y'
              new Uint8Array(record.chunk)[7] === 0x70); // 'p' ('ftyp' box)
          mediaFilename = isMp4
            ? "media/recording.mp4"
            : "media/recording.webm";
          mediaEntry = new ZipPassThrough(mediaFilename);
          zip.add(mediaEntry);
          progress.entriesWritten += 1;
          mediaHash = new Sha256();
        }
        const bytes = new Uint8Array(record.chunk);
        mediaEntry.push(bytes, false); // 非末片，暂不结束条目
        mediaHash?.update(bytes);
        mediaBytes += bytes.byteLength;
        progress.mediaChunksWritten += 1;
        await maybeYieldBackpressure();
      }
    );
    mediaEntry?.push(new Uint8Array(), true); // 空块收尾，通知 fflate 结束媒体条目
    await flushOutput();
    const mediaPackDurationMs = performance.now() - mediaStartTime;
    if (mediaEntry) {
      const isPrecomputedValid =
        input.precomputedMediaIntegrity !== undefined &&
        input.precomputedMediaIntegrity.byteLength === mediaBytes &&
        typeof input.precomputedMediaIntegrity.sha256 === "string" &&
        input.precomputedMediaIntegrity.sha256.length === 64;
      integrity[mediaFilename] = isPrecomputedValid
        ? input.precomputedMediaIntegrity!
        : {
            byteLength: mediaBytes,
            sha256: mediaHash ? mediaHash.digestHex() : "",
          };
      perfMetrics.push({
        step: "3. 视频分片流式封包与哈希",
        durationMs: mediaPackDurationMs,
        size: `${progress.mediaChunksWritten} 个分片`,
        note: `${(mediaBytes / (1024 * 1024)).toFixed(2)} MB (${mediaFilename.endsWith(".mp4") ? "MP4" : "WebM"})${isPrecomputedValid ? " [预计算命中]" : ""}`,
      });
    }

    const manifestStartTime = performance.now();
    let manifestBytes = 0;
    if (input.createManifest) {
      const manifest = input.createManifest(integrity);
      manifestBytes = manifest.data.byteLength;
      const entry = isCompressible(manifest.name)
        ? new ZipDeflate(manifest.name, { level: 1 })
        : new ZipPassThrough(manifest.name);
      zip.add(entry);
      entry.push(manifest.data, true);
      progress.entriesWritten += 1;
      await flushOutput();
      perfMetrics.push({
        step: "4. Manifest 清单生成与追加",
        durationMs: performance.now() - manifestStartTime,
        size: `${manifestBytes} B`,
        note: "SHA-256 完整性指纹清单",
      });
    }
    const manifestDurationMs = performance.now() - manifestStartTime;

    const finalizeStartTime = performance.now();
    zip.end();
    await finalOutput;
    // 未收到 final 标志说明 ZIP 流提前中断（如异常），产物结构不完整
    if (!finalSeen)
      throw new Error("ZIP_STREAM_INCOMPLETE: 流式 ZIP 未产生结束标志");
    await input.sink.close();
    const finalizeDurationMs = performance.now() - finalizeStartTime;
    perfMetrics.push({
      step: "5. ZIP 流收尾与 Sink 写入",
      durationMs: finalizeDurationMs,
      size: `${(progress.bytesWritten / (1024 * 1024)).toFixed(2)} MB`,
      note: "完成写入",
    });

    const packTotalMs = performance.now() - startPipelineTime;
    const totalRawInputBytes = staticFilesBytes + mediaBytes + manifestBytes;
    const totalCompressedBytes = progress.bytesWritten;
    const compressionRatio =
      totalRawInputBytes > 0 ? totalCompressedBytes / totalRawInputBytes : 1;
    const overallThroughputMBps =
      packTotalMs > 0 && totalRawInputBytes > 0
        ? totalRawInputBytes / (1024 * 1024) / (packTotalMs / 1000)
        : 0;

    const stage4Metrics: Stage4Metrics = {
      hashDurationMs,
      hashThroughputMBps,
      staticFilesBytes,
      staticFilesCount: input.files.length,
      deflateAndPassDurationMs,
      mediaPackDurationMs,
      mediaBytes,
      mediaChunksCount: progress.mediaChunksWritten,
      manifestDurationMs,
      manifestBytes,
      finalizeDurationMs,
      totalDurationMs: packTotalMs,
      totalRawInputBytes,
      totalCompressedBytes,
      compressionRatio,
      overallThroughputMBps,
    };
    progress.stage4Metrics = stage4Metrics;

    DevProfiler.printSummaryTable("ZIP 导出流水线分析报告", perfMetrics, {
      总写入字节: `${(progress.bytesWritten / (1024 * 1024)).toFixed(2)} MB`,
      写入条目数: progress.entriesWritten,
      整体封包吞吐: `${overallThroughputMBps.toFixed(2)} MB/s`,
      体积压缩比: `${(compressionRatio * 100).toFixed(1)}%`,
      流水线总耗时: `${packTotalMs.toFixed(2)} ms`,
    });
    const perfReport = DevProfiler.buildSummaryReport(
      "ZIP 导出流水线分析报告",
      perfMetrics,
      {
        总写入字节: `${(progress.bytesWritten / (1024 * 1024)).toFixed(2)} MB`,
        写入条目数: progress.entriesWritten,
        整体封包吞吐: `${overallThroughputMBps.toFixed(2)} MB/s`,
        体积压缩比: `${(compressionRatio * 100).toFixed(1)}%`,
        流水线总耗时: `${packTotalMs.toFixed(2)} ms`,
      }
    );
    input.onPerfReport?.(perfReport);

    input.onProgress?.({ ...progress });
    return progress;
  } catch (error) {
    // 失败时通知 sink 终止并丢弃半成品，避免残留不完整 ZIP
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
  const fileHashes = await Promise.all(
    files.map(async (file) => ({
      file,
      hash: await sha256(file.data),
    }))
  );
  // 逐文件校验：名称匹配且 byteLength 与 sha256 全部一致才算有效
  return fileHashes.every(({ file, hash }) => {
    const expected = expectedIntegrity[file.name];
    return (
      expected !== undefined &&
      file.data.byteLength === expected.byteLength &&
      hash === expected.sha256
    );
  });
}
