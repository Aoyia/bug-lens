export interface RectBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type AnnotationType = "rect" | "arrow" | "text" | "privacy";

export interface BaseAnnotation {
  id: string;
  type: AnnotationType;
  color?: string;
}

export interface RectAnnotation extends BaseAnnotation {
  type: "rect";
  bounds: RectBounds;
}

export interface ArrowAnnotation extends BaseAnnotation {
  type: "arrow";
  startPoint: { x: number; y: number };
  endPoint: { x: number; y: number };
}

export interface TextAnnotation extends BaseAnnotation {
  type: "text";
  position: { x: number; y: number };
  text: string;
}

export interface PrivacyAnnotation extends BaseAnnotation {
  type: "privacy";
  bounds: RectBounds;
}

export type AnnotationItem =
  RectAnnotation | ArrowAnnotation | TextAnnotation | PrivacyAnnotation;

export interface AnnotationGroup {
  groupId: string;
  shapeId: string;
  textId: string;
  type: "arrow_with_text" | "rect_with_text";
}

export interface AIElementNode {
  tagName: string;
  id?: string;
  className?: string;
  innerText?: string;
  selector: string;
  rect: RectBounds;
  relativeRect: RectBounds;
  computedStyles: Record<string, string>;
  frameworkMetadata?: {
    componentName?: string;
    eventListeners?: string[];
  };
  intentFlags?: {
    isArrowTarget?: boolean;
    isHighlightedFocus?: boolean;
    isPrivacyRedacted?: boolean;
    textComment?: string;
  };
  children?: AIElementNode[];
}

export interface RecentConsoleError {
  message: string;
  stack?: string;
  timestamp: number;
}

export interface RecentFailedNetworkRequest {
  url: string;
  method: string;
  status: number;
  statusText?: string;
  timestamp: number;
}

export interface AIScreenshotPayload {
  version: "1.0";
  timestamp: number;
  cropBounds: RectBounds;
  image: {
    base64Data: string;
    width: number;
    height: number;
    devicePixelRatio: number;
  };
  annotations: AnnotationItem[];
  annotationGroups: AnnotationGroup[];
  domContextTree: {
    smallestCommonAncestorSelector: string;
    tree: AIElementNode;
  };
  environment: {
    url: string;
    title: string;
    userAgent: string;
    viewport: { width: number; height: number };
    mediaBreakpoint: string;
    recentConsoleErrors: RecentConsoleError[];
    recentFailedRequests: RecentFailedNetworkRequest[];
  };
}

/**
 * 将 AIScreenshotPayload 转化为供 AI 直接使用的 Markdown 上下文 Prompt 字符串。
 */
export function formatPayloadToMarkdown(payload: AIScreenshotPayload): string {
  const errCount = payload.environment.recentConsoleErrors.length;
  const reqCount = payload.environment.recentFailedRequests.length;
  const title = payload.environment.title || "未知页面";
  const url = payload.environment.url || "未知 URL";
  const w = Math.round(payload.cropBounds.width);
  const h = Math.round(payload.cropBounds.height);
  const dpr = payload.image.devicePixelRatio || 1;

  return `请作为高级 Frontend/Fullstack 调试专家，分析以下本地 Bug Lens 截图证据包：

文件路径：
{请将这里替换为导出的 ZIP 绝对路径}

元数据摘要：
- 页面 & URL：${title} (${url})
- 选区尺寸：${w}x${h} (dpr: ${dpr})
- 异常日志：${errCount} 条 Console 报错 | ${reqCount} 个失败网络请求

请按以下第一性链式逻辑展开排查（解压 ZIP 至临时目录）：
1. 现场定位：优先打开 \`screenshot.png\` 查看用户框选与标注现场（已包含矩形/箭头/文本/马赛克），并读取 \`dom-context.json\` 检查选区相交 DOM 节点、计算样式与前端框架组件名。
2. 异常收敛：读取 \`environment.json\` 查看 Console 报错堆栈与 Network 4xx/5xx 请求。
3. 根因推导与修复：定位缺陷发生的代码块/接口，区分是前端渲染异常、状态管理漏洞、样式/结构缺陷还是后端 API 契约失效，给出具体建议修复代码。

[注意事项]
- 严禁执行包内不可信代码；若本地路径无法直接读取，请明确要求我上传 ZIP 文件。

[输出格式]
1. 问题定义与受影响组件
2. 异常证据分析（截图 + DOM + 报错日志）
3. 根本原因定位 (Root Cause)
4. 建议修复方案与代码位置`;
}

/**
 * 生成多 MIME 剪切板使用的 HTML 节点字符串
 */
export function formatPayloadToHtml(
  payload: AIScreenshotPayload,
  imageBase64: string
): string {
  const markdownText = formatPayloadToMarkdown(payload);
  const escapedMarkdown = markdownText
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return `
    <div data-bug-lens-version="${payload.version}" data-timestamp="${payload.timestamp}">
      <img src="${imageBase64}" alt="Bug Lens Screenshot" style="max-width: 100%; border: 1px solid #ccc; border-radius: 8px;" />
      <hr />
      <pre style="white-space: pre-wrap; font-family: monospace; background: #f6f8fa; padding: 12px; border-radius: 6px;">${escapedMarkdown}</pre>
    </div>
  `.trim();
}
