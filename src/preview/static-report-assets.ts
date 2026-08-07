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

export async function loadStaticReportAssets(): Promise<StaticReportAssets> {
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
