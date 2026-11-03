const WINDOW_ASSIGNMENT_PREFIX_RE =
  /^\s*(?:window|globalThis)\.__BUG_LENS_[A-Z0-9_]+__\s*=\s*/;

/**
 * 安全解析 `window.__BUG_LENS_XXX__ = <JSON>;` 包装文件。
 * 绝不执行包内 JS 代码（禁止 eval / vm.runInContext / new Function）。
 */
export function parseWindowAssignmentJson<T = unknown>(
  rawText: string,
  fileLabel = "js-data"
): T {
  const match = WINDOW_ASSIGNMENT_PREFIX_RE.exec(rawText);
  if (!match) {
    throw new Error(
      `INVALID_JS_JSON_WRAPPER: ${fileLabel} does not start with expected window.__BUG_LENS_*__ assignment`
    );
  }
  let jsonBody = rawText.slice(match[0].length).trim();
  if (jsonBody.endsWith(";")) {
    jsonBody = jsonBody.slice(0, -1).trimEnd();
  }
  try {
    return JSON.parse(jsonBody) as T;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `INVALID_JS_JSON_PAYLOAD: Failed to parse JSON in ${fileLabel}: ${message}`
    );
  }
}
