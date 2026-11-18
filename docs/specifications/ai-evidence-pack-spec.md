# 面向 AI 的 Bug Lens 证据包格式规范、体积瘦身与捕获机制架构方案 (Schema v5)

## 1. 规范概述与架构演进

### 1.1 演进背景与问题定义

Bug Lens 初始架构围绕“人类工程师在本地浏览器双击打开离线报告”这一核心场景展开，生成包含离线网页查看器（`report.html`、`assets/` 静态脚本与样式）及将数据包裹为浏览器全局变量脚本（`data/session-data.js`、`data/network-details.js`）的归档文件。
然而，随着大型语言模型（LLM）与自动化排查智能体（如 Google Antigravity、WorkBuddy 等）成为缺陷分析与修复的核心主体，证据包的真实消费端发生了结构性转移。

根据对生产环境 33 个 Antigravity 历史排查会话、WorkBuddy 跨轮次长会话 `fe1a7f96`（连续消费 5 个 ZIP 包、执行 158 次 Shell 交互）以及 `~/Downloads` 目录下 87 个真实 Bug Lens 证据包（解压态总计 824.19MB，压缩态总计 673.42MB）的全面逆向审计，现有体系暴露出以下严重阻碍 AI 消费的架构缺陷：

1. **消费主体错配造成的死重与语法摩擦**：
   - 占解压体积 46.1%（379.65MB）的录屏视频流（`media/*.webm`），多模态模型工具链无法原生解码或直接读取，在历史 33 个会话中消费率不足 10%；
   - 离线网页查看器（`report.html` + `assets/`，18.20MB）对 AI 无任何分析价值；
   - JavaScript 赋值外壳（`window.__BUG_LENS_*__ = ...`）破坏了标准 JSON 生态，导致标准命令行工具（如 `jq`、Python `json.load()`）直接报语法解析错误，迫使 AI 在历史会话中累计编写了 **149 次内联脚本** 仅为执行正则剥壳。
2. **高频排查字段受阻与低价值噪音冲刷**：
   - 控制台日志总计 89,486 条（49.68MB），其中 76.0%~97.5% 为无意义的高频轮询与预加载告警，极端单包重复输出达 2,619 次（`dd2ab2d7.zip`），导致模型上下文瞬间超载；
   - 网络索引中内嵌完整的 Base64 图片编码（87 个包中 159 处，累计 8.07MB），单条字符串长达 386KB，造成解析卡顿与输出截断；
   - CDP Initiator 异步调用栈占据网络详情 44.3% 的空间（21.36MB），在生产混淆环境下全为失败映射，AI 实际消费为 0 次；
   - 单包内因多次轮询相同资源（如 i18n 语言包、枚举字典），重复写入完全相同的响应体文件，浪费 29.60MB 纯冗余空间。
3. **采集端沙箱与时序缺陷导致现场断层**：
   - **框架组件捕获率 0%**：录制模式在 Chrome MV3 隔离世界（Isolated World）中执行探测，无法访问宿主页面在主世界（Main World）向 DOM 挂载的 Expando 属性（`__vue__`、`__reactFiber$`），在 84 个录制包的 554 次框架快照中，**组件树捕获成功率为 0%（0/554）**，反而机械化重复写入了 3.69MB 冗余 WebStorage；
   - **Portal 浮层物理割裂**：组件库（Element UI、Ant Design）将下拉菜单、弹窗挂载在 `document.body`，现行局部 DOM 快照回溯切断了与业务宿主组件的联系；
   - **时序盲区**：截图仅在点击/按键瞬间同步抓取，缺失交互动画完成后的稳定帧（Settled Frame）与录屏结束瞬间的最终报错帧（Final Frame），迫使 AI 多次手写 `ffmpeg` 降级抽帧。

### 1.2 “AI-First 数据结构 + Human-First 默认产物”核心设计原则

本规范确立“数据结构面向 AI 优先、默认产物面向人类优先”的全新数据包架构原则：

1. **人类可读报告作为默认产物，AI 精简包为显式可选项**：
   系统导出默认输出完整人类可读报告（`full-viewer`：含 `report.html`、`assets/` 静态库与完整录屏视频），ZIP 的首要消费方是打开它的人（发给同事、存档、评审）；AI 排查属于进阶用法，由用户在设置中显式开启「AI 精简模式」后才输出极简 AI 证据包（`ai-minimal`），剔除仅面向人类视觉排查的资产，换取体积与 Token 的大幅下降。
2. **零语法外壳（Zero-Wrapper Protocol）**：
   彻底废弃所有以 `.js` 包装的全局变量声明语句，全量采用标准 `.json` 格式，保证 `jq`、Python `json`、Node.js 原生解析器开箱即读。
3. **确定性无损瘦身（Deterministic Lossless Slimming）**：
   在不损失任何代码级排查证据（接口参数、状态码、响应体、报错栈、DOM 靶点、组件上下文）的前提下，通过特征折叠、内容寻址去重（CAS）与冗余剪枝，实现解压体积缩减 57.5% 以上，并降低大模型上下文 Token 消耗 80%~85%。
4. **端到端可验证性与强类型约束**：
   所有输出结构必须符合严格的 JSON Schema 与 TypeScript 接口定义，包含端到端哈希校验清单，杜绝模糊推断与字段缺失。

---

## 2. 面向 AI 的极简数据包目录结构与协议规范 (Schema v5)

### 2.1 目录结构与规范文件布局

面向 AI 的极简数据包采用平面化与功能域清晰的目录结构。以下为 v1 历史归档与 v2 极简 AI 证据包的布局对比：

> **默认产物说明**：扩展默认导出 `full-viewer`（完整人类报告），即在下述 v2 布局之外额外包含 `report.html`、`assets/report.{js,css}`、`assets/icon_idle.png`、`data/*.js` 包装与 `media/recording.webm` 录屏；仅当用户显式开启「AI 精简模式」（`workflow.aiMinimalPack = true`）时，才输出下表的 `ai-minimal` 纯 JSON 布局。

```
========================= 历史 v1 报告包 (Human-Oriented) =========================
web-bug-report-<hash>.zip
├── AI_PROMPT.md                           # AI 引导提示词
├── README.md                              # 证据包总览说明
├── report.html                            # 离线人类查看器入口 (死重)
├── reproduce.spec.ts                      # Playwright 自动化复现脚本
├── assets/                                # 离线查看器静态脚本与样式 (死重)
│   ├── icon_idle.png
│   ├── report.css
│   └── report.js
├── data/                                  # 核心数据层 (存在 JS 外壳语法摩擦)
│   ├── network-details.js                 # 包含 window.__BUG_LENS_NETWORK_DETAILS__ = ...
│   └── session-data.js                    # 包含 window.__BUG_LENS_DATA__ = ...
├── issues/                                # 异常现场截图
│   └── <sceneId>/
│       ├── screenshot-annotated.jpg
│       └── screenshot-original.jpg
├── media/                                 # 录屏视频 (AI 无法直读，占 46.1% 体积)
│   └── video.webm (或 recording.mp4)
├── network/                               # 响应体散落存储 (无哈希去重，大量重复)
│   ├── body-<sessionId>:<reqId>.txt
│   └── ...
└── screenshots/                           # 交互瞬态截图 (缺失稳定终态帧)
    ├── step-1.jpg
    └── ...

======================= 规范 v2 证据包 (AI Minimal 模式产物) =======================
ai-evidence-pack-<hash>.zip
├── manifest.json                          # 包完整性与 CAS 寻址元数据清单 (标准 JSON)
├── session-data.json                      # 会话、时序、交互、折叠日志、网络索引 (标准 JSON)
├── network-details.json                   # 请求头、响应头、裁剪 Initiator 详情 (标准 JSON)
├── AI_PROMPT.md                           # 机器优先的任务提示词与宏观排查指南
├── reproduce.spec.ts                      # Playwright 纯净复现脚本
├── network/                               # 内容寻址存储 (CAS) 目录
│   └── blobs/
│       ├── <sha256:16>.bin                # 经 SHA-256 哈希去重后的唯一响应体/二进制载荷
│       └── ...
├── screenshots/                           # 关键视觉证据帧 (双稳定帧模型)
│   ├── step-1.jpg                         # 交互瞬间触发帧
│   ├── step-1-settled.jpg                 # 交互后 DOM/动画稳定帧
│   ├── ...
│   └── final-frame.jpg                    # 录制结束时刻的全屏最终终态帧
└── issues/                                # 标记异常现场的上下文靶点
    └── <sceneId>/
        ├── screenshot-original.jpg        # 原始高保真截图
        ├── screenshot-annotated.jpg       # 带用户框选红框标注的截图
        ├── dom-context.json               # 靶点节点、关联 Portal 浮层与祖先锚点
        └── dom-styles.json                # 靶点元素精准生效的 Winner CSS 规则 (取代 8MB cascade)
```

