import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  EXPORT_SCHEMA_VERSION,
  SUPPORTED_EXPORT_SCHEMA_VERSIONS,
  buildExportManifest,
  migrateExportPayload,
} from "../src/export/export-manifest.ts";
import {
  MAX_SUPPORTED_SCHEMA_VERSION,
  SUPPORTED_SCHEMA_VERSIONS,
  parseManifest,
  verifyPackIntegrity,
} from "../src/triage-cli/pack/manifest.ts";
import type { ExportManifest } from "../src/triage-cli/pack/types.ts";
import type { RecordingSession } from "../src/shared/protocol.ts";

test("Adversarial: Constants integrity across export and triage-cli", () => {
  // 1. Export schema baseline version
  assert.equal(EXPORT_SCHEMA_VERSION, 5);
  assert.deepEqual(SUPPORTED_EXPORT_SCHEMA_VERSIONS, [1, 2, 3, 4, 5]);

  // 2. Triage CLI schema baseline version
  assert.equal(MAX_SUPPORTED_SCHEMA_VERSION, 5);
  assert.deepEqual(SUPPORTED_SCHEMA_VERSIONS, [1, 2, 3, 4, 5]);

  // 3. Export and CLI alignment
  assert.equal(EXPORT_SCHEMA_VERSION, MAX_SUPPORTED_SCHEMA_VERSION);
  assert.deepEqual(
    [...SUPPORTED_EXPORT_SCHEMA_VERSIONS],
    [...SUPPORTED_SCHEMA_VERSIONS]
  );
});

test("Adversarial: JSON Schema in ai-evidence-pack-spec.md validates v5 and rejects v2", () => {
  const specPath = join(
    process.cwd(),
    "docs/specifications/ai-evidence-pack-spec.md"
  );
  const specContent = readFileSync(specPath, "utf-8");

  // Extract JSON Schema block under section 2.3.1
  const jsonSchemaMatch = specContent.match(/```json\n([\s\S]*?)\n```/);
  assert.ok(jsonSchemaMatch, "JSON Schema block should exist in spec");

  const schemaJson = JSON.parse(jsonSchemaMatch[1]);
  assert.equal(schemaJson.title, "AiEvidencePackManifestV5");
  assert.deepEqual(schemaJson.properties.schemaVersion.enum, [5]);

  // Verify that schemaVersion 5 is valid per enum definition
  assert.ok(
    schemaJson.properties.schemaVersion.enum.includes(5),
    "Enum must allow 5"
  );
  assert.ok(
    !schemaJson.properties.schemaVersion.enum.includes(2),
    "Enum must NOT allow 2"
  );
});

test("Adversarial: verifyPackIntegrity boundary conditions on schemaVersion", () => {
  const dummyFiles = new Map<string, Uint8Array>();
  const dummySkipped = new Set<string>();

  // 1. Standard supported versions: 1, 2, 3, 4, 5 must all have NO warning
  for (const v of [1, 2, 3, 4, 5]) {
    const manifest: ExportManifest = {
      format: "3.0",
      schemaVersion: v,
      createdAtEpochMs: Date.now(),
      sessionId: `test-${v}`,
      files: {},
      migration: { currentSchemaVersion: v, supportedFrom: [1, 2, 3, 4, 5] },
    };
    const report = verifyPackIntegrity(manifest, dummyFiles, dummySkipped);
    assert.equal(report.valid, true);
    assert.equal(report.schemaVersion, v);
    assert.equal(report.schemaWarning, undefined);
  }

  // 2. Future versions > 5: must warn with "newer than max supported version (5)"
  for (const v of [6, 7, 10, 999]) {
    const manifest: ExportManifest = {
      format: "3.0",
      schemaVersion: v,
      createdAtEpochMs: Date.now(),
      sessionId: `future-${v}`,
      files: {},
      migration: { currentSchemaVersion: v, supportedFrom: [1, 2, 3, 4, 5] },
    };
    const report = verifyPackIntegrity(manifest, dummyFiles, dummySkipped);
    assert.match(
      report.schemaWarning ?? "",
      /newer than max supported version \(5\)/
    );
  }

  // 3. Out-of-spec versions <= 0: must warn with "not in standard supported list"
  for (const v of [0, -1, -99]) {
    const manifest: ExportManifest = {
      format: "3.0",
      schemaVersion: v,
      createdAtEpochMs: Date.now(),
      sessionId: `legacy-${v}`,
      files: {},
      migration: { currentSchemaVersion: v, supportedFrom: [1, 2, 3, 4, 5] },
    };
    const report = verifyPackIntegrity(manifest, dummyFiles, dummySkipped);
    assert.match(
      report.schemaWarning ?? "",
      /not in standard supported list \(1, 2, 3, 4, 5\)/
    );
  }

  // 4. Undefined / missing schemaVersion: should not crash
  const missingManifest = {
    format: "3.0",
    createdAtEpochMs: Date.now(),
    sessionId: "missing",
    files: {},
  } as unknown as ExportManifest;
  const missingReport = verifyPackIntegrity(
    missingManifest,
    dummyFiles,
    dummySkipped
  );
  assert.equal(missingReport.valid, true);
  assert.equal(missingReport.schemaWarning, undefined);
});

