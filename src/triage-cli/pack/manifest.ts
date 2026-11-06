import { createHash } from "node:crypto";
import type { ExportManifest, IntegrityReport } from "./types.ts";

export const SUPPORTED_SCHEMA_VERSIONS = [1, 2, 3, 4] as const;
export const MAX_SUPPORTED_SCHEMA_VERSION = 4;

export function parseManifest(
  rawBytes?: Uint8Array
): ExportManifest | undefined {
  if (!rawBytes) return undefined;
  try {
    const text = new TextDecoder().decode(rawBytes);
    return JSON.parse(text) as ExportManifest;
  } catch {
    return undefined;
  }
}

export function verifyPackIntegrity(
  manifest: ExportManifest | undefined,
  files: Map<string, Uint8Array>,
  skippedFiles: Set<string>
): IntegrityReport {
  if (!manifest) {
    return {
      hasManifest: false,
      valid: true,
      checkedCount: 0,
      skippedCount: skippedFiles.size,
      mismatches: [],
    };
  }

  const schemaVersion = manifest.schemaVersion;
  let schemaWarning: string | undefined;
  if (
    typeof schemaVersion === "number" &&
    !SUPPORTED_SCHEMA_VERSIONS.includes(
      schemaVersion as (typeof SUPPORTED_SCHEMA_VERSIONS)[number]
    )
  ) {
    if (schemaVersion > MAX_SUPPORTED_SCHEMA_VERSION) {
      schemaWarning = `Package schemaVersion (${schemaVersion}) is newer than max supported version (${MAX_SUPPORTED_SCHEMA_VERSION}). Reading in best-effort mode; please run 'npx skills update bug-lens-triage' if fields are missing.`;
    } else {
      schemaWarning = `Package schemaVersion (${schemaVersion}) is not in standard supported list (${SUPPORTED_SCHEMA_VERSIONS.join(", ")}). Reading in best-effort mode.`;
    }
  }

  const manifestFiles = manifest.files ?? {};
  let checkedCount = 0;
  let skippedCount = 0;
  const mismatches: string[] = [];

  for (const [filePath, expected] of Object.entries(manifestFiles)) {
    if (skippedFiles.has(filePath)) {
      skippedCount += 1;
      continue;
    }
    const actualBytes = files.get(filePath);
    if (!actualBytes) {
      mismatches.push(`${filePath}: missing in archive`);
      continue;
    }
    checkedCount += 1;
    if (
      typeof expected.byteLength === "number" &&
      actualBytes.byteLength !== expected.byteLength
    ) {
      mismatches.push(
        `${filePath}: byteLength mismatch (expected ${expected.byteLength}, got ${actualBytes.byteLength})`
      );
      continue;
    }
    if (typeof expected.sha256 === "string" && expected.sha256.length > 0) {
      const actualHash = createHash("sha256").update(actualBytes).digest("hex");
      if (actualHash.toLowerCase() !== expected.sha256.toLowerCase()) {
        mismatches.push(`${filePath}: sha256 mismatch`);
      }
    }
  }

  return {
    hasManifest: true,
    valid: mismatches.length === 0,
    schemaVersion,
    schemaWarning,
    checkedCount,
    skippedCount,
    mismatches,
  };
}