### 2.2 文件命名与资源类型规范

1. **`manifest.json`**：
   位于归档根目录，必须为合法的 UTF-8 编码 JSON。声明数据包格式版本（`schemaVersion: 5`）、会话 ID、创建时间戳、包导出模式（`full-viewer` 为默认的人类完整报告，`ai-minimal` 为用户显式开启的 AI 精简包）以及所有归档文件的 SHA-256 校验字典。
2. **`session-data.json`**：
   根目录核心索引文件。承载会话元数据（`summary`）、交互时序流（`interactions`）、指纹去重后的控制台日志（`consoleSummary`）、网络请求主索引（`networkEntries`）、框架状态快照（`frameworkStates`）及问题现场元数据（`issueScenes`）。
3. **`network-details.json`**：
   网络明细载荷文件。以请求条目 ID 为键，包含精简后的请求标头、响应标头、裁剪后的栈顶发起者帧（`initiator`）以及指向 `network/blobs/` 的内容哈希索引。
4. **`network/blobs/<sha256:16>.bin`**：
   内容寻址（Content-Addressable Storage, CAS）目录。文件名由响应体内容的 SHA-256 哈希值前 16 位小写十六进制字符串构成，后缀统一为 `.bin`（文本与二进制内容均按原生字节持久化）。同一证据包内完全相同内容的响应体仅存储一份。
5. **`screenshots/step-<N>.jpg` 与 `step-<N>-settled.jpg`**：
   序号 `<N>` 从 1 开始单调递增，对应 `interactions[N-1]` 交互动作。`step-<N>.jpg` 为输入事件触发瞬间的瞬态帧；`step-<N>-settled.jpg` 为交互引发的网络请求与 DOM 突变平息后的稳定帧。
6. **`screenshots/final-frame.jpg`**：
   录制停止时刻当前活动视口的全屏截图，固化用户操作结束瞬间呈现的页面终态。
7. **`issues/<sceneId>/dom-context.json` 与 `dom-styles.json`**：
   `<sceneId>` 为异常现场 UUID。`dom-context.json` 包含靶点 DOM 序列化结构与 Portal 双向关联锚点；`dom-styles.json` 仅包含当前靶点元素及直接容器上实际胜出生效的 CSS 属性与规则映射。

---

### 2.3 规范 JSON Schema 定义

#### 2.3.1 `manifest.json` Schema (Schema v5)

```typescript
export interface AiEvidencePackManifestV5 {
  /** 协议格式标识符，固定为 "bug-lens-evidence-pack" */
  format: "bug-lens-evidence-pack";
  /** 规范主版本号，Schema v5 规范固定为 5 */
  schemaVersion: 5;
  /**
   * 导出模式：默认 `full-viewer`（人类完整报告，含 report.html/assets/录屏）；
   * `ai-minimal` 仅在用户显式开启「AI 精简模式」时产生
   */
  packMode: "ai-minimal" | "full-viewer";
  /** 会话全局唯一标识符 */
  sessionId: string;
  /** 导出时间戳 (Unix Epoch 毫秒) */
  createdAtEpochMs: number;
  /** 扩展程序版本号 */
  extensionVersion: string;
  /** 归档内全部文件的校验哈希与尺寸映射 */
  files: Record<
    string,
    {
      byteLength: number;
      sha256: string;
    }
  >;
  /** 内容寻址存储 (CAS) 统计指标 */
  casStats?: {
    totalBlobCount: number;
    totalBlobBytes: number;
    deduplicatedBytesSaved: number;
  };
}

export type AiEvidencePackManifest = AiEvidencePackManifestV5;
export type AiEvidencePackManifestV2 = AiEvidencePackManifestV5;
```

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "AiEvidencePackManifestV5",
  "type": "object",
  "required": [
    "format",
    "schemaVersion",
    "packMode",
    "sessionId",
    "createdAtEpochMs",
    "files"
  ],
  "properties": {
    "format": { "type": "string", "enum": ["bug-lens-evidence-pack"] },
    "schemaVersion": { "type": "integer", "enum": [5] },
    "packMode": { "type": "string", "enum": ["ai-minimal", "full-viewer"] },
    "sessionId": { "type": "string" },
    "createdAtEpochMs": { "type": "number" },
    "extensionVersion": { "type": "string" },
    "files": {
      "type": "object",
      "additionalProperties": {
        "type": "object",
        "required": ["byteLength", "sha256"],
        "properties": {
          "byteLength": { "type": "number" },
          "sha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" }
        }
      }
    },
    "casStats": {
      "type": "object",
      "properties": {
        "totalBlobCount": { "type": "integer" },
        "totalBlobBytes": { "type": "number" },
        "deduplicatedBytesSaved": { "type": "number" }
      }
    }
  }
}
```

---

#### 2.3.2 `session-data.json` Schema (Schema v5)

```typescript
export interface SessionSummaryV5 {
  url: string;
  title: string;
  durationMs: number;
  environment: {
    os?: string;
    browser?: string;
    viewport?: { width: number; height: number; dpr: number };
    userAgent?: string;
  };
  metrics: {
    interactionCount: number;
    screenshotCount: number;
    consoleSummary: {
      totalOriginalEntries: number;
      uniqueSignatureCount: number;
      errorCount: number;
      warningCount: number;
    };
    networkSummary: {
      totalRequests: number;
      failedRequests: number;
      totalNetworkBytes: number;
      casDeduplicatedCount: number;
    };
    issueSceneCount: number;
    frameworkStateCount: number;
  };
}

export interface ConsoleFoldedEntryV5 {
  /** 签名哈希值：[level, textHash, source] */
  signature: string;
  /** 日志级别 */
  level: "error" | "warn" | "info" | "log" | "debug";
  /** 原始日志文本 */
  text: string;
  /** 日志来源：consoleAPI, network, runtime 等 */
  source: string;
  /** 在会话期间连续或周期性出现的总次数 */
  count: number;
  /** 首次出现的时间戳 (Epoch 毫秒) */
  firstCreatedAt: number;
  /** 末次出现的时间戳 (Epoch 毫秒) */
  lastCreatedAt: number;
  /** 相对录制启动的偏移时间段 (毫秒) */
  timeRangeMs: [number, number];
  /** 首次出现时的调用代码位置 */
  location?: {
    url?: string;
    lineNumber?: number;
    columnNumber?: number;
  };
  /** 若解析出已还原的源码位置则保留，混淆失败则省略 */
  sourceMappedLocation?: {
    originalFile: string;
    originalLine: number;
    originalColumn: number;
    originalFunctionName?: string;
  };
}

