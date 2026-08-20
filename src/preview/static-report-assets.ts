import type { StaticReportAssets } from "./evidence-package";
import { getLocale } from "../shared/i18n.ts";

const sharedStyles = [
  "preview-base.css",
  "preview-workspace.css",
  "preview-interactions.css",
  "preview-console.css",
  "preview-network.css",
  "preview-image-viewer.css",
  "preview-issue-scenes.css",
  "preview-stream.css",
  "report-static.css",
];

async function loadAsset(path: string): Promise<Response> {
  const response = await fetch(chrome.runtime.getURL(path));
  if (!response.ok)
    throw new Error(`无法读取离线报告资源 ${path}（${response.status}）`);
  return response;
}

const assetsCache = new Map<string, Promise<StaticReportAssets>>();

export function clearStaticReportAssetsCache(): void {
  assetsCache.clear();
}

async function loadStaticReportAssetsUncached(): Promise<StaticReportAssets> {
  const locale = getLocale();
  const localeFolder = locale === "en-US" ? "en" : "zh_CN";
  const [html, script, icon, localeMessages, ...styles] = await Promise.all([
    loadAsset("report-template.html").then((response) => response.text()),
    loadAsset("report-template.js").then((response) => response.text()),
    loadAsset("icons/icon_idle_32.png")
      .then((response) => response.arrayBuffer())
      .then((buffer) => new Uint8Array(buffer)),
    loadAsset(`_locales/${localeFolder}/messages.json`)
      .then((response) => response.json())
      .catch(
        () => undefined as Record<string, { message: string }> | undefined
      ),
    ...sharedStyles.map((path) =>
      loadAsset(path).then((response) => response.text())
    ),
  ]);
  return {
    html,
    script,
    icon,
    localeMessages,
    styles: styles.join("\n"),
  };
}

export function loadStaticReportAssets(): Promise<StaticReportAssets> {
  const version =
    typeof chrome !== "undefined" && chrome.runtime?.getManifest
      ? chrome.runtime.getManifest()?.version || "0.0.0"
      : "0.0.0";
  const locale = getLocale();
  const cacheKey = `${version}_${locale}`;

  const cached = assetsCache.get(cacheKey);
  if (cached) return cached;

  const loadPromise = loadStaticReportAssetsUncached().catch((error) => {
    // 失败时不缓存错误，允许后续重试
    assetsCache.delete(cacheKey);
    throw error;
  });

  assetsCache.set(cacheKey, loadPromise);
  return loadPromise;
}
