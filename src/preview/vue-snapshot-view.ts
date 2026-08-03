import type { VueFrameworkSnapshot } from "../shared/protocol";

function escapeStr(str: any): string {
  if (typeof str !== "string") str = String(str);
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderVueSnapshotMarkup(vue?: VueFrameworkSnapshot): string {
  if (!vue) return "";

  const chain = [...(vue.parentChain || [])];
  if (vue.targetComponent) {
    chain.push(vue.targetComponent);
  }

  const breadcrumbs = chain
    .map((node) => {
      const isTarget = node.isTarget;
      const name = `<${node.componentName}>`;
      return isTarget
        ? `<strong style="color:#42b883;font-weight:700;background:#e8f8f0;padding:1px 4px;border-radius:3px">${escapeStr(name)}</strong>`
        : `<span style="color:#35495e">${escapeStr(name)}</span>`;
    })
    .join(" <span style='color:#a0aec0;margin:0 2px'>&gt;</span> ");

  let targetDetails = "";
  if (vue.targetComponent) {
    const propsJson = vue.targetComponent.props
      ? JSON.stringify(vue.targetComponent.props, null, 2)
      : undefined;
    const stateJson = vue.targetComponent.state
      ? JSON.stringify(vue.targetComponent.state, null, 2)
      : undefined;

    targetDetails = `
      <div style="margin-top:6px;font-size:11px;background:#f8fafc;border:1px solid #e2e8f0;padding:6px;border-radius:4px">
        ${propsJson ? `<div style="margin-bottom:4px"><span style="font-weight:600;color:#2d3748">Props:</span> <pre style="margin:2px 0;font-size:10px;background:#ffffff;padding:4px;border-radius:3px;max-height:80px;overflow:auto">${escapeStr(propsJson)}</pre></div>` : ""}
        ${stateJson ? `<div><span style="font-weight:600;color:#2d3748">State:</span> <pre style="margin:2px 0;font-size:10px;background:#ffffff;padding:4px;border-radius:3px;max-height:80px;overflow:auto">${escapeStr(stateJson)}</pre></div>` : ""}
      </div>
    `;
  }

  let storesMarkup = "";
  if (vue.stores && vue.stores.length > 0) {
    const storeItems = vue.stores
      .map((s) => {
        const stateJson = JSON.stringify(s.state, null, 2);
        return `
        <div style="margin-top:4px">
          <span style="font-weight:600;color:#3182ce">${escapeStr(s.type.toUpperCase())}${s.storeId ? ` (${escapeStr(s.storeId)})` : ""} State:</span>
          <pre style="margin:2px 0;font-size:10px;background:#ffffff;padding:4px;border-radius:3px;max-height:100px;overflow:auto">${escapeStr(stateJson)}</pre>
        </div>
      `;
      })
      .join("");

    storesMarkup = `
      <div style="margin-top:6px;font-size:11px;background:#ebf8ff;border:1px solid #bee3f8;padding:6px;border-radius:4px">
        ${storeItems}
      </div>
    `;
  }

  return `
    <div class="vue-snapshot-section" style="margin-top:6px;padding:6px;background:#f0fff4;border:1px solid #c6f6d5;border-radius:4px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
        <span style="font-size:11px;font-weight:700;color:#276749">Vue ${vue.version} 组件上下文</span>
      </div>
      <div style="font-size:11px;color:#2d3748;overflow-x:auto;white-space:nowrap">
        ${breadcrumbs}
      </div>
      ${targetDetails}
      ${storesMarkup}
    </div>
  `;
}