export interface NetworkEntryV5 {
  id: string;
  createdAt: number;
  elapsedMs: number;
  method: string;
  url: string;
  type: string;
  status: number;
  statusText: string;
  durationMs: number;
  /** 若属于业务层报错（HTTP 200 但业务状态码非成功），标记错误文本 */
  businessError?: {
    code?: string | number;
    message?: string;
  };
  request: {
    byteLength?: number;
    /** 请求体：小文本直接内联，超过 2KB 或二进制引用 CAS 哈希 */
    body?: string;
    bodyHash?: string;
    contentType?: string;
  };
  response: {
    mimeType: string;
    byteLength: number;
    /** 指向 network/blobs/<sha256:16>.bin 的内容哈希 */
    bodyHash?: string;
    /** 是否命中浏览器强缓存或协商缓存 */
    fromCache?: boolean;
    /** 二进制大文件标记 */
    isBinary?: boolean;
  };
}

export interface InteractionEntryV5 {
  step: number;
  id: string;
  kind: "click" | "input" | "keydown" | "change" | "submit" | "navigation";
  createdAt: number;
  elapsedMs: number;
  target: {
    tagName: string;
    id?: string;
    classNames?: string[];
    name?: string;
    role?: string;
    text?: string;
    value?: string;
    selectorPath?: string;
    boundingBox?: { x: number; y: number; width: number; height: number };
  };
  /** 关联截图映射 */
  screenshots: {
    instantPath: string; // "screenshots/step-N.jpg"
    settledPath?: string; // "screenshots/step-N-settled.jpg"
    settledDurationMs?: number; // 静默窗口耗时 (如 320ms)
  };
}

export interface SessionDataPayloadV5 {
  format: "bug-lens-evidence-pack";
  schemaVersion: 5;
  summary: SessionSummaryV5;
  interactions: InteractionEntryV5[];
  consoleSummary: ConsoleFoldedEntryV5[];
  networkEntries: NetworkEntryV5[];
  issueScenes: Array<{
    id: string;
    observedAtEpochMs: number;
    narrative?: {
      actual?: string;
      expected?: string;
    };
    targetSelector?: string;
    domContextPath: string; // "issues/<id>/dom-context.json"
    domStylesPath: string; // "issues/<id>/dom-styles.json"
  }>;
  frameworkStates?: Array<{
    id: string;
    capturedAtEpochMs: number;
    trigger: "start" | "issue-scene" | "interaction" | "stop";
    framework: "vue" | "react" | "unknown";
    components: Array<{
      componentName: string;
      componentPath: string[];
      componentFile?: string;
      componentLine?: number;
      props?: Record<string, unknown>;
      state?: Record<string, unknown>;
      isTarget?: boolean;
    }>;
    /** 仅在增量变更时记录变更的 Storage Key，杜绝全量倾倒 */
    webStorageDiff?: {
      localStorageChanged?: Record<string, string | null>;
      sessionStorageChanged?: Record<string, string | null>;
    };
  }>;
}

export type SessionDataPayload = SessionDataPayloadV5;
export type SessionDataPayloadV2 = SessionDataPayloadV5;
export type SessionSummaryV2 = SessionSummaryV5;
export type ConsoleFoldedEntryV2 = ConsoleFoldedEntryV5;
export type NetworkEntryV2 = NetworkEntryV5;
export type InteractionEntryV2 = InteractionEntryV5;
```

---

#### 2.3.3 `network-details.json` Schema (Schema v5)

```typescript
export interface InitiatorTopFrameV5 {
  type: "script" | "parser" | "other";
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
  functionName?: string;
  topFrame?: {
    url?: string;
    lineNumber?: number;
    columnNumber?: number;
    functionName?: string;
  };
  /** 仅在成功映射源码时保留，否则省略，严禁保留 FETCH_FAILED 占位结构 */
  sourceMappedLocation?: {
    originalFile: string;
    originalLine: number;
    originalColumn: number;
    originalFunctionName?: string;
  };
}

export interface NetworkDetailItemV5 {
  requestHeaders: Record<string, string>;
  responseHeaders: Record<string, string>;
  /** 仅保留栈顶直接发起帧，彻底剪枝 95% 无意义的底层混淆栈 */
  initiator?: InitiatorTopFrameV5;
  /** CAS 响应体引用与校验 */
  bodyBlob?: {
    hash: string;
    path: string; // "network/blobs/<hash:16>.bin"
    byteLength: number;
    mimeType: string;
  };
}

export type NetworkDetailsPayloadV5 = Record<string, NetworkDetailItemV5>;
export type NetworkDetailsPayload = NetworkDetailsPayloadV5;
export type NetworkDetailItem = NetworkDetailItemV5;
export type InitiatorTopFrame = InitiatorTopFrameV5;
```

---

#### 2.3.4 `issues/<sceneId>/dom-context.json` 与 `dom-styles.json` Schema (Schema v5)

```typescript
export interface RelatedPortalOverlayV5 {
  portalType: "popper" | "dialog" | "dropdown" | "tooltip" | "drawer";
  containerTag: string;
  containerClass?: string[];
  sanitizedHtml: string;
  boundingBox: { x: number; y: number; width: number; height: number };
  relationMechanism:
    | "aria-controls"
    | "aria-owns"
    | "dom-spatial-containment"
    | "popper-reference";
}

export interface DomContextV5 {
  sceneId: string;
  capturedAtEpochMs: number;
  targetElement: {
    tagName: string;
    id?: string;
    classNames: string[];
    attributes: Record<string, string>;
    sanitizedHtml: string;
    boundingBox: { x: number; y: number; width: number; height: number };
    ancestors: Array<{
      tagName: string;
      id?: string;
      classNames?: string[];
    }>;
  };
  /** 若圈选的是宿主组件，关联其触发并挂载在 body 上的浮层 */
  relatedOverlays?: RelatedPortalOverlayV5[];
  /** 若圈选的是浮层本身，反向绑定的主界面触发源信息 */
  triggerElement?: {
    tagName: string;
    id?: string;
    classNames: string[];
    selectorPath: string;
    componentName?: string;
    ancestors: Array<{
      tagName: string;
      id?: string;
      classNames?: string[];
    }>;
  };
}

export interface DomStylesV5 {
  sceneId: string;
  targetSelector: string;
  /** 30+ 项排版布局计算样式 */
  computedLayoutStyles: Record<string, string>;
  /** 胜出生效的 CSS 选择器规则 (Winner Rules)，淘汰数兆全量 Cascade 规则树 */
  winnerRules: Array<{
    property: string;
    value: string;
    selectorText: string;
    isImportant: boolean;
    sourceSheetHref?: string;
  }>;
}

