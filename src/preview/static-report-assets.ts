import type { StaticReportAssets } from "./evidence-package";

const sharedStyles = [
  "preview-base.css",
  "preview-workspace.css",
  "preview-interactions.css",
  "preview-console.css",
  "preview-network.css",
  "preview-image-viewer.css",
  "preview-issue-scenes.css",
  "report-static.css"
];

async function loadAsset(path: string): Promise<Response> {
  const response = await fetch(chrome.runtime.getURL(path));
  if (!response.ok) throw new Error(`无法读取离线报告资源 ${path}（${response.status}）`);
  return response;
}

export async function loadStaticReportAssets(): Promise<StaticReportAssets> {
  const [html, script, icon, ...styles] = await Promise.all([
    loadAsset("report-template.html").then((response) => response.text()),
    loadAsset("report-template.js").then((response) => response.text()),
    loadAsset("icons/icon_idle.png").then((response) => response.arrayBuffer()).then((buffer) => new Uint8Array(buffer)),
    ...sharedStyles.map((path) => loadAsset(path).then((response) => response.text()))
  ]);
  return { html, script, icon, styles: styles.join("\n") };
}
