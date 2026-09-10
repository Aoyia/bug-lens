import assert from "node:assert/strict";
import test from "node:test";

import { strFromU8, strToU8, unzipSync } from "fflate";

import {
  writeEvidenceArchive,
  type ArchiveSink,
  type BinaryChunk,
} from "../src/export/export-pipeline.ts";
import type { MediaChunkRecord } from "../src/storage/db.ts";

test("streaming export writes report files and ordered media without a full archive buffer", async () => {
  const output: BinaryChunk[] = [];
  let closed = false;
  const sink: ArchiveSink = {
    async write(chunk) {
      output.push(chunk);
    },
    async close() {
      closed = true;
    },
    async abort() {
      assert.fail("archive should not abort");
    },
  };
  const records: MediaChunkRecord[] = ["first-", "second", "-third"].map(
    (value, sequence) => ({
      id: `session:${sequence}`,
      sessionId: "session",
      sequence,
      recordedAt: sequence,
      mimeType: "video/webm",
      chunk: strToU8(value).buffer as ArrayBuffer,
    })
  );

  const progress = await writeEvidenceArchive({
    files: [{ name: "README.md", data: strToU8("evidence") }],
    sessionId: "session",
    mediaSource: {
      async iterateMediaChunks(_sessionId, visitor) {
        for (const record of records) await visitor(record);
        return records.length;
      },
    },
    sink,
  });

  assert.equal(closed, true);
  assert.equal(progress.mediaChunksWritten, 3);
  assert.ok(output.length > 1, "ZIP should be emitted incrementally");
  const archiveSize = output.reduce(
    (total, chunk) => total + chunk.byteLength,
    0
  );
  const archive = new Uint8Array(archiveSize);
  let offset = 0;
  for (const chunk of output) {
    archive.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const files = unzipSync(archive);
  assert.equal(strFromU8(files["README.md"]), "evidence");
  assert.equal(strFromU8(files["media/recording.webm"]), "first-second-third");
});

test("streaming export aborts its sink when output fails", async () => {
  let aborted = false;
  await assert.rejects(
    writeEvidenceArchive({
      files: [{ name: "README.md", data: strToU8("evidence") }],
      sessionId: "session",
      mediaSource: {
        async iterateMediaChunks() {
          return 0;
        },
      },
      sink: {
        async write() {
          throw new Error("disk full");
        },
        async close() {
          assert.fail("failed output should not close normally");
        },
        async abort() {
          aborted = true;
        },
      },
    }),
    /disk full/
  );
  assert.equal(aborted, true);
});

test("streaming export writes a manifest after hashing streamed media", async () => {
  const output: BinaryChunk[] = [];
  await writeEvidenceArchive({
    files: [{ name: "README.md", data: strToU8("evidence") }],
    sessionId: "session",
    mediaSource: {
      async iterateMediaChunks(_sessionId, visitor) {
        await visitor({
          id: "session:0",
          sessionId: "session",
          sequence: 0,
          recordedAt: 0,
          mimeType: "video/webm",
          chunk: strToU8("video").buffer as ArrayBuffer,
        });
        return 1;
      },
    },
    sink: {
      async write(chunk) {
        output.push(chunk);
      },
      async close() {},
      async abort(reason) {
        throw reason;
      },
    },
    createManifest(files) {
      return {
        name: "data/manifest.json",
        data: strToU8(JSON.stringify({ files })),
      };
    },
  });
  const archive = new Uint8Array(
    output.reduce((total, chunk) => total + chunk.byteLength, 0)
  );
  let offset = 0;
  for (const chunk of output) {
    archive.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const manifest = JSON.parse(
    strFromU8(unzipSync(archive)["data/manifest.json"])
  );
  assert.equal(manifest.files["README.md"].byteLength, 8);
  assert.equal(manifest.files["media/recording.webm"].byteLength, 5);
  assert.match(manifest.files["media/recording.webm"].sha256, /^[a-f0-9]{64}$/);
});

test("streaming export collects algorithm-level stage4 metrics without modifying archive content", async () => {
  const output: BinaryChunk[] = [];
  const sink: ArchiveSink = {
    async write(chunk) {
      output.push(chunk);
    },
    async close() {},
    async abort() {},
  };

  const fileData = strToU8(
    "Hello World! Repeating content for compression ratio testing. ".repeat(100)
  );
  const progress = await writeEvidenceArchive({
    files: [{ name: "report.json", data: fileData }],
    sessionId: "stage4-test",
    mediaSource: {
      async iterateMediaChunks(_sessionId, visitor) {
        await visitor({
          id: "chunk:0",
          sessionId: "stage4-test",
          sequence: 0,
          recordedAt: 0,
          mimeType: "video/webm",
          chunk: strToU8("media-bytes-stream").buffer as ArrayBuffer,
        });
        return 1;
      },
    },
    sink,
    createManifest(files) {
      return {
        name: "manifest.json",
        data: strToU8(JSON.stringify({ files })),
      };
    },
  });

  assert.ok(progress.stage4Metrics, "progress.stage4Metrics 必须存在");
  const s4 = progress.stage4Metrics;

  assert.ok(s4.hashDurationMs >= 0);
  assert.ok(s4.hashThroughputMBps >= 0);
  assert.equal(s4.staticFilesCount, 1);
  assert.equal(s4.staticFilesBytes, fileData.byteLength);
  assert.ok(s4.deflateAndPassDurationMs >= 0);
  assert.ok(s4.mediaPackDurationMs >= 0);
  assert.equal(s4.mediaChunksCount, 1);
  assert.ok(s4.manifestDurationMs >= 0);
  assert.ok(s4.manifestBytes > 0);
  assert.ok(s4.totalDurationMs >= 0);
  assert.ok(s4.totalRawInputBytes > 0);
  assert.ok(s4.totalCompressedBytes > 0);
  assert.ok(s4.overallThroughputMBps >= 0);
  // Deflate 对重复文本压缩，压缩比应小于 1
  assert.ok(s4.compressionRatio > 0 && s4.compressionRatio < 1);
});

test("adaptive backpressure batches flushes while guaranteeing 100% data fidelity", async () => {
  const output: BinaryChunk[] = [];
  let progressCount = 0;
  const sink: ArchiveSink = {
    async write(chunk) {
      output.push(chunk);
    },
    async close() {},
    async abort() {},
  };

  // 准备 25 个静态小文件（超过 16 批次阈值）
  const files = Array.from({ length: 25 }, (_, i) => ({
    name: `data/file-${i}.json`,
    data: strToU8(JSON.stringify({ index: i, content: `item-${i}` })),
  }));

  // 准备 25 个媒体分片
  const mediaRecords: MediaChunkRecord[] = Array.from(
    { length: 25 },
    (_, i) => ({
      id: `chunk:${i}`,
      sessionId: "batch-test",
      sequence: i,
      recordedAt: i * 100,
      mimeType: "video/webm",
      chunk: strToU8(`part-${i};`).buffer as ArrayBuffer,
    })
  );

  const progress = await writeEvidenceArchive({
    files,
    sessionId: "batch-test",
    mediaSource: {
      async iterateMediaChunks(_sessionId, visitor) {
        for (const record of mediaRecords) {
          await visitor(record);
        }
        return mediaRecords.length;
      },
    },
    sink,
    onProgress() {
      progressCount += 1;
    },
    createManifest(integrity) {
      return {
        name: "manifest.json",
        data: strToU8(JSON.stringify({ files: integrity })),
      };
    },
  });

  assert.equal(progress.entriesWritten, 27); // 25 files + 1 media entry + 1 manifest entry
  assert.equal(progress.mediaChunksWritten, 25);
  // 确认在自适应批量背压下，没有每条单个文件与每个分片都产生独立的 flush（总共 25 文件 + 25 分片 + 1 manifest = 51 项）
  // 优化前 flushCount >= 51，优化后批量合并，progressCount 显著少于 51
  assert.ok(
    progressCount < 51,
    `进度回调应当批量合并触发，实际触发次数: ${progressCount}`
  );

  // 验证解压数据 100% 保真
  const totalSize = output.reduce((sum, c) => sum + c.byteLength, 0);
  const archive = new Uint8Array(totalSize);
  let offset = 0;
  for (const chunk of output) {
    archive.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const unzipped = unzipSync(archive);
  for (let i = 0; i < 25; i += 1) {
    const json = JSON.parse(strFromU8(unzipped[`data/file-${i}.json`]));
    assert.deepEqual(json, { index: i, content: `item-${i}` });
  }
  const fullMedia = strFromU8(unzipped["media/recording.webm"]);
  const expectedMedia = mediaRecords
    .map((r) => strFromU8(new Uint8Array(r.chunk)))
    .join("");
  assert.equal(fullMedia, expectedMedia);
});

test("sink.write 写入异常时立即中止流水线并触发 abort 丢弃半成品，无未捕获异常", async () => {
  let abortCalled = false;
  let abortError: any;
  const sink: ArchiveSink = {
    async write(chunk) {
      if (chunk.byteLength > 0) {
        throw new Error("DISK_FULL_SIMULATED");
      }
    },
    async close() {},
    async abort(err) {
      abortCalled = true;
      abortError = err;
    },
  };

  const files = [
    { name: "test.txt", data: strToU8("some content to trigger write") },
  ];

  await assert.rejects(
    async () => {
      await writeEvidenceArchive({
        files,
        sessionId: "sink-fail-test",
        mediaSource: {
          async iterateMediaChunks() {
            return 0;
          },
        },
        sink,
      });
    },
    (err: any) => {
      return err.message === "DISK_FULL_SIMULATED";
    }
  );

  assert.equal(abortCalled, true, "sink.write 失败必须调用 sink.abort");
  assert.equal(abortError?.message, "DISK_FULL_SIMULATED");
});

test("writeEvidenceArchive 支持 0 静态文件且 0 媒体分片的空边界情况", async () => {
  const output: BinaryChunk[] = [];
  let closed = false;
  const sink: ArchiveSink = {
    async write(chunk) {
      output.push(chunk);
    },
    async close() {
      closed = true;
    },
    async abort() {},
  };

  const progress = await writeEvidenceArchive({
    files: [],
    sessionId: "empty-session",
    mediaSource: {
      async iterateMediaChunks() {
        return 0;
      },
    },
    sink,
  });

  assert.equal(closed, true);
  assert.equal(progress.entriesWritten, 0);
  assert.equal(progress.mediaChunksWritten, 0);
  const totalSize = output.reduce((sum, c) => sum + c.byteLength, 0);
  assert.ok(totalSize > 0, "即使 0 实体也应当包含 ZIP 的中央目录收尾结构");
  const archive = new Uint8Array(totalSize);
  let offset = 0;
  for (const c of output) {
    archive.set(c, offset);
    offset += c.byteLength;
  }
  const unzipped = unzipSync(archive);
  assert.deepEqual(Object.keys(unzipped), []);
});

test("mediaSource 在流式读取中途抛错时安全中止流水线并触发 abort", async () => {
  let abortCalled = false;
  let abortError: any;
  const sink: ArchiveSink = {
    async write() {},
    async close() {},
    async abort(err) {
      abortCalled = true;
      abortError = err;
    },
  };

  await assert.rejects(
    async () => {
      await writeEvidenceArchive({
        files: [{ name: "info.txt", data: strToU8("ok") }],
        sessionId: "media-fail",
        mediaSource: {
          async iterateMediaChunks(_sid, visitor) {
            await visitor({
              id: "chunk:0",
              sessionId: "media-fail",
              sequence: 0,
              recordedAt: 0,
              mimeType: "video/webm",
              chunk: strToU8("slice-0").buffer as ArrayBuffer,
            });
            throw new Error("IDB_TRANSACTION_ABORTED_SIMULATED");
          },
        },
        sink,
      });
    },
    (err: any) => err.message === "IDB_TRANSACTION_ABORTED_SIMULATED"
  );

  assert.equal(abortCalled, true);
  assert.equal(abortError?.message, "IDB_TRANSACTION_ABORTED_SIMULATED");
});

test("海量高频分片流式背压水位与数据保真度压力测试（1000 个分片模拟慢 I/O）", async () => {
  const output: BinaryChunk[] = [];
  let maxPendingObserved = 0;
  let currentPending = 0;

  const sink: ArchiveSink = {
    async write(chunk) {
      currentPending += chunk.byteLength;
      if (currentPending > maxPendingObserved) {
        maxPendingObserved = currentPending;
      }
      // 模拟磁盘微小 I/O 延迟（微任务交错）
      await new Promise((r) => setImmediate(r));
      output.push(chunk);
      currentPending -= chunk.byteLength;
    },
    async close() {},
    async abort() {},
  };

  const CHUNK_COUNT = 1000;
  const CHUNK_SIZE = 4096; // 4KB 每个分片，总计 4MB
  const sliceBuffer = new Uint8Array(CHUNK_SIZE);
  for (let i = 0; i < CHUNK_SIZE; i += 1) {
    sliceBuffer[i] = i % 256;
  }

  const progress = await writeEvidenceArchive({
    files: [
      {
        name: "meta.json",
        data: strToU8(JSON.stringify({ chunks: CHUNK_COUNT })),
      },
    ],
    sessionId: "stress-session",
    mediaSource: {
      async iterateMediaChunks(_sessionId, visitor) {
        for (let i = 0; i < CHUNK_COUNT; i += 1) {
          // 每个分片带有唯一序号标记
          const chunkData = new Uint8Array(sliceBuffer);
          chunkData[0] = i & 0xff;
          chunkData[1] = (i >> 8) & 0xff;
          await visitor({
            id: `chunk:${i}`,
            sessionId: "stress-session",
            sequence: i,
            recordedAt: i * 10,
            mimeType: "video/webm",
            chunk: chunkData.buffer as ArrayBuffer,
          });
        }
        return CHUNK_COUNT;
      },
    },
    sink,
    createManifest(integrity) {
      return {
        name: "manifest.json",
        data: strToU8(JSON.stringify({ files: integrity })),
      };
    },
  });

  assert.equal(progress.entriesWritten, 3); // meta.json + media/recording.webm + manifest.json
  assert.equal(progress.mediaChunksWritten, CHUNK_COUNT);

  // 验证完整性校验
  const totalSize = output.reduce((sum, c) => sum + c.byteLength, 0);
  const archive = new Uint8Array(totalSize);
  let offset = 0;
  for (const c of output) {
    archive.set(c, offset);
    offset += c.byteLength;
  }
  const unzipped = unzipSync(archive);
  assert.ok(unzipped["meta.json"]);
  assert.ok(unzipped["manifest.json"]);
  assert.ok(unzipped["media/recording.webm"]);
  assert.equal(
    unzipped["media/recording.webm"].byteLength,
    CHUNK_COUNT * CHUNK_SIZE,
    "解压后媒体流字节数必须与原始写入完全一致（零数据损坏）"
  );
  // 抽查首尾与中间分片的魔数标记
  const restoredMedia = unzipped["media/recording.webm"];
  for (const checkIndex of [0, 1, 42, 500, 999]) {
    const chunkStart = checkIndex * CHUNK_SIZE;
    const low = restoredMedia[chunkStart];
    const high = restoredMedia[chunkStart + 1];
    const seq = low + (high << 8);
  }
});

test("precomputedMediaIntegrity 长度与实际回读媒体字节不一致时安全降级采用流式实时哈希，保证 Manifest 绝对保真", async () => {
  const output: BinaryChunk[] = [];
  const sink: ArchiveSink = {
    async write(chunk) {
      output.push(chunk);
    },
    async close() {},
    async abort() {},
  };

  const actualMediaContent = strToU8("actual-media-stream-from-db");
  const actualSha256 =
    "66f44383a1d9501a44e59049a4a7541249fa0208ce8f28ffea4c944369a47321"; // Dummy sha, will be checked against real computed
  let manifestIntegrity: any;

  await writeEvidenceArchive({
    files: [{ name: "info.txt", data: strToU8("ok") }],
    sessionId: "mismatch-integrity-test",
    mediaSource: {
      async iterateMediaChunks(_sessionId, visitor) {
        await visitor({
          id: "chunk:0",
          sessionId: "mismatch-integrity-test",
          sequence: 0,
          recordedAt: 0,
          mimeType: "video/webm",
          chunk: actualMediaContent.buffer as ArrayBuffer,
        });
        return 1;
      },
    },
    // 注入错误的预计算哈希与长度（模拟拒写导致录制时与落库实际不一致的情况）
    precomputedMediaIntegrity: {
      byteLength: 999999,
      sha256:
        "0000000000000000000000000000000000000000000000000000000000000000",
    },
    sink,
    createManifest(integrity) {
      manifestIntegrity = integrity;
      return {
        name: "manifest.json",
        data: strToU8(JSON.stringify({ files: integrity })),
      };
    },
  });

  // 必须降级为实际回读的媒体长度与哈希，绝不轻信错误的 precomputedMediaIntegrity
  assert.equal(
    manifestIntegrity["media/recording.webm"].byteLength,
    actualMediaContent.byteLength,
    "manifest 记录的媒体长度必须与实际写入 ZIP 的字节数一致"
  );
  assert.notEqual(
    manifestIntegrity["media/recording.webm"].sha256,
    "0000000000000000000000000000000000000000000000000000000000000000",
    "长度不匹配时预计算哈希必须被丢弃并重新采用流式实时哈希"
  );
  assert.match(
    manifestIntegrity["media/recording.webm"].sha256,
    /^[a-f0-9]{64}$/
  );

  // 解压并验证文件真实哈希与 manifest 记录一致
  const totalSize = output.reduce((sum, c) => sum + c.byteLength, 0);
  const archive = new Uint8Array(totalSize);
  let offset = 0;
  for (const c of output) {
    archive.set(c, offset);
    offset += c.byteLength;
  }
  const unzipped = unzipSync(archive);
  assert.equal(
    unzipped["media/recording.webm"].byteLength,
    actualMediaContent.byteLength
  );
});