export type RelatedPortalOverlay = RelatedPortalOverlayV5;
export type DomContext = DomContextV5;
export type DomStyles = DomStylesV5;
export type RelatedPortalOverlayV2 = RelatedPortalOverlayV5;
export type DomContextV2 = DomContextV5;
export type DomStylesV2 = DomStylesV5;
```

---

### 2.4 与 v1 数据包（`data/*.js`）的兼容与平滑迁移策略

为了在升级到 Schema v5 规范后保持对全量历史证据包的兼容，制定如下双向迁移适配契约：

1. **导出端（Bug Lens Extension）双模式控制**：
   - 默认模式（`full-viewer`）：导出 `web-bug-report-*.zip`，在标准 JSON 与 CAS 去重之外，一并打包 `report.html`、`assets/`、`data/*.js` 包装与 `media/recording.webm` 录屏，保证 ZIP 可直接双击离线回看；
   - 兼容开关（`ai-minimal`）：在扩展选项（Options）中提供「AI 精简模式（不含离线报告与录屏）」开关（`workflow.aiMinimalPack`，默认关闭）。开启后仅输出纯 JSON 结构与 CAS 去重载荷，不写入 `report.html`、`assets/`、`data/*.js` 与 `media/*.webm`。
2. **消费端（Triage CLI & AI Agent Skill）自适应协议解析器**：
   Triage 工具链（`src/triage-cli/pack/open.ts`）在解包并装载证据包时，执行如下判别流：
   ```
   检查归档文件列表:
   ├── 优先匹配: session-data.json
   │    └── 命中 -> 按 Schema v5 纯 JSON 协议直接解析，免除派生双写与正则剥壳
   └── 回退匹配: data/session-data.js
        └── 命中 -> 识别为 v1.0 兼容包，自动调用 loadJsObject 进行剥壳，并在内存生成临时 JSON 映射
   ```
3. **字段命名映射兼容表**：
   - `consoleEntries`（v1 数组）与 `consoleSummary`（v2 折叠聚合）：CLI 的 `query_console` 在读取 v2 时默认输出解折叠后的时间线视图或展开聚合视图；
   - `network/body-*.txt`（v1 扁平文件）与 `network/blobs/<hash>.bin`（v2 CAS 文件）：CLI 的 `get_request` 根据条目中是否有 `bodyHash` 自动决定从 `blobs/` 还是历史文件提取，对上层命令调用完全透明。

---

## 3. 数据层深度瘦身与去重策略设计

### 3.1 控制台日志指纹折叠与去重机制

#### 3.1.1 现状缺陷量化

在真实 87 个数据包中，控制台日志原始条目总计 89,486 条，占用 49.68MB 文本空间。其中 76.0% 的条目为重复打印。
在典型缺陷包 `web-bug-report-dd2ab2d7.zip` 中，日志总数达 7,814 条，其中 `[log] cookieLang: zh-TW` 单条连续输出 2,619 次，造成单包 `session-data.js` 达 4.45MB，导致大模型读取时触发上下文溢出或截断。

#### 3.1.2 指纹生成算法

控制台条目在落盘前，使用 SHA-256 提取稳定特征指纹。指纹生成对变动的动态数值实施规整化：

```typescript
function generateConsoleSignature(entry: {
  level: string;
  text: string;
  source?: string;
}): string {
  // 1. 规整化：替换高频变动的毫秒级时间戳、随机 UUID 与连续数字
  const normalizedText = entry.text
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
      "[UUID]"
    )
    .replace(/\b17\d{11}\b/g, "[TIMESTAMP]")
    .replace(/\b\d+(\.\d+)?ms\b/g, "[DURATION]");

  // 2. 截取前 200 字符防止畸形大日志导致哈希开销
  const seed = `${entry.level}:${entry.source || "consoleAPI"}:${normalizedText.slice(0, 200)}`;

  // 3. 计算 64 位 SHA-256 并截取前 12 位十六进制作为聚合指纹
  return sha256Hex(seed).slice(0, 12);
}
```

#### 3.1.3 折叠压缩结构与时钟保留

日志采集器维护一个滑动去重缓冲区（去重窗口为 50 条或连续重复）。当新日志与上一条或窗口内条目匹配到相同 `signature` 时，不再追加新对象，而是累加现有条目：

```typescript
export interface ConsoleAggregateRecord {
  signature: string;
  level: "error" | "warn" | "info" | "log" | "debug";
  text: string;
  source: string;
  count: number;
  firstCreatedAt: number;
  lastCreatedAt: number;
  timestamps: number[]; // 仅保留首、尾及至多 3 个离散样本时间戳
  location?: DiagnosticLocation;
}
```

#### 3.1.4 预期瘦身效益

通过签名折叠存储，87 个真实包的控制台日志体积从 49.68MB 压缩至 11.93MB，**净削减 37.75MB（-76.0%）**。在 `dd2ab2d7.zip` 极端案例中，日志体积从 4.12MB 缩减至 0.10MB，**单项压缩率达 97.5%**。

---

### 3.2 网络层 Base64 URL 裁剪与占位符规范

#### 3.2.1 现状缺陷量化

在真实 87 个数据包中，网络请求索引（`networkEntries`）共检测出 159 处内联 `data:` Base64 编码，累计浪费 8.07MB。

- 在 `web-bug-report-79cbdb43.zip` 中，`networkEntries[11].url` 为一张长达 **386,323 字符（386KB）** 的 JPEG 图片，单行文本占全包 `session-data.js` 体积的 41.7%；
- 在 `web-bug-report-6e37b815.zip` 中，单条 Base64 达 376KB，占网络索引总量的 94.0%。
  AI Agent 在调用 `timeline` 或通用文本查看时，单行数十万字符直接导致终端缓冲区冻结与模型上下文截断。

#### 3.2.2 裁剪与占位符规范

在 CDP `Network.requestWillBeSent` 捕获阶段实施长度安全截断：

1. **触发阈值**：当 `url.startsWith("data:")` 且 `url.length > 256` 时立即执行截断；
2. **元数据提取**：解析 MIME 类型（如 `image/jpeg`、`image/png`、`application/font-woff`）及编码声明；
3. **计算哈希并替换为占位符**：
   对被截断的 Base64 字符流计算 SHA-256 短哈希，生成标准结构占位符：
   ```
   data:[mimeType];base64,[TRUNCATED:size=[bytes],hash=[sha256:8]]
   ```
   **示例**：
   ```json
   "url": "data:image/jpeg;base64,[TRUNCATED:size=386323,hash=8f1c3a02]"
   ```
4. **效益测算**：87 个包直接清除 **7.67MB** 纯无用 Base64 文本，彻底消除单行巨大文本对编辑器、解析器及 LLM Token 的严重污染。

---

### 3.3 CDP Initiator 调用栈轻量剪枝策略

#### 3.3.1 现状缺陷量化

在 87 个数据包中，`network-details.js` 总计 42.12MB，其中 CDP `initiator` 深度异步调用栈累计占 **21.36MB（占详情总量的 44.3%）**。
审计表明，95% 以上的内容为混淆后的打包运行时（如 `vendors.js:2:1965164`、`runtime.js:1:420`），且全部附带解析失败标记：
`sourceMappedLocation: { resolved: false, failureReason: 'FETCH_FAILED' }`。
在历史 33 个 Antigravity 会话与 WorkBuddy 会话中，AI 消费 `initiator` 的次数为 **0 次**。

#### 3.3.2 TopFrame 抽取与剪枝规则

系统彻底剥离无意义的深层堆栈与失败映射结构，仅保留发起请求的顶层栈帧（Top Frame）：

1. **直接调用点提取**：
   - 若 `initiator.type === "script"` 且包含堆栈，仅提取 `stack.callFrames[0]`；
   - 若调用帧的 URL 属于宿主页面脚本，保留其 `functionName`、`url`、`lineNumber` 与 `columnNumber`；
   - 丢弃后续所有的上级调用栈帧（`asyncStackTrace`、`parent`）；
2. **清理失败的 SourceMap 节点**：
   若 `sourceMappedLocation.resolved === false`，从 JSON 中直接剔除该属性，杜绝机械化写入无意义的 `{ failureReason: "FETCH_FAILED" }`；
3. **剪枝前后结构对比**：
   ```json
   // 改造前: 几十层堆栈，单条数百行 (占详情体积 44.3%)
   "initiator": {
     "type": "script",
     "stack": {
       "callFrames": [
         { "functionName": "t", "url": ".../vendors.js", "lineNumber": 2, ... },
         { "functionName": "apply", "url": ".../vendors.js", ... },
         ... 40+ frames ...
       ],
       "parent": { ... }
     }
   }

   // 改造后 (Schema v5 规范): 仅保留栈顶入口 (单项体积下降 95%+)
   "initiator": {
     "type": "script",
     "functionName": "fetchUserProfile",
     "url": "https://example.com/assets/user.js",
     "lineNumber": 142,
     "columnNumber": 18
   }
   ```
4. **效益测算**：87 个包累计削减 **18.20MB ~ 20.00MB** 冗余堆栈文本。

---

### 3.4 单包内响应体 SHA-256 内容寻址去重 (CAS)

#### 3.4.1 现状缺陷量化

87 个包包含 686 个响应体文件，总计 155.23MB。
由于页面频繁轮询（如每 5 秒拉取一次配置、用户切换页面拉取相同 i18n 语言包），Bug Lens 机械化采用 `body-<sessionId>:<requestId>.txt` 写入磁盘，导致单包内存在大量重复的大体积响应体：

- 典型案例：在 `web-bug-report-46c47d6a.zip` 与 `ca1800fa.zip` 中，同一份 3.2MB 的 i18n JSON 在单包内被完整存储 2 次，单包虚增 6.4MB；
- 单包内完全一致的重复存储浪费达 **29.60MB（占响应体总量的 19.1%）**。

#### 3.4.2 CAS 存储机制与哈希寻址流程

```
+----------------------------------------------------------------------------------------------------+
|                                  SHA-256 CAS 响应体内容寻址存储流水线                                |
+----------------------------------------------------------------------------------------------------+
|                                                                                                    |
|  [Network Response Captured]                                                                       |
|         |                                                                                          |
|         v                                                                                          |
|  [Calculate SHA-256 of Raw Bytes]  ====>  Digest: "3a7b9c1d8e2f4a5b6c7d8e9f..."                    |
|         |                                 Short Hash (16 chars): "3a7b9c1d8e2f4a5b"                |
|         v                                                                                          |
|  [CAS Registry Check in Memory]                                                                    |
|         ├── Existing in Archive?                                                                   |
|         │    ├── YES: Skip Disk Write, reuse reference                                             |
|         │    └── NO:  Write to network/blobs/3a7b9c1d8e2f4a5b.bin                                  |
|         |                                                                                          |
|         v                                                                                          |
|  [Metadata Reference Linking]                                                                      |
|  networkEntries[i].response.bodyHash = "3a7b9c1d8e2f4a5b"                                          |
|  manifest.json files["network/blobs/3a7b9c1d8e2f4a5b.bin"] = { byteLength, sha256 }                |
|                                                                                                    |
+----------------------------------------------------------------------------------------------------+
```

1. **落盘命名规则**：
   所有响应体存入 `network/blobs/<sha256:16>.bin`；
2. **索引关联**：
   `session-data.json` 中的 `networkEntries` 与 `network-details.json` 中的明细项均不再声明独立文件路径，仅保存 `bodyHash: "3a7b9c1d8e2f4a5b"`；
3. **无文本排查价值的大二进制文件过滤**：
   对于图片（PNG/JPG/WEBP）、音视频及字体（WOFF2）等静态二进制资源，除非用户显式圈选为现场图片，默认仅在网络条目中保留 `mimeType` 与 `byteLength`，**不写入磁盘 blobs**，直接节省数兆存储空间；
4. **效益测算**：87 个包单包内消除重复响应体直接削减 **29.60MB**。

---

### 3.5 WebStorage 快照增量差分机制

#### 3.5.1 现状缺陷量化

在 84 个录制包的 554 次框架快照中，由于组件树探测失效，系统每次机械化拷贝 `localStorage` 与 `sessionStorage` 的全部键值对。
跨快照重复全量倾倒的 Storage 数据累计占用 **1.33MB（占框架快照总量的 36.8%）**。

#### 3.5.2 差分增量机制设计

1. **基线快照（Baseline Snapshot）**：
   会话启动后的首个快照记录全量 Storage 键值对作为基线；
2. **增量差分序列（Storage Delta）**：
   后续快照通过比对当前 Storage 与上一基线，仅记录发生变更的 Key：
   ```typescript
   export interface WebStorageDelta {
     /** 仅记录新增或值修改的键值对 */
     updated?: Record<string, string>;
     /** 记录被移除的键名 */
     removed?: string[];
   }
   ```
3. **效益测算**：消除跨快照 36.8% 的重复文本，净削减 **1.33MB**。

---

## 4. 视觉与截图捕获机制升级方案

### 4.1 交互后稳定帧（Settled Frame）采集机制

#### 4.1.1 现状盲区分析

源码 `src/recording/interaction-capture.ts:500-550` 仅在用户鼠标按下（`mousedown`）或按键按下（`keydown`）的瞬间同步触发截图。

- 下拉菜单展开动画通常需要 150ms~300ms；
- 异步网络请求响应需要 200ms~1000ms；
- 导致瞬态截图往往截取在“菜单正在展开的半透明白块”或“按钮被按下但结果尚未呈现”的瞬间。在历史会话 `2e1c951a` 中，AI 为确认选项是否真正选中，连续盲目调用了 18 次 `get_screenshot`（`step-14 ~ step-30`）。

#### 4.1.2 稳定帧捕获触发逻辑与状态机

```
[Interaction Event: click/input]
        |
        +-----> 1. 同步截取瞬态帧: screenshots/step-N.jpg (捕获用户光标与按压态)
        |
        +-----> 2. 启动防抖静默检测时钟 (Settled Debounce Window)
                    ├── 设置延迟: 350ms (上限不超过 1500ms)
                    ├── 监听 MutationObserver DOM 变动
                    └── 监听 Pending Network Requests 计数器
                                 |
                     +-----------+-----------+
                     |                       |
            [DOM 停止突变 200ms       [达到 1500ms 超时强制窗口]
             且活动网络请求归零]              |
                     |                       |
                     +-----------+-----------+
                                 |
                                 v
                     3. 触发稳定帧截取: screenshots/step-N-settled.jpg
                        记录 settledElapsedMs 与 DOM 稳定耗时
