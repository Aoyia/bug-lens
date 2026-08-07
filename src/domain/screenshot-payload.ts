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

/**
 * DOM 三段式采集（锚点优先，剃刀原则）：
 * - anchors：用户标注精确命中的元素，携带完整诊断信息（含组件链）；
 * - leaves：选区内含非空文本的有效叶子，轻量信息；
 * - ancestors：锚点与叶子的去重祖先链，仅保留定位字段。
 * 替代原全量相交 DOM 树，压缩体积的同时提升信息密度。
 */

/** 锚点节点：标注命中的元素（完整诊断信息） */
export interface DomAnchorNode {
  tagName: string;
  id?: string;
  className?: string;
  selector: string;
  /** 从 SCA 到自身的完整 CSS selector 路径（AI 可直接用于定位/复现） */
  selectorPath: string;
  innerText?: string;
  relativeRect: RectBounds;
  computedStyles: Record<string, string>;
  componentName?: string;
  /** 框架组件链（最近组件到根，≤5 层，已去重） */
  componentPath?: string[];
  intentFlags: {
    isArrowTarget?: boolean;
    isHighlightedFocus?: boolean;
    isPrivacyRedacted?: boolean;
    textComment?: string;
  };
}

/** 叶子节点：选区内含非空文本的有效叶子（轻量） */
export interface DomLeafNode {
  tagName: string;
  id?: string;
  selector: string;
  innerText?: string;
  relativeRect: RectBounds;
  componentName?: string;
  /** 仅布局差异样式（display/position/flex/zIndex/overflow） */
  layoutStyle?: Record<string, string>;
}

/** 祖先节点：锚点/叶子的去重祖先链（最轻量） */
export interface DomAncestorNode {
  tagName: string;
  id?: string;
  className?: string;
  selector: string;
  /** 相对 SCA 的深度（SCA 为 0） */
  depth: number;
  componentName?: string;
  layoutStyle?: Record<string, string>;
}

/** DOM 三段式采集结果 */
export interface DomContextTreeV2 {
  smallestCommonAncestorSelector: string;
  meta: {
    anchorCount: number;
    leafCount: number;
    ancestorCount: number;
    truncated: boolean;
  };
  anchors: DomAnchorNode[];
  leaves: DomLeafNode[];
  ancestors: DomAncestorNode[];
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
  domContextTree: DomContextTreeV2;
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

/** 剪贴板提示词在尚未拿到真实路径时使用的占位符（供用户在下载失败时手动替换） */
const ZIP_PATH_PLACEHOLDER = "文件路径：\n{请将这里替换为导出的 ZIP 绝对路径}";

/** zip 包内 ai-prompt.md 使用的引导文案：打包先于下载无法预知真实路径，避免误导 AI 去找不存在的路径 */
const ZIP_PATH_GUIDANCE =
  "文件路径：\n（ZIP 已下载至本地。真实绝对路径已写入剪贴板提示词，请以剪贴板中的路径为准；若剪贴板不可用，请手动填写本 ZIP 的绝对路径。）";

function buildPromptBody(
  payload: AIScreenshotPayload,
  pathLine: string
): string {
  const errCount = payload.environment.recentConsoleErrors.length;
  const reqCount = payload.environment.recentFailedRequests.length;
  const title = payload.environment.title || "未知页面";
  const url = payload.environment.url || "未知 URL";
  const w = Math.round(payload.cropBounds.width);
  const h = Math.round(payload.cropBounds.height);
  const dpr = payload.image.devicePixelRatio || 1;

  return `请作为高级 Frontend/Fullstack 调试专家，分析以下本地 Bug Lens 截图证据包：

${pathLine}

元数据摘要：
- 页面 & URL：${title} (${url})
- 选区尺寸：${w}x${h} (dpr: ${dpr})
- 异常日志：${errCount} 条 Console 报错 | ${reqCount} 个失败网络请求

请按以下第一性链式逻辑展开排查（解压 ZIP 至临时目录）：
1. 现场定位：优先打开 \`screenshot.png\` 查看用户框选与标注现场（已包含矩形/箭头/文本/马赛克），并读取 \`dom-context.json\`：\`anchors\` 是标注精确命中的元素（含 \`componentPath\` 组件链与 \`selectorPath\` 定位路径）、\`leaves\` 是选区内含文本的有效叶子、\`ancestors\` 是其祖先链，据此定位相关代码。
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
 * 将 AIScreenshotPayload 转化为供 AI 直接使用的 Markdown 上下文 Prompt 字符串。
 * 传入 zipPath 时（下载完成拿到真实绝对路径后）会替换路径占位符，供 AI 直接读取 ZIP。
 */
export function formatPayloadToMarkdown(
  payload: AIScreenshotPayload,
  zipPath?: string
): string {
  const pathLine = zipPath ? `文件路径：\n${zipPath}` : ZIP_PATH_PLACEHOLDER;
  return buildPromptBody(payload, pathLine);
}

/**
 * 生成 zip 包内 ai-prompt.md 使用的提示词：打包先于下载，无法预知真实绝对路径，
 * 使用引导文案而非占位符，避免误导 AI 去寻找不存在的路径。
 */
export function formatPayloadToMarkdownForZip(
  payload: AIScreenshotPayload
): string {
  return buildPromptBody(payload, ZIP_PATH_GUIDANCE);
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