test("Adversarial: migrateExportPayload boundary conditions", () => {
  const dummySession = {
    id: "session-1",
    nonce: "dummy-nonce",
    schemaVersion: 1 as const,
    extensionVersion: "0.7.41",
    status: "PREVIEW_READY" as const,
    target: {
      tabId: 1,
      initialUrl: "https://example.com",
      initialTitle: "Example",
    },
    options: {} as any,
    timeline: { createdAtEpochMs: 0 },
    quality: {
      overall: "complete" as const,
      mediaState: "ready" as const,
      issues: [],
    } as any,
  } as unknown as RecordingSession;

  // Valid versions in SUPPORTED_EXPORT_SCHEMA_VERSIONS
  for (const v of [1, 2, 3, 4, 5]) {
    const payload = {
      session: {
        ...dummySession,
        schemaVersion: v as any,
      },
    };
    const result = migrateExportPayload(payload);
    assert.equal(result.session.schemaVersion, 2);
    if (v === 1) {
      assert.deepEqual(result.session.storage, { usedBytes: 0 });
    }
  }

  // Invalid versions must throw UNSUPPORTED_EXPORT_SCHEMA
  for (const invalid of [0, 6, 99, -1]) {
    assert.throws(
      () =>
        migrateExportPayload({
          session: {
            ...dummySession,
            schemaVersion: invalid as any,
          },
        }),
      new RegExp(`UNSUPPORTED_EXPORT_SCHEMA:${invalid}`)
    );
  }
});

test("Adversarial: No residual schemaVersion: 2 in docs/specifications/ai-evidence-pack-spec.md schema blocks", () => {
  const specPath = join(
    process.cwd(),
    "docs/specifications/ai-evidence-pack-spec.md"
  );
  const specContent = readFileSync(specPath, "utf-8");

  // Check interface AiEvidencePackManifestV5
  assert.match(
    specContent,
    /export interface AiEvidencePackManifestV5 \{[\s\S]*?schemaVersion:\s*5;/
  );
  // Check SessionDataPayloadV5
  assert.match(
    specContent,
    /export interface SessionDataPayloadV5 \{[\s\S]*?schemaVersion:\s*5;/
  );
  // Ensure no interface AiEvidencePackManifest has schemaVersion: 2
  assert.doesNotMatch(
    specContent,
    /export interface AiEvidencePackManifestV2 \{[\s\S]*?schemaVersion:\s*2;/
  );
  // Ensure roadmap does not contain schemaVersion >= 2
  const roadmapPath = join(
    process.cwd(),
    "docs/specifications/triage-toolchain-roadmap.md"
  );
  const roadmapContent = readFileSync(roadmapPath, "utf-8");
  assert.doesNotMatch(roadmapContent, /schemaVersion\s*>=\s*2/);
  assert.match(roadmapContent, /schemaVersion\s*>=\s*5/);
});
