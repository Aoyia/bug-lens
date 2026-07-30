import type { ExportManifest, RecordingSession } from "../shared/protocol";
import type { ArchiveEntryIntegrity } from "./export-pipeline";
import { sha256 } from "./sha256.ts";

export const EXPORT_SCHEMA_VERSION = 3;
export const SUPPORTED_EXPORT_SCHEMA_VERSIONS = [1, 2, 3] as const;

/** Makes a persisted v1 session safe to serialize in the v2 evidence package. */
export function migrateSessionForExport(session: RecordingSession): RecordingSession {
  if (session.schemaVersion === 2) return session;
  return {
    ...session,
    schemaVersion: 2,
    storage: session.storage ?? { usedBytes: 0 }
  };
}

export function buildExportManifest(session: RecordingSession, files: ArchiveEntryIntegrity): ExportManifest {
  return {
    format: "3.0",
    schemaVersion: EXPORT_SCHEMA_VERSION,
    createdAtEpochMs: Date.now(),
    sessionId: session.id,
    files,
    migration: {
      currentSchemaVersion: EXPORT_SCHEMA_VERSION,
      supportedFrom: [...SUPPORTED_EXPORT_SCHEMA_VERSIONS]
    }
  };
}

export function migrateExportPayload<T extends { session: RecordingSession }>(payload: T): T & { session: RecordingSession } {
  if (!SUPPORTED_EXPORT_SCHEMA_VERSIONS.includes(payload.session.schemaVersion)) {
    throw new Error(`UNSUPPORTED_EXPORT_SCHEMA:${payload.session.schemaVersion}`);
  }
  return { ...payload, session: migrateSessionForExport(payload.session) };
}

export function verifyExportIntegrity(
  manifest: ExportManifest,
  files: Record<string, Uint8Array | undefined>
): { valid: boolean; invalidFiles: string[]; missingFiles: string[] } {
  const invalidFiles: string[] = [];
  const missingFiles: string[] = [];
  for (const [name, expected] of Object.entries(manifest.files)) {
    const file = files[name];
    if (!file) { missingFiles.push(name); continue; }
    if (file.byteLength !== expected.byteLength || sha256(file) !== expected.sha256) invalidFiles.push(name);
  }
  return { valid: invalidFiles.length === 0 && missingFiles.length === 0, invalidFiles, missingFiles };
}
