import type {
  CascadeIndex,
  ExportManifest,
  IntegrityReport,
  ScreenshotDomContext,
  ScreenshotEnvironment,
} from "./types.ts";

export class LoadedScreenshotPack {
  readonly kind = "screenshot" as const;
  readonly packPath: string;
  readonly manifest?: ExportManifest;
  readonly integrity: IntegrityReport;
  readonly domContext?: ScreenshotDomContext;
  readonly environment?: ScreenshotEnvironment;
  readonly cascade?: CascadeIndex;
  readonly aiPrompt?: string;
  readonly files: Map<string, Uint8Array>;
  readonly skippedMediaFiles: Map<
    string,
    { originalSize: number; compressedSize: number }
  >;

  private textDecoder = new TextDecoder();

  constructor(params: {
    packPath: string;
    manifest?: ExportManifest;
    integrity: IntegrityReport;
    domContext?: ScreenshotDomContext;
    environment?: ScreenshotEnvironment;
    cascade?: CascadeIndex;
    aiPrompt?: string;
    files: Map<string, Uint8Array>;
    skippedMediaFiles: Map<
      string,
      { originalSize: number; compressedSize: number }
    >;
  }) {
    this.packPath = params.packPath;
    this.manifest = params.manifest;
    this.integrity = params.integrity;
    this.domContext = params.domContext;
    this.environment = params.environment;
    this.cascade = params.cascade;
    this.aiPrompt = params.aiPrompt;
    this.files = params.files;
    this.skippedMediaFiles = params.skippedMediaFiles;
  }

  getScreenshotImagePath(): string | undefined {
    for (const candidate of [
      "screenshot.jpg",
      "screenshot.png",
      "screenshot.jpeg",
      "screenshot.webp",
    ]) {
      if (this.files.has(candidate)) return candidate;
    }
    return undefined;
  }

  getTextFile(filePath: string): string | undefined {
    const normalized = filePath.replace(/^\.?\//, "");
    const bytes = this.files.get(normalized);
    if (!bytes) return undefined;
    return this.textDecoder.decode(bytes);
  }

  getBinaryFile(filePath: string): Uint8Array | undefined {
    const normalized = filePath.replace(/^\.?\//, "");
    return this.files.get(normalized);
  }

  listFiles(): Array<{
    path: string;
    byteLength: number;
    skippedMedia?: boolean;
  }> {
    const list: Array<{
      path: string;
      byteLength: number;
      skippedMedia?: boolean;
    }> = [];
    for (const [path, bytes] of this.files.entries()) {
      list.push({ path, byteLength: bytes.byteLength });
    }
    for (const [path, info] of this.skippedMediaFiles.entries()) {
      list.push({
        path,
        byteLength: info.originalSize,
        skippedMedia: true,
      });
    }
    return list.sort((a, b) => a.path.localeCompare(b.path));
  }
}
