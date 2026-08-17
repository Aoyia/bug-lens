import type {
  FrameworkComponentNode,
  FrameworkSnapshot,
} from "../shared/protocol";
import { t } from "../shared/i18n.ts";

function escapeStr(str: any): string {
  if (typeof str !== "string") str = String(str);
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function componentColor(framework: "vue" | "react"): string {
  return framework === "vue" ? "#42b883" : "#61dafb";
}

function componentBg(framework: "vue" | "react"): string {
  return framework === "vue" ? "#e8f8f0" : "#e8f4fd";
}

function frameworkLabel(framework: "vue" | "react", version: number): string {
  const label = framework === "vue" ? "Vue" : "React";
  return `${label} ${version}`;
}

function renderTreeNode(node: FrameworkComponentNode, depth: number): string {
  const indent = depth * 18;
  const isTarget = node.isTarget;
  const color = componentColor(node.framework);
  const bg = componentBg(node.framework);

  let html = `<div style="display:flex;align-items:center;gap:4px;padding:1px 0;padding-left:${indent}px;font-size:11px;line-height:1.6">`;

  if (depth > 0) {
    html += `<span style="color:#a0aec0;margin-right:2px">├─</span>`;
  }

  const nameHtml = isTarget
    ? `<strong style="color:${color};font-weight:700;background:${bg};padding:1px 4px;border-radius:3px">${escapeStr(node.componentName)}</strong>`
    : `<span style="color:#2d3748">${escapeStr(node.componentName)}</span>`;

  html += nameHtml;

  if (isTarget) {
    html += ` <span style="font-size:9px;color:#a0aec0;background:#f7fafc;padding:0 4px;border-radius:2px">${t("frameworkTargetLabel")}</span>`;
  }

  if (node.props) {
    const count = Object.keys(node.props).length;
    html += ` <span style="font-size:9px;color:#718096">${t("fwPropsCount", [String(count)])}</span>`;
  }
  if (node.state) {
    const count = Object.keys(node.state).length;
    html += ` <span style="font-size:9px;color:#718096">${t("fwStateCount", [String(count)])}</span>`;
  }

  html += `</div>`;

  if (node.children) {
    for (const child of node.children) {
      html += renderTreeNode(child, depth + 1);
    }
  }

  return html;
}

function renderTargetDetails(node: FrameworkComponentNode): string {
  const propsJson = node.props
    ? JSON.stringify(node.props, null, 2)
    : undefined;
  const stateJson = node.state
    ? JSON.stringify(node.state, null, 2)
    : undefined;

  if (!propsJson && !stateJson) return "";

  let html = `<div style="margin-top:6px;font-size:11px;background:#f8fafc;border:1px solid #e2e8f0;padding:6px;border-radius:4px">`;
  if (propsJson) {
    html += `<div style="margin-bottom:4px"><span style="font-weight:600;color:#2d3748">${t("fwProps")}:</span> <pre style="margin:2px 0;font-size:10px;background:#ffffff;padding:4px;border-radius:3px;max-height:80px;overflow:auto">${escapeStr(propsJson)}</pre></div>`;
  }
  if (stateJson) {
    html += `<div><span style="font-weight:600;color:#2d3748">${t("fwState")}:</span> <pre style="margin:2px 0;font-size:10px;background:#ffffff;padding:4px;border-radius:3px;max-height:80px;overflow:auto">${escapeStr(stateJson)}</pre></div>`;
  }
  html += `</div>`;
  return html;
}

export function renderFrameworkSnapshot(framework?: FrameworkSnapshot): string {
  if (!framework) return "";

  const target = framework.targetComponent;
  const root = framework.rootComponent;
  const chain = framework.parentChain || [];

  if (!target && !root && chain.length === 0) return "";

  const fw = target?.framework || root?.framework || "vue";
  const ver = target?.version || root?.version || 3;
  const color = componentColor(fw);
  const bg = componentBg(fw);
  const label = frameworkLabel(fw, ver);

  let html = `<div class="framework-snapshot-section" style="margin-top:6px;padding:6px;background:${bg};border:1px solid ${color}33;border-radius:4px">`;

  html += `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
    <span style="font-size:11px;font-weight:700;color:${color}">${escapeStr(label)} ${t("componentContext")}</span>
  </div>`;

  if (chain.length > 0) {
    html += `<div style="font-size:11px;color:#2d3748;overflow-x:auto;white-space:nowrap;margin-bottom:4px">`;
    html += chain
      .map((node) => {
        const isTarget = node.isTarget;
        const name = `<${node.componentName}>`;
        return isTarget
          ? `<strong style="color:${color};font-weight:700;background:${bg};padding:1px 4px;border-radius:3px">${escapeStr(name)}</strong>`
          : `<span style="color:#35495e">${escapeStr(name)}</span>`;
      })
      .join(` <span style='color:#a0aec0;margin:0 2px'>&gt;</span> `);
    html += `</div>`;
  }

  if (root) {
    html += `<div style="margin-top:4px;font-size:11px;color:#2d3748">`;
    html += renderTreeNode(root, 0);
    html += `</div>`;
  }

  if (target) {
    html += renderTargetDetails(target);
  }

  html += `</div>`;

  return html;
}
