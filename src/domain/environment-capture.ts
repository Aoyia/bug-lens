import type { EnvironmentInfo } from "../shared/protocol";
import { isEn, t } from "../shared/i18n.ts";

/**
 * 采集页面主帧的运行环境快照（系统/浏览器/分辨率/视口）。
 * 仅应在页面上下文（content script 主帧）中调用；screen 对象在
 * Service Worker / iframe 中不可靠。
 */
export function captureEnvironment(): EnvironmentInfo | undefined {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return undefined;
  }
  if (window.top !== window) return undefined; // 只由主帧上报，避免 iframe 噪音
  try {
    const nav = window.navigator;
    return {
      userAgent: nav?.userAgent || "unknown",
      platform: nav?.platform || "unknown",
      language: nav?.language || "unknown",
      screenWidth: window.screen?.width ?? 0,
      screenHeight: window.screen?.height ?? 0,
      devicePixelRatio: window.devicePixelRatio ?? 1,
      viewportWidth: window.innerWidth || 0,
      viewportHeight: window.innerHeight || 0,
      online: typeof nav?.onLine === "boolean" ? nav.onLine : true,
      capturedAtEpochMs: Date.now(),
    };
  } catch {
    return undefined;
  }
}

/** 从 userAgent 中解析出可读的操作系统名称，用于证据摘要展示。 */
export function describeOsFromUserAgent(userAgent: string): string {
  const ua = userAgent;
  if (/Windows NT 10\.0/.test(ua)) return "Windows 10/11";
  if (/Windows NT 6\.3/.test(ua)) return "Windows 8.1";
  if (/Windows NT 6\.1/.test(ua)) return "Windows 7";
  if (/Windows/.test(ua)) return "Windows";
  if (/Mac OS X/.test(ua)) {
    const match = ua.match(/Mac OS X (\d+[._]\d+[._]?\d*)/);
    return match ? `macOS ${match[1].replace(/_/g, ".")}` : "macOS";
  }
  if (/Android/.test(ua)) return "Android";
  if (/iPhone|iPad|iPod/.test(ua)) return "iOS";
  if (/Linux/.test(ua)) return "Linux";
  if (/CrOS/.test(ua)) return "ChromeOS";
  return t("unknownOs");
}

/** 从 userAgent 中解析浏览器名称与主要版本。 */
export function describeBrowserFromUserAgent(userAgent: string): string {
  const ua = userAgent;
  const chrome = ua.match(/Chrome\/(\d+)/);
  const edge = ua.match(/Edg\/(\d+)/);
  const firefox = ua.match(/Firefox\/(\d+)/);
  const safari = ua.match(/Version\/(\d+).*Safari/);
  if (edge) return `Edge ${edge[1]}`;
  if (chrome) return `Chrome ${chrome[1]}`;
  if (firefox) return `Firefox ${firefox[1]}`;
  if (safari) return `Safari ${safari[1]}`;
  return t("unknownBrowser");
}

/** 生成供证据摘要/README 使用的一行环境描述。 */
export function formatEnvironmentSummary(
  environment?: EnvironmentInfo
): string {
  if (!environment) return "";
  const os = describeOsFromUserAgent(environment.userAgent);
  const browser = describeBrowserFromUserAgent(environment.userAgent);
  const screen = `${environment.screenWidth}×${environment.screenHeight}@${environment.devicePixelRatio}x`;
  const viewport = `${environment.viewportWidth}×${environment.viewportHeight}`;
  const screenLabel = isEn() ? "Screen" : "屏幕";
  const viewportLabel = isEn() ? "Viewport" : "视口";
  return `${os} · ${browser} · ${environment.language} · ${screenLabel} ${screen} · ${viewportLabel} ${viewport}`;
}
