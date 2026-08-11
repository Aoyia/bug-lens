import type { ExportManifest, RecordingSession } from "../shared/protocol";
import type { ArchiveEntryIntegrity } from "./export-pipeline";
import { sha256 } from "./sha256.ts";

// 当前导出清单（ExportManifest）的 schema 版本，结构变更时递增
export const EXPORT_SCHEMA_VERSION = 3;
// 允许读取并迁移到当前版本的历史版本号列表
export const SUPPORTED_EXPORT_SCHEMA_VERSIONS = [1, 2, 3] as const;

/** 将持久化的 v1 会话补全为 v2 形态，确保能在 v2 证据包中安全序列化。 */
// v1 会话缺少 schemaVersion/storage 字段，此处补齐为 v2 形态以便统一序列化；v2 已是现版本，原样返回
export function migrateSessionForExport(
  session: RecordingSession
): RecordingSession {
  if (session.schemaVersion === 2) return session;
  return {
    ...session,
    schemaVersion: 2,
    storage: session.storage ?? { usedBytes: 0 },
  };
}

export function buildExportManifest(
  session: RecordingSession,
  files: ArchiveEntryIntegrity
): ExportManifest {
  return {
    format: "3.0",
    schemaVersion: EXPORT_SCHEMA_VERSION,
    createdAtEpochMs: Date.now(),
    sessionId: session.id,
    files,
    // migration 元信息：声明清单由当前版本生成，并列出可迁移读取的历史版本
    migration: {
      currentSchemaVersion: EXPORT_SCHEMA_VERSION,
      supportedFrom: [...SUPPORTED_EXPORT_SCHEMA_VERSIONS],
    },
  };
}

export function migrateExportPayload<T extends { session: RecordingSession }>(
  payload: T
): T & { session: RecordingSession } {
  // 版本不在支持列表中直接抛错，避免按错误结构迁移旧数据
  if (
    !SUPPORTED_EXPORT_SCHEMA_VERSIONS.includes(payload.session.schemaVersion)
  ) {
    throw new Error(
      `UNSUPPORTED_EXPORT_SCHEMA:${payload.session.schemaVersion}`
    );
  }
  return { ...payload, session: migrateSessionForExport(payload.session) };
}

export async function verifyExportIntegrity(
  manifest: ExportManifest,
  files: Record<string, Uint8Array | undefined>
): Promise<{ valid: boolean; invalidFiles: string[]; missingFiles: string[] }> {
  const invalidFiles: string[] = [];
  const missingFiles: string[] = [];
  // 对照清单逐文件校验：缺失的计入 missing，byteLength 或 sha256 不符的计入 invalid
  for (const [name, expected] of Object.entries(manifest.files)) {
    const file = files[name];
    if (!file) {
      missingFiles.push(name);
      continue;
    }
    if (
      file.byteLength !== expected.byteLength ||
      (await sha256(file)) !== expected.sha256
    )
      invalidFiles.push(name);
  }
  return {
    valid: invalidFiles.length === 0 && missingFiles.length === 0,
    invalidFiles,
    missingFiles,
  };
}