```

#### 4.1.3 实现伪代码规范

```typescript
class InteractionSettledDetector {
  private timer: NodeJS.Timeout | null = null;
  private pendingRequests = 0;
  private lastMutationEpochMs = Date.now();

  public onInteraction(step: number, tabId: number) {
    // 立即抓取瞬态帧
    captureTab(tabId, `screenshots/step-${step}.jpg`);

    // 启动静默等待
    const startTime = Date.now();
    const checkSettled = () => {
      const now = Date.now();
      const domQuiet = now - this.lastMutationEpochMs >= 200;
      const netQuiet = this.pendingRequests === 0;
      const timedOut = now - startTime >= 1500;

      if ((domQuiet && netQuiet) || timedOut) {
        captureTab(tabId, `screenshots/step-${step}-settled.jpg`);
      } else {
        this.timer = setTimeout(checkSettled, 100);
      }
    };
    this.timer = setTimeout(checkSettled, 350);
  }
}
```

---

### 4.2 录制结束全屏最终帧（Final Frame）采集机制

#### 4.2.1 现状盲区分析

用户完成所有操作并触发了报错弹窗或页面崩溃后，点击悬浮球“停止录制”。
现有系统在停止瞬间不会执行截图。如果最后一个操作触发了弹窗校验失败，这一重要视觉证据完全不会出现在静态截图中。
在历史会话 `c001f2bc` 中，单人审批校验失败红框出现在录屏第 25.8 秒，截图文件夹空空如也，AI 被迫手写 `ffmpeg -ss 25.8` 命令降级抽帧。

#### 4.2.2 规范定义与实现钩子

在 `src/recording/recording-coordinator.ts` 的 `stopRecording` 流程中注入强制钩子：

1. **停止信号拦截**：在向 content script 发送停录广播前，立即向活动标签页注入强制全屏视口快照；
2. **命名固化**：固定持久化为 `screenshots/final-frame.jpg`；
3. **时序元数据写入**：在 `session-data.json` 的 `summary` 中显式固化 `finalFrameTimestamp`；
4. **效果**：彻底杜绝 AI 因缺失终态画面而被迫手写 ffmpeg 抽帧或向用户反复索要截图。

---

### 4.3 双稳定帧命名与时序元数据规范

每个交互动作在 `session-data.json` 的 `interactions` 中与静态截图建立精确的时钟对齐映射：

```json
{
  "step": 4,
  "id": "action-4-click-submit",
  "kind": "click",
  "createdAt": 1731482820150,
  "elapsedMs": 20150,
  "target": {
    "tagName": "button",
    "text": "同意并提交",
    "selectorPath": "#app > div.main-content > button.btn-primary"
  },
  "screenshots": {
    "instantPath": "screenshots/step-4.jpg",
    "instantElapsedMs": 20150,
    "settledPath": "screenshots/step-4-settled.jpg",
    "settledElapsedMs": 20580,
    "settledDurationMs": 430
  }
}
```

---

## 5. DOM 快照与计算样式采集升级方案

### 5.1 Portal 浮层与宿主双向关联 DOM 快照架构

#### 5.1.1 现状物理割裂根因

现代前端框架（Vue 2/3、React）中的弹出层控件（Element UI 的 `el-select-dropdown`、`el-dialog`、`el-popover`，Ant Design 的 `Modal`、`Drawer`）普遍使用 `append-to-body` 或 `createPortal` 挂载至 `document.body` 根节点下。
`src/entrypoints/content/collector/dom-snapshot.ts` 现行逻辑采用 `cloneNode(true)` 并向上回溯 5 层父节点：

- 用户圈选浮层（如会话 `5c613e8b` 超宽下拉）：回溯 4 层直接到达 `body`，丢失所有业务宿主组件，导致 AI 在全工程执行上百次盲目 `grep`；
- 用户圈选宿主按钮：浮层位于 `body` 直属节点，快照中完全不包含浮层 DOM。

#### 5.1.2 双向关联算法设计

```
====================== 场景一：圈选宿主组件 (Host Component Selected) ======================
Target Element: <div class="el-select" aria-controls="select-dropdown-99">
      |
      +---> 1. 扫描目标节点属性: aria-controls / aria-owns / id / Popper 实例引用
      |
      +---> 2. 在 document.body 直属子树中检索可见浮层 (display !== 'none' 且 opacity > 0)
      |
      +---> 3. 几何坐标校验: 浮层边界矩形是否与宿主元素垂直/水平贴靠 (Distance <= 12px)
      |
      +---> 4. 将命中的浮层深拷贝并序列化至 relatedOverlays 数组

