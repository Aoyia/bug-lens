import assert from "node:assert/strict";
import test from "node:test";

import {
  EXPORT_SCHEMA_VERSION,
  SUPPORTED_EXPORT_SCHEMA_VERSIONS,
  buildExportManifest,
  migrateExportPayload,
  verifyExportIntegrity,
} from "../src/export/export-manifest.ts";
import { sha256 } from "../src/export/sha256.ts";
import type { RecordingSession } from "../src/shared/protocol.ts";

const session: RecordingSession = {
  id: "session",
  schemaVersion: 1,
  extensionVersion: "0.1.0",
  status: "PREVIEW_READY",
  target: {
    tabId: 1,
    initialUrl: "https://example.test",
    initialTitle: "Example",
  },
  options: {
    captureAudio: false,
    captureVideo: true,
    captureScreenshots: true,
    captureConsole: true,
    captureNetwork: true,
    captureNetworkBodies: true,
    privacyMode: "safe",
    mediaTimesliceMs: 1000,
    maxSessionBytes: 512 * 1024 * 1024,
    maxResponseBodyBytes: 2 * 1024 * 1024,
  },
  timeline: { createdAtEpochMs: 1 },
  quality: {
    overall: "complete",
    interactionCount: 0,
    confirmedInteractionCount: 0,
    primaryScreenshotCount: 0,
    fallbackScreenshotCount: 0,
    unavailableScreenshotCount: 0,
    consoleEntryCount: 0,
    networkEntryCount: 0,
    issues: [],
  },
  nonce: "nonce",
};

test("export manifest verifies bytes and migrates v1 sessions to the current schema", async () => {
  const data = new TextEncoder().encode("evidence");
  const manifest = buildExportManifest(session, {
    "data/session.json": {
      byteLength: data.byteLength,
      sha256: await sha256(data),
    },
  });
  assert.deepEqual(
    await verifyExportIntegrity(manifest, { "data/session.json": data }),
    { valid: true, invalidFiles: [], missingFiles: [] }
  );
  assert.deepEqual(await verifyExportIntegrity(manifest, {}), {
    valid: false,
    invalidFiles: [],
    missingFiles: ["data/session.json"],
  });
  const migrated = migrateExportPayload({ session });
  assert.equal(migrated.session.schemaVersion, 2);
  assert.deepEqual(migrated.session.storage, { usedBytes: 0 });
});

test("export schema constants and baseline v5 manifest", () => {
  assert.equal(EXPORT_SCHEMA_VERSION, 5);
  assert.deepEqual(SUPPORTED_EXPORT_SCHEMA_VERSIONS, [1, 2, 3, 4, 5]);

  const manifest = buildExportManifest(session, {});
  assert.equal(manifest.schemaVersion, 5);
  assert.equal(manifest.migration.currentSchemaVersion, 5);
  assert.deepEqual(manifest.migration.supportedFrom, [1, 2, 3, 4, 5]);

  // migrateExportPayload supports all versions in SUPPORTED_EXPORT_SCHEMA_VERSIONS
  for (const v of [1, 2, 3, 4, 5]) {
    const migrated = migrateExportPayload({
      session: { ...session, schemaVersion: v as 1 | 2 },
    });
    assert.equal(migrated.session.schemaVersion, 2);
  }

  // Unsupported schema versions throw error
  assert.throws(
    () =>
      migrateExportPayload({
        session: { ...session, schemaVersion: 6 as any },
      }),
    /UNSUPPORTED_EXPORT_SCHEMA:6/
  );
});
