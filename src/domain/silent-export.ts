import type { CaptureIssue, RecordingSession } from "../shared/protocol";
import { sanitizeText } from "./privacy-policy";
import type { RecordingSessionEvent } from "./recording-session";

/**
 * offscreen/export-pack 消息的响应结构。
 */
export type SilentExportPackResult = {
  ok?: boolean;
  prompt?: string;
  blobUrl?: string;
  filename?: string;
  error?: string;
};

export type SilentExportResponse = {
  ok?: boolean;
  error?: string;
  session?: Pick<RecordingSession, "silentExportResult">;
};

/**
 * 只有后台明确确认静默导出成功，页面端才可以展示成功提示。
 * 消息协议失败、缺失会话或缺少结果均应视为失败，避免错误地提示用户“已下载”。
 */
export function getSilentExportFailure(
  response: SilentExportResponse | undefined,
  fallbackError: string
): string | undefined {
  if (!response?.ok) return response?.error || fallbackError;
  if (!response.session) return fallbackError;
  if (!response.session.silentExportResult?.ok)
    return response.session.silentExportResult?.error || fallbackError;
  return undefined;
}

/**
 * 判定一次静默导出的最终结果。
 * 捕获到异常、或打包结果不满足"可下载"条件时均视为失败，
 * 保证失败不会被伪装成成功。
 */
export function resolveSilentExportResult(
  packResult: SilentExportPackResult | undefined,
  caughtError: unknown
): { ok: boolean; error?: string } {
  if (caughtError !== undefined && caughtError !== null) {
    return { ok: false, error: String(caughtError) };
  }
  if (packResult?.ok && packResult.blobUrl && packResult.filename) {
    return { ok: true };
  }
  return { ok: false, error: packResult?.error ?? "导出未返回可下载文件" };
}

/**
 * 构建静默导出失败时写入会话的 capture-issue 事件，
 * 使失败可通过 QualitySummary.issues 在预览/历史中被用户看到。
 */
export function buildSilentExportFailureEvent(
  error: string,
  privacyMode: "safe" | "raw"
): RecordingSessionEvent {
  const issue: CaptureIssue = {
    code: "SILENT_EXPORT_FAILED",
    message: sanitizeText(`静默导出失败：${error}`, privacyMode),
    source: "export",
    recoverable: true,
    occurredAt: Date.now(),
  };
  return { type: "capture-issue", issue };
}

/**
 * 将提示词模板中的文件名/相对路径替换为 Chrome 下载完成后的实际物理绝对路径。
 */
export function injectAbsolutePathToPrompt(
  prompt: string,
  relativeFilename: string,
  absolutePath: string
): string {
  if (!prompt || !relativeFilename || !absolutePath) return prompt;
  return prompt
    .replace(`文件路径：\n${relativeFilename}`, `文件路径：\n${absolutePath}`)
    .replace(`File Path:\n${relativeFilename}`, `File Path:\n${absolutePath}`);
}
