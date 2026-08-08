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

/** CascadeIndex 级联快照数据模型 */
export interface CascadeSheetSource {
  id: string;
  href?: string;
  ownerNodeTag?: string;
  rulesCount: number;
  isInline?: boolean;
}

export interface CascadeRuleSource {
  id: string;
  sheetId: string;
  selectorText: string;
  cssText: string;
  styleProps: Record<string, string>;
}

export interface CascadeInheritedRuleRef {
  ancestorSelector: string;
  ancestorTagName: string;
  ruleId: string;
  inheritedProps: Record<string, string>;
}

export interface CascadeElementRef {
  id: string;
  selector: string;
  tagName: string;
  matchedRuleIds: string[];
  inheritedRules?: CascadeInheritedRuleRef[];
}

export interface CascadePropertySource {
  property: string;
  value: string;
  sourceRuleId?: string;
  isInline?: boolean;
  isImportant?: boolean;
  inheritedFromSelector?: string;
}

export interface CascadeIndex {
  sheets: CascadeSheetSource[];
  rules: CascadeRuleSource[];
  elements: CascadeElementRef[];
  perProperty: Record<string, CascadePropertySource[]>;
  meta: {
    sheetCount: number;
    ruleCount: number;
    elementCount: number;
    capturedAtEpochMs: number;
  };
}