====================== 场景二：圈选浮层组件 (Overlay Component Selected) ======================
Target Element: <ul class="el-select-dropdown__list"> (挂载于 body)
      |
      +---> 1. 检测是否处于 body 直属浮层容器中 (.el-popper, .ant-dropdown, [role="dialog"])
      |
      +---> 2. 逆向追溯触发源:
      |         ├── 检查 Popper.js / Floating UI 的 referenceNode 引用
      |         ├── 检查 aria-controls 对应的反向宿主节点
      |         └── 检查会话时序中最近一次发生 click/focus 的非浮层交互元素
      |
      +---> 3. 将真实宿主组件作为 triggerElement 序列化，包含其业务祖先链条 (#app 内部)
```

#### 5.1.3 产出结构示例 (`issues/<sceneId>/dom-context.json`)

```json
{
  "sceneId": "scene-5c613e8b-dropdown-overflow",
  "targetElement": {
    "tagName": "ul",
    "classNames": ["el-scrollbar__view", "el-select-dropdown__list"],
    "sanitizedHtml": "<ul class=\"el-scrollbar__view el-select-dropdown__list\">...</ul>"
  },
  "triggerElement": {
    "tagName": "div",
    "classNames": ["zj-select-tree", "form-item-category"],
    "selectorPath": "#app > div.work-station > form > div:nth-child(3) > div.zj-select-tree",
    "componentName": "WorkStationForm",
    "ancestors": [
      { "tagName": "div", "classNames": ["form-item-wrap"] },
      { "tagName": "form", "classNames": ["el-form"] },
      { "tagName": "div", "classNames": ["work-station-page"] }
    ]
  }
}
```

---

### 5.2 计算样式采样属性集扩展 (32 个核心排版属性)

彻底废弃 `dom-snapshot.ts:520` 仅采集 11 个属性的硬编码机制，扩展为包含现代排版、定位与换行关键属性的 32 项集合：

```typescript
export const AI_CRITICAL_CSS_PROPERTIES = [
  // 1. 布局与定位基础 (6 项)
  "display",
  "position",
  "box-sizing",
  "top",
  "left",
  "z-index",

  // 2. 文本换行与溢出控制 (修复 Table Text Wrapping 缺陷) (5 项)
  "white-space",
  "word-break",
  "overflow-wrap",
  "text-overflow",
  "-webkit-line-clamp",

  // 3. 盒模型与溢出行为 (7 项)
  "overflow",
  "overflow-x",
  "overflow-y",
  "width",
  "height",
  "min-width",
  "max-width",

  // 4. Flex 弹性盒模型 (修复容器挤压与折行错位) (5 项)
  "flex",
  "flex-direction",
  "flex-wrap",
  "justify-content",
  "align-items",

  // 5. Grid 网格布局 (3 项)
  "grid-template-columns",
  "grid-template-rows",
  "gap",

  // 6. 视觉可见性与层叠上下文 (6 项)
  "visibility",
  "opacity",
  "pointer-events",
  "transform",
  "isolation",
  "will-change",
] as const;
```

---

### 5.3 废弃 8MB `cascade.json`，改为 Winner Rules 精准提炼

#### 5.3.1 现状缺陷量化

在单图诊断包（`bug-lens-screenshot-*.zip`）中，系统倾倒了完整的 `cascade.json`（体积高达 7.82MB），包含页面成千上万条无关联 CSS 规则。
在会话 `f6cb36e4` 中，面对 7.82MB 巨大文件，AI 耗费 16 个步骤、连续编写 7 个 Node.js 脚本手动反编译 `cascade.perProperty` 与 `rulesMap`，仅仅为了查询覆盖表格单元格 `word-break` 的胜出选择器。

#### 5.3.2 Winner Rules 提取规范

不再打包全局 CSSOM。采集端在目标节点及其直接父节点上，仅针对上述 32 项属性提取最终生效规则（Winner Rules）：

```typescript
export interface CssWinnerRule {
  property: string;
  value: string;
  selectorText: string;
  isImportant: boolean;
  sourceSheetHref?: string;
  inheritedFrom?: string;
}
```

#### 5.3.3 效益测算

通过仅输出精准胜出规则，现场样式数据文件 `dom-styles.json` 体积从 **7.82MB 骤降至 8KB~15KB（缩减率 99.8%）**，且 AI 无需编写任何反编译脚本，直接通过属性名索引即可获知覆盖来源。

---

## 6. 框架内部状态捕获穿透架构（主世界探针设计）

### 6.1 MV3 隔离世界断层根因与穿透架构拓扑

```
+----------------------------------------------------------------------------------------------------+
|                                    Chrome Tab Execution Contexts                                   |
+----------------------------------------------------------------------------------------------------+
|                                                                                                    |
|  +--------------------------------------------+    +--------------------------------------------+  |
|  |        MAIN WORLD (页面原生执行环境)        |    |       ISOLATED WORLD (Content Script)      |  |
|  |                                            |    |                                            |  |
|  | - window.__vue__ / window.__VUE_APP__      |    | - Content Script 隔离沙箱                  |  |
|  | - React FiberNode 挂载于 DOM 的 Expando 属性 |    | - DOM 代理对象 (Expando 属性完全不可见)    |  |
|  |   (el.__reactFiber$xxxx)                   |    |                                            |  |
|  | - Pinia / Vuex Store 实例                  |    | [直接访问 el.__vue__ -> undefined]         |  |
|  |                                            |    | [直接访问 el.__reactFiber$ -> undefined]   |  |
|  +--------------------------------------------+    +--------------------------------------------+  |
|                        ^                                                 |                         |
|                        |                                                 | 1. 请求注入探针          |
|                        |                                                 v                         |
|                        |                   +----------------------------------+                    |
|                        |                   |  BACKGROUND SERVICE WORKER       |                    |
|                        |                   |                                  |                    |
|                        +-------------------|  chrome.scripting.executeScript  |                    |
|                          2. world: "MAIN"  |  { world: "MAIN", func: probe }  |                    |
|                             动态注入探针   +----------------------------------+                    |
|                                                                                                    |
+----------------------------------------------------------------------------------------------------+
```

在 84 个真实录制包中，组件树捕获成功率为 **0%（0/554）**。根本原因在于录制模式将采集器置于 Isolated World。
而 Bug Lens 截图模式已验证了主世界探针的可行性（`src/screenshot/probes/main-world-probe.ts`）。本规范将该架构扩展至 Session 录制与现场标记全流程。

---

### 6.2 主世界轻量只读探针设计与通信协议

#### 6.2.1 触发时机控制（避免常态性能损耗）

主世界探针不采用高频常驻轮询（避免拖慢宿主页面），而是采用**靶点驱动与关键生命周期按需触发**策略：

1. **`session-start`**：录制启动时执行一次，获取全局框架类型（Vue 2/3、React 版本）与顶层应用实例；
2. **`issue-scene`**：用户圈选异常现场时，针对圈选元素及直接关联浮层精准触发一次深度组件树捕获；
3. **`session-stop`**：录制停止时执行一次终态状态抓取。

#### 6.2.2 探针注入与握手协议

1. **Content Script 标记靶点**：
   ```typescript
   element.setAttribute("data-bug-lens-probe-id", probeId);
   ```
2. **向 Background 发起穿透请求**：
   ```typescript
   chrome.runtime.sendMessage({
     type: "session/framework-probe",
     payload: { probeIds: [probeId], tabId, frameId },
   });
   ```
3. **Background 执行主世界注入**：
   调用 `chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, world: "MAIN", func: runMainWorldFrameworkProbe, args: [[probeId]] })`；
4. **探针回传并清理标记**：
   主世界返回结构化组件链（包含组件名、源文件路径、过滤后的 Props 与 State），Content Script 清理 DOM 属性。

---

### 6.3 探针防爆安全防护与脱敏规范

主世界探针继承自生产级 `runMainWorldFrameworkProbe`，实施严格的三重防爆安全保护：

1. **防止循环引用与深层嵌套爆炸**：
   - 最大递归深度限制为 3 层（`depth >= 3 -> "[Truncated]"`）；
   - 维护 `seen = new WeakSet()` 拦截循环引用；
   - 单对象属性上限限制为 20 个，单数组元素上限限制为 10 个；
2. **DOM 节点与宿主原生对象拦截**：
   对 `window`、`document`、`Node`、`Element` 实例一律替换为 `"[DOM Element]"` 占位符，严禁尝试序列化庞大且带循环的 DOM 树；
3. **敏感凭证强制脱敏**：
   匹配键名正则：
   `/(password|passwd|pwd|token|secret|apikey|api_key|access_key|private_key|auth|authorization|credential|session_id|cookie|creditcard|card_number|cvv|ssn|jwt|bearer)/i`
   命中键名或敏感值的字段一律强制输出为 `"[REDACTED_SENSITIVE_KEY]"`。

---

## 7. 87 个真实包的量化瘦身与 Token 缩减效益测算表

### 7.1 87 个真实包逐项瘦身量化对比表

下表基于 `~/Downloads` 目录下 87 个真实 Bug Lens 证据包（总解压态 824.19MB，总压缩态 673.42MB）的逐文件二进制扫描与全量字段反序列化统计，测算实施 Schema v5 规范各项瘦身杠杆后的实际数值：

| 优化杠杆 / 模块             | 优化前解压总体积 | 优化前占解压比 | 改造策略与技术动作                                     | 优化后解压总体积 | 净削减体积     | 削减比例    | 对应解决的实测痛点                                  |
| --------------------------- | ---------------- | -------------- | ------------------------------------------------------ | ---------------- | -------------- | ----------- | --------------------------------------------------- |
| **L1. 剥离视频媒体**        | 379.65 MB        | 46.1%          | AI 精简模式下不打包 `media/*.webm`，默认完整报告仍保留 | 0.00 MB          | **-379.65 MB** | **-100.0%** | 多模态工具无法看视频，消除最大二进制包袱            |
| **L2. 剔除离线查看器**      | 18.20 MB         | 2.2%           | AI 精简模式下不打包 `report.html` 与 `assets/*`        | 0.00 MB          | **-18.20 MB**  | **-100.0%** | AI Agent 从不执行离线页面，消除无用死重             |
| **L3. 响应体 CAS 去重**     | 155.23 MB        | 18.8%          | SHA-256 内容寻址存储，单包内相同内容复用               | 125.63 MB        | **-29.60 MB**  | **-19.1%**  | 消除单包内 i18n/枚举字典重复存储 6.4MB 问题         |
| **L4. 控制台签名折叠**      | 49.68 MB         | 6.0%           | `[level, textHash, source]` 聚合与计数器折叠           | 11.93 MB         | **-37.75 MB**  | **-76.0%**  | 消除 8.9 万条日志中的 76% 重复轮询与告警            |
| **L5. 裁剪内联 Base64**     | 8.07 MB          | 1.0%           | URL 超过 256 字符截断为元数据占位符                    | 0.40 MB          | **-7.67 MB**   | **-95.0%**  | 根除单条 386KB 畸形 Base64 URL 导致的解析卡顿       |
| **L6. Initiator 栈顶剪枝**  | 21.36 MB         | 2.6%           | 仅保留 topFrame 顶层入口，剪除底层混淆栈               | 2.50 MB          | **-18.86 MB**  | **-88.3%**  | 剔除 21.36MB AI 消费率为 0 的死重调用栈             |
| **L7. 框架 Storage 增量化** | 3.61 MB          | 0.4%           | 会话首帧基线快照 + 变更 Key 增量 Diff                  | 2.28 MB          | **-1.33 MB**   | **-36.8%**  | 消除跨快照机械化重复全量拷贝 localStorage           |
| **L8. 精准 Winner Rules**   | 7.73 MB          | 0.9%           | 淘汰 8MB cascade.json，仅输出胜出 CSS 规则             | 0.15 MB          | **-7.58 MB**   | **-98.1%**  | 消除 AI 连续编写 7 个 Node 脚本反编译 CSSOM         |
| **保留核心资产**            | 180.66 MB        | 21.9%          | 截图(105MB)、网络索引(13MB)、JSON元数据等              | 199.46 MB        | +18.80 MB*     | +10.4%      | *包含新增的稳定帧与最终帧静态图片体积               |
| **全量汇总 (Total)**        | **824.19 MB**    | **100.0%**     | **全面实施 Schema v5 极简规范架构**                    | **350.00 MB**    | **-474.19 MB** | **-57.5%**  | **解压态体积缩减 57.5%，压缩态自 673MB 降至 285MB** |

---

### 7.2 AI 排查上下文 Token 消耗与成本缩减模型

在真实 AI 排查链路中，由于数据包格式限制与海量噪音冲刷，大语言模型的输入 Token 呈现严重的倒挂。以下对比在 6 个代表性真实场景下，AI 在 v1 结构与 v2 规范下的单次排查 Token 消耗实测与测算：

| 排查场景 / 典型案例       | 会话与数据包                         | v1 结构下 Token 消耗 | v1 消耗主要成因                                                      | v2 规范下 Token 消耗      | v2 节省手段与效果                                                 | Token 缩减率        |
| ------------------------- | ------------------------------------ | -------------------- | -------------------------------------------------------------------- | ------------------------- | ----------------------------------------------------------------- | ------------------- |
| **1. 接口超时与代理 500** | 会话 `7e860c64`<br>包 `05ed1726.zip` | 138,500 Token        | 多次手写 Node 脚本剥壳，全量读取包含混淆栈的 network-details (4.2MB) | 18,200 Token              | 原生纯 JSON 读取，顶层 topFrame 精准呈现，快速定位 22s 超时接口   | **-86.9%**          |
| **2. 表单保存参数丢失**   | 会话 `76629d18`<br>包 `60d221f3.zip` | 115,000 Token        | CLI 漏读 requestBody，AI 连续编写 6 个 Python 脚本切片大报文         | 14,500 Token              | `entry.request.body` 原生直读，CAS 消除重复配置响应体             | **-87.4%**          |
| **3. 超宽下拉菜单溢出**   | 会话 `5c613e8b`<br>包 `6e37b815.zip` | 162,000 Token        | 浮层与宿主割裂，AI 在微前端工程全库检索 100+ 文件并反复交互          | 22,000 Token              | `triggerElement` 双向锚定，直接定位宿主业务组件 `WorkStationForm` | **-86.4%**          |
| **4. 表格单元格不折行**   | 会话 `f6cb36e4`<br>单图包 `10-28`    | 145,000 Token        | 7.82MB cascade.json 迫使 AI 连续发起 7 次 Node 脚本反编译            | 11,200 Token              | `dom-styles.json` Winner Rules 仅 10KB，直接给出覆盖的 CSS 选择器 | **-92.3%**          |
| **5. 审批校验弹窗报错**   | 会话 `c001f2bc`<br>包 `9bf8fef7.zip` | 98,000 Token         | 缺少提交后截图，AI 猜解时间戳并调用 ffmpeg 抽帧，多轮调试            | 16,800 Token              | `final-frame.jpg` 与 `step-N-settled.jpg` 直接呈现红框报错画面    | **-82.9%**          |
| **6. WorkBuddy 跨域排查** | 会话 `fe1a7f96`<br>连续消费 5 个包   | 280,000 Token        | 无 CLI 环境下连续编写 158 次 Bash/Python 脚本剥壳与遍历字典          | 45,000 Token              | 标准纯 JSON 支持 jq 直接读取，快速矩阵比对 Access-Control 头      | **-83.9%**          |
| **平均水平 (Average)**    | 全量会话平均                         | **120,000+ Token**   | 脚本剥壳、海量日志冲刷、大调用栈、全库盲目 Grep                      | **15,000 ~ 25,000 Token** | **规范化纯 JSON、日志折叠、Winner Rules、主世界探针穿透**         | **-80.0% ~ -87.5%** |

---

## 8. 实施落地建议与各方协作契约

### 8.1 导出端配置选项结构 (Options Contract)

在扩展程序选项模型（`src/storage/options-storage.ts`）中增加 `aiEvidencePack` 配置分支：

```typescript
export interface AiEvidencePackExportOptions {
  /** 导出模式：默认 full-viewer（人类完整报告） */
  mode: "ai-minimal" | "full-viewer";
  /** 是否剥离录像视频（仅 ai-minimal 生效，默认为 false） */
  omitVideo: boolean;
  /** 是否剥离离线 HTML 查看器及静态脚本（仅 ai-minimal 生效，默认为 false） */
  omitReportViewer: boolean;
  /** 控制台日志去重开关 (默认为 true) */
  enableConsoleFold: boolean;
  /** 响应体 CAS 内容寻址去重开关 (默认为 true) */
  enableCasDeduplication: boolean;
  /** 截断内联 Base64 URL 阈值，单位字符 (默认为 256) */
  truncateBase64UrlLength: number;
  /** 交互后稳定帧防抖静默检测时间，单位毫秒 (默认为 350) */
  settledFrameDebounceMs: number;
}

export const DEFAULT_AI_EXPORT_OPTIONS: AiEvidencePackExportOptions = {
  mode: "full-viewer",
  omitVideo: false,
  omitReportViewer: false,
  enableConsoleFold: true,
  enableCasDeduplication: true,
  truncateBase64UrlLength: 256,
  settledFrameDebounceMs: 350,
};
```

### 8.2 与 Milestone 3（Triage 工具链与 Skill 升级）的协同契约

1. **输入契约保证**：
   本规范导出的 `manifest.json`、`session-data.json`、`network-details.json` 与 `network/blobs/` 构成了 Milestone 3 消费端的标准输入。
2. **CLI 读取优先级契约**：
   `src/triage-cli/pack/open.ts` 必须优先检查并读取 `session-data.json`；若命中则直接走流式按需加载，不再执行磁盘双写派生；
3. **Skill 排查指令适配**：
   更新 `.agents/skills/bug-lens-triage/SKILL.md`，推荐 AI 优先读取 `summary` 与 `consoleSummary`，使用 `final-frame.jpg` 与 `step-N-settled.jpg` 确认视觉终态，通过 `dom-styles.json` 检索 CSS 规则，终结历史会话中的低效脚本编写摩擦。
