const SOURCEMAPPING_URL_REGEX = /\/\/[#@]\s*sourceMappingURL=([^\s'"]+)\s*$/m;
export const MAX_MAP_SIZE_BYTES = 20 * 1024 * 1024; // 20MB

export type FetchResult =
  | { success: true; mapData: any }
  | {
      success: false;
      reason: "FETCH_FAILED" | "SIZE_EXCEEDED" | "INVALID_MAP" | "TIMEOUT";
    };

export class SourceMapFetcher {
  public static extractSourceMappingUrl(scriptContent: string): string | null {
    if (!scriptContent) return null;
    const match = scriptContent.match(SOURCEMAPPING_URL_REGEX);
    return match && match[1] ? match[1].trim() : null;
  }

  public static resolveMapUrl(
    scriptUrl: string,
    sourceMappingUrl: string
  ): string {
    if (sourceMappingUrl.startsWith("data:")) {
      return sourceMappingUrl;
    }
    try {
      return new URL(sourceMappingUrl, scriptUrl).toString();
    } catch {
      return `${scriptUrl}.map`;
    }
  }

  public static async fetchMap(
    mapUrlOrDataUri: string,
    timeoutMs = 5000
  ): Promise<FetchResult> {
    try {
      if (mapUrlOrDataUri.startsWith("data:")) {
        return this.parseDataUri(mapUrlOrDataUri);
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(mapUrlOrDataUri, {
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!response.ok) {
        return { success: false, reason: "FETCH_FAILED" };
      }

      const contentLength = response.headers.get("content-length");
      if (contentLength && parseInt(contentLength, 10) > MAX_MAP_SIZE_BYTES) {
        return { success: false, reason: "SIZE_EXCEEDED" };
      }

      const text = await response.text();
      if (text.length > MAX_MAP_SIZE_BYTES) {
        return { success: false, reason: "SIZE_EXCEEDED" };
      }

      const mapData = JSON.parse(text);
      return { success: true, mapData };
    } catch (err: any) {
      if (err.name === "AbortError") {
        return { success: false, reason: "TIMEOUT" };
      }
      return { success: false, reason: "FETCH_FAILED" };
    }
  }

  private static parseDataUri(dataUri: string): FetchResult {
    try {
      const match = dataUri.match(
        /^data:application\/json;(?:charset=utf-8;)?base64,(.*)$/
      );
      if (match && match[1]) {
        const jsonStr = atob(match[1]);
        return { success: true, mapData: JSON.parse(jsonStr) };
      }
      const plainMatch = dataUri.match(/^data:application\/json,(.*)$/);
      if (plainMatch && plainMatch[1]) {
        const decoded = decodeURIComponent(plainMatch[1]);
        return { success: true, mapData: JSON.parse(decoded) };
      }
      return { success: false, reason: "INVALID_MAP" };
    } catch {
      return { success: false, reason: "INVALID_MAP" };
    }
  }
}
