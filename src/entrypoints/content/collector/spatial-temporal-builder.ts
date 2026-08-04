import {
  SpatialPruner,
  type BoundingBox,
  type SpatialSnapshotResult,
} from "./spatial-pruner";
import { TemporalTracer, type TemporalTraceResult } from "./temporal-tracer";

export interface SpatialTemporalCutResult {
  timestamp: number;
  url: string;
  title: string;
  viewport: { width: number; height: number };
  spatial: SpatialSnapshotResult;
  temporal: TemporalTraceResult;
  croppedDataUrl?: string;
}

/**
 * 空间-时间因果切片生成器
 * 将框选的像素区域、空间剪枝组件与时间追溯日志组合成结构化 Prompt Markdown / JSON
 */
export class SpatialTemporalSnapshotBuilder {
  /**
   * 构建多维切片对象
   */
  public static buildSnapshot(
    box: BoundingBox,
    croppedDataUrl?: string
  ): SpatialTemporalCutResult {
    const spatial = SpatialPruner.extractSpatialSnapshot(box);
    const temporal = TemporalTracer.traceRecentContext(Date.now(), 5000);

    return {
      timestamp: Date.now(),
      url: window.location.href,
      title: document.title,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      spatial,
      temporal,
      croppedDataUrl,
    };
  }

  /**
   * 格式化为可以直接贴给 LLM 或贴入 Jira 的结构化 Markdown
   */
  public static formatToMarkdown(snapshot: SpatialTemporalCutResult): string {
    const dateStr = new Date(snapshot.timestamp).toISOString();

    let md = `### 📸 Bug Context Snapshot (${dateStr})\n\n`;
    md += `**URL**: \`${snapshot.url}\`\n`;
    md += `**Viewport**: ${snapshot.viewport.width}x${snapshot.viewport.height}\n`;
    md += `**BoundingBox**: x=${Math.round(snapshot.spatial.boundingBox.x)}, y=${Math.round(
      snapshot.spatial.boundingBox.y
    )}, w=${Math.round(snapshot.spatial.boundingBox.width)}, h=${Math.round(
      snapshot.spatial.boundingBox.height
    )}\n\n`;

    // 组件信息
    md += `#### 🧩 Target Components (${snapshot.spatial.components.length})\n`;
    if (snapshot.spatial.components.length === 0) {
      md += `*No Vue/React components matched in bounding box.*\n\n`;
    } else {
      for (const comp of snapshot.spatial.components) {
        md += `- **[${comp.framework.toUpperCase()}] ${comp.name}**\n`;
        if (comp.props && Object.keys(comp.props).length > 0) {
          md += `  - *Props*: \`${JSON.stringify(comp.props)}\`\n`;
        }
        if (comp.state && Object.keys(comp.state).length > 0) {
          md += `  - *State*: \`${JSON.stringify(comp.state)}\`\n`;
        }
      }
      md += `\n`;
    }

    // 时间日志
    md += `#### ⏱️ Recent Logs & Errors (Last 5s)\n`;
    if (snapshot.temporal.logs.length === 0) {
      md += `*No error logs captured in recent 5s window.*\n\n`;
    } else {
      for (const log of snapshot.temporal.logs) {
        md += `- [${log.type.toUpperCase()}] ${log.message}\n`;
      }
      md += `\n`;
    }

    return md;
  }
}