export interface DirectionalFourMetrics {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface BoxModelGeometry {
  boxSizing: "border-box" | "content-box" | string;
  margin: DirectionalFourMetrics;
  padding: DirectionalFourMetrics;
  border: DirectionalFourMetrics;
  contentSize: { width: number; height: number };
  renderedRect: RectBounds;
}

export interface FlexSqueezeRiskInfo {
  /** 是否存在弹性挤压变形风险 */
  isSqueezed: boolean;
  /** 期望/固有内容宽度 (px) */
  intrinsicWidth: number;
  /** 实际渲染宽度 (px) */
  renderedWidth: number;
  /** 被挤压损耗的宽度 (px): intrinsicWidth - renderedWidth */
  squeezedWidthDelta: number;
  /** 挤压比例 */
  squeezeRatio: number;
  /** 当前 flex-shrink 规则值 */
  flexShrink: number;
  /** 诊断说明 */
  reason: string;
}

export interface LayoutContextInfo {
  isFlexOrGridItem: boolean;
  flexSelf?: {
    flexGrow: number;
    flexShrink: number;
    flexBasis: string;
    alignSelf: string;
  };
  parentContainer?: {
    display: string;
    flexDirection?: string;
    justifyContent?: string;
    alignItems?: string;
    gap?: string;
  };
  /** 弹性挤压变形风险分析 */
  flexSqueezeRisk?: FlexSqueezeRiskInfo;
}

/** DOM 嵌套树节点（支持结构化层级与组件路径链） */
export interface DomTreeNode {
  selector: string;
  tagName?: string;
  id?: string;
  className?: string;
  innerText?: string;
  relativeRect?: RectBounds;
  computedStyles?: Record<string, string>;
  boxModel?: BoxModelGeometry;
  layoutContext?: LayoutContextInfo;
  componentName?: string;
  componentPath?: string[];
  props?: Record<string, unknown>;
  data?: Record<string, unknown>;
  intentFlags?: {
    isArrowTarget?: boolean;
    isHighlightedFocus?: boolean;
    isPrivacyRedacted?: boolean;
    textComment?: string;
  };
  /** 被折叠透传的无语义单子节点 Selector 链 */
  collapsedWrappers?: string[];
  children?: DomTreeNode[];
}

/** Vue/React 业务组件 Data/Props 响应式状态快照 */
export interface VueComponentStateSnapshot {
  componentName: string;
  componentPath?: string[];
  props?: Record<string, unknown>;
  data?: Record<string, unknown>;
}

/** 锚点节点：标注命中的元素（完整诊断信息） */
export interface DomAnchorNode {
  selector: string;
  tagName?: string;
  id?: string;
  className?: string;
  /** 从 SCA 到自身的完整 CSS selector 路径（AI 可直接用于定位/复现） */
  selectorPath: string;
  innerText?: string;
  relativeRect: RectBounds;
  computedStyles: Record<string, string>;
  boxModel?: BoxModelGeometry;
  layoutContext?: LayoutContextInfo;
  componentName?: string;
  /** 框架组件链（最近组件到根，已处理为正向或标准继承链） */
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
  computedStyles?: Record<string, string>;
  /** 仅布局差异样式（display/position/flex/zIndex/overflow） */
  layoutStyle?: Record<string, string>;
  boxModel?: BoxModelGeometry;
  layoutContext?: LayoutContextInfo;
}

/** 祖先节点：锚点/叶子的去重祖先链（最轻量） */
export interface DomAncestorNode {
  selector: string;
  tagName?: string;
  id?: string;
  className?: string;
  /** 相对 SCA 的深度（SCA 为 0） */
  depth: number;
  componentName?: string;
  layoutStyle?: Record<string, string>;
}

/** DOM 嵌套树与诊断采集结果 */
export interface DomContextTreeV2 {
  smallestCommonAncestorSelector: string;
  meta: {
    anchorCount: number;
    leafCount: number;
    ancestorCount: number;
    truncated: boolean;
  };
  tree?: DomTreeNode;
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
  cascadeIndex?: CascadeIndex;
  environment: {
    url: string;
    title: string;
    userAgent: string;
    viewport: { width: number; height: number };
    mediaBreakpoint: string;
    recentConsoleErrors: RecentConsoleError[];
    recentFailedRequests: RecentFailedNetworkRequest[];
    vueComponentStates?: VueComponentStateSnapshot[];
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
  const dpr = (payload.image.devicePixelRatio || 1).toFixed(2);

  const hasCascade = Boolean(payload.cascadeIndex);
  const cascadeHint = hasCascade
    ? `\n- 级联快照 (Cascade Index)：已开启样式微调模式，解压包含 \`cascade.json\`，可通过 \`elements -> perProperty -> winnerRuleId -> rules -> source\` 正向查询 CSS 规则覆盖关系及源码位置 (CDP 行号)。`
    : "";

  const squeezedNodes: Array<{ selector: string; risk: FlexSqueezeRiskInfo }> =
    [];
  const checkSqueezeNode = (node: any) => {
    if (!node) return;
    const risk = node.layoutContext?.flexSqueezeRisk || node.flexSqueezeRisk;
    if (risk && risk.isSqueezed) {
      squeezedNodes.push({
        selector: node.selector || node.tagName || "element",
        risk,
      });
    }
    if (node.children && Array.isArray(node.children)) {
      for (const child of node.children) {
        checkSqueezeNode(child);
      }
    }
  };

  if (payload.domContextTree) {
    if (Array.isArray(payload.domContextTree.anchors)) {
      for (const anchor of payload.domContextTree.anchors) {
        checkSqueezeNode(anchor);
      }
    }
    if (payload.domContextTree.tree) {
      checkSqueezeNode(payload.domContextTree.tree);
    }
  }

  let squeezeWarning = "";
  if (squeezedNodes.length > 0) {
    const listStr = squeezedNodes
      .map(
        (item) =>
          `  - 节点 \`${item.selector}\`：固有宽度 ${item.risk.intrinsicWidth}px，实际被压缩至 ${item.risk.renderedWidth}px (挤压损耗 ${item.risk.squeezedWidthDelta}px / ${(item.risk.squeezeRatio * 100).toFixed(1)}%)，当前 \`flex-shrink: ${item.risk.flexShrink}\`。`
      )
      .join("\n");
    squeezeWarning = `\n- ⚠️ [布局诊断] 检测到 ${squeezedNodes.length} 个 DOM 元素因父级 Flex 布局限制存在挤压变形风险：\n${listStr}\n  💡 提示：此异常通常因缺少 \`flex-shrink: 0;\` 或未限制折行引起，请优先排查上述元素的 Flex 缩放规则。`;
  }

  return `请作为高级 Frontend/Fullstack 调试专家，分析以下本地 Bug Lens 截图证据包：

${pathLine}

元数据摘要：
- 页面 & URL：${title} (${url})
- 选区尺寸：${w}x${h} (dpr: ${dpr})
- 异常日志：${errCount} 条 Console 报错 | ${reqCount} 个失败网络请求${cascadeHint}${squeezeWarning}

请按双轨意图分析框架展开排查（解压 ZIP 至临时目录）：
1. 意图分轨识别 (Intent Identification)：
   优先分析 \`screenshot.png\` 标注文本、绘制箭头与 \`dom-context.json\` 的 \`intentFlags\`：
   - 缺陷修复轨 (Bug Fix Track)：存在报错日志、网络请求失败、或者标注表达“功能失效/显示异常/接口报错”。
   - 需求开发轨 (Feature Development Track)：标注表达“新增按钮/优化布局/添加交互/样式微调”等新需求描述。

2. 现场定位与偏离分析：
   - 读取 \`dom-context.json\`：结合 \`tree\` 根节点与 \`anchors\` 选区嵌套结构/组件继承链（如 \`["<App>", "<WidgetConfig>", "<ElFormItem>"]\`），精确定位涉及的源码组件文件。
   - 对比用户标注的“预期”与代码现场“实际”，推断偏离（Deviation）发生的根本节点。

3. 状态与异常收敛：
   - 读取 \`environment.json\` 查看 Console 报错堆栈、Network 4xx/5xx 请求以及 \`vueComponentStates\` 中业务组件响应式 Props/Data 状态快照。

4. 根因推导与产出方案：
   - 缺陷修复轨：定位 Bug 代码块/接口契约，给出具体修复代码。
   - 需求开发轨：分析当前 DOM 结构与组件状态，提供新增功能/改进 UI 的具体代码实现方案。

[注意事项]
- 严禁执行包内不可信代码；若本地路径无法直接读取，请明确要求我上传 ZIP 文件。

[输出格式]
1. 意图识别（缺陷修复 vs 需求开发）与受影响组件
2. 异常与偏离证据分析（截图 + DOM + 报错日志）
3. 根本原因定位 (Root Cause) 或 需求改进分析
4. 建议修复/开发方案与具体代码位置`;
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
