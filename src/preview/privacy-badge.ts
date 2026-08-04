import type { RecordingSession } from "../shared/protocol.ts";
import { t } from "../shared/i18n.ts";

/**
 * 在预览页顶栏渲染常驻隐私模式角标：
 * - safe 模式：中性样式，提示「安全模式」
 * - raw 模式：红色警示样式，提示「原始模式 · 未脱敏」
 * 数据源为会话录制时的隐私选项（session.options.privacyMode）。
 */
export function applyPrivacyBadge(
  root: Pick<Document, "getElementById">,
  session: RecordingSession | undefined
): void {
  const badge = root.getElementById("privacy-badge");
  if (!badge) return;
  if (!session) {
    badge.hidden = true;
    return;
  }
  const mode = session.options.privacyMode;
  const isRaw = mode === "raw";
  badge.hidden = false;
  badge.textContent = isRaw ? t("privacyModeRaw") : t("privacyModeSafe");
  badge.title = isRaw ? t("privacyModeRawDesc") : t("privacyModeSafeDesc");
  badge.classList.toggle("is-raw", isRaw);
  badge.classList.toggle("is-safe", !isRaw);
}
