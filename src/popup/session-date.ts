import { getLocale } from "../shared/i18n.ts";
import { formatDateTime } from "../shared/intl-formatter.ts";

/**
 * Popup 历史列表会话日期格式化（纯函数，便于单测）。
 *
 * 第一性原理：界面语言一致性——项目已系统化让用户可见信息跟随扩展界面语言
 * （chrome.i18n.getUILanguage → zh-CN/en-US），历史卡片上的日期同样是用户
 * 可见信息，若用无参 toLocaleString() 会跟随宿主系统语言，与界面语言不一致
 * （例如中文界面出现 "11/15/2023, 6:13:20 AM" 英文格式日期）。本函数统一
 * 以 getLocale() 作为默认 locale 格式化日期，保证日期格式与界面语言同步。
 */
export function formatSessionDate(
  epochMs: number,
  locale: string = getLocale()
): string {
  return formatDateTime(epochMs, undefined, locale);
}
