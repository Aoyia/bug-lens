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
