# Bug Lens 🤖

> **The Ultimate Context Provider for AI Code Assistants**
> 专为 AI Agent（Cursor, Claude Code, Antigravity 等）打造的前端缺陷现场上下文捕获扩展。

---

## 💡 为什么需要 Bug Lens？

AI 辅助编程极大提升了开发效率，但在让 AI 诊断和修复前端 Bug 时，开发者常遇到**上下文缺失**的痛点：
- AI 看不到用户点击了哪个元素、触发了什么 DOM 变化。
- 手动截图、复制控制台报错与网络请求极度繁琐。

**Bug Lens 解决了这个问题**：在浏览器端一键录制用户复现步骤，自动提炼结构化的缺陷现场（包含 DOM 快照、带轨迹截图、Console 日志、Network 报文与 WebM 录屏），并生成可直接喂给 AI 的标准提示词与文件上下文！

---

## ⚡️ AI 原生工作流 (AI-Native Workflow)

```mermaid
graph LR
    A["1. 浏览器一键录制"] --> B["2. 导出离线 ZIP & AI Prompt"]
    B --> C["3. 一键发送给 AI Agent"]
    C --> D["4. AI 精准定位并修复 Bug"]
```

1. **一键捕获**：点击扩展 Popup 开始录制，复现问题（自动记录点击红圈、DOM 快照、Console、Network 及 WebM 录屏）。
2. **生成报告**：导出静态 ZIP 压缩包，系统自动生成供 AI 理解结构的 `AI_PROMPT.md` 与动态 `README.md`。
3. **喂给 AI**：在预览页一键复制 Prompt 与本机绝对路径，直接发送给 AI 编程助手，AI 即可获取全量现场信息开展修复。

---

## 🌟 核心特性

- 🎯 **精准现场捕获**：高亮点击元素，捕获带有红色圆环轨迹的截图与原始干净截图。
- 📦 **零服务端·安全离线**：导出纯静态 ZIP 报告，内含离线 `report.html`，数据完全本地化。
- 🤖 **AI 深度整合**：
  - `AI_PROMPT.md`：自动生成指导 AI 逐层剖析报告资源的提示词模板。
  - **结构化上下文**：为 DOM 快照、控制台报错与网络请求提供结构化数据源。
- ⏱️ **时间线与非破坏性编辑**：支持按时间线联动查看日志与视频，导出前可排除敏感/无用数据。

---

## 🚀 下载与安装 (Installation)

### 方式一：直接下载 Releases 安装包（推荐）

1. 前往 GitHub 项目的 [Releases 页面](../../releases) 下载最新的预编译插件包（`bug-lens-extension.zip`）。
2. 将下载的 ZIP 压缩包解压到本地任意目录。
3. 打开 Chrome 扩展管理页 `chrome://extensions/`，开启右上角 **“开发者模式”**。
4. 点击 **“加载已解压的扩展程序”**，选择刚刚解压的目录即可完成安装。

### 方式二：从源码构建

```bash
npm install
npm run build
```

构建完成后，在 `chrome://extensions/` 中选择加载本项目的 `dist/` 目录。

---

## 🛠️ 当前限制与规划

- **CDP Frame 映射**：iframe 点击保持交互记录，CDP Frame 几何映射完成前暂停绘制红圈。
- **Network 聚合**：包含基础请求/响应头及可读正文，重定向链与乱序 ExtraInfo 聚合持续完善中。
- **Console 序列化**：支持 CDP 结构摘要，完整对象序列化进行中。
- **导出机制**：当前采用内存内 ZIP 导出。

---

📄 详细需求文档与架构设计请参阅：
- [需求说明](file:///Users/zhijian/Documents/mvp/bug-lens/docs/01-requirements.md)
- [技术方案](file:///Users/zhijian/Documents/mvp/bug-lens/docs/02-technical-solution.md)
- [实施设计](file:///Users/zhijian/Documents/mvp/bug-lens/docs/03-implementation-design.md)
