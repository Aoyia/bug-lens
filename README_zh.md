# Bug Lens

[English Version](README.md) | **中文文档**

> **AI 编程助手与 Vibe Coding 创作者的现场感知利器**  
> 一键捕获浏览器前端缺陷的完整运行时上下文（DOM 快照、点击轨迹红圈、Console 报错与网络报文），自动生成结构化 AI 提示词与离线证据包，让 AI 精准排障与修复。

---

## ⚡ 核心能力一览

### 1. 全量上下文配置与安全录制面板

一键开启录制，自由勾选视频、截图、控制台、网络请求/响应体以及前端框架状态，内置本地数据隐私脱敏模式。

<img src="docs/assets/popup-panel.png" width="380" alt="扩展控制面板" />

### 2. 页面轻量吸附录制挂件

录制期间在网页边缘提供无干扰挂件，支持快捷标记缺陷现场（`Option+S` / `Alt+S`）、实时录制时长显示以及一键直出结束导出。

![页面录制挂件](docs/assets/in-page-recording-widget.png)

### 3. 操作步骤捕获与可视化时间轴（精准红圈 + 定位器推导）

录制过程中自动捕获每个交互的关键帧截图，并在点击位置绘制红圈标记；同步解析目标元素属性（Tag、Class、Role、坐标与尺寸），自动生成带稳定性评分的 Playwright 定位器代码，帮助 AI 零歧义还原操作路径并生成自动化复现脚本。

![操作步骤捕获与时间轴排查](docs/assets/evidence-preview-workspace.png)

### 4. 网页即时截图与 AI 提示词批注

无需录制时的独立截图工具，支持区域框选裁剪、像素尺寸测量、划线箭头指向与中英双语文字批注，直接向 AI 精准描述前端缺陷与修改诉求。

![网页批注与截图工具](docs/assets/screenshot-annotation.png)

---

## 🚀 3 步极速上手

1. **安装插件**：下载预编译安装包 [bug-lens-v0.7.34.zip](https://github.com/Aoyia/bug-lens/releases/latest) 并解压，在 Chrome 扩展管理页（`chrome://extensions/` 开启开发者模式）点击 **“加载已解压的扩展程序”**。
2. **一键录制**：在目标网页点击插件图标或按 `Cmd/Ctrl+Shift+Y` 开始录制并复现问题。
3. **丢给 AI**：点击 **“结束并导出”**，Bug Lens 自动下载离线证据包并将生成的 AI 提示词写入剪贴板，直接粘贴到 Cursor、Claude Code、Codex 或 Antigravity 等 AI 助手即可开启精准修复！

---

## 📦 从源码构建

```bash
pnpm install
pnpm run build
# 打包生成发布 ZIP 包
pnpm run package
```

## 💬 交流群

扫码加入微信群（反馈 Bug、提需求、催更交流）：

<img src="docs/assets/wechat-group.jpg" width="200" alt="Bug Lens 交流群" />

> 二维码如过期，可在 [Issues](https://github.com/Aoyia/bug-lens/issues) 或 [Discussions](https://github.com/Aoyia/bug-lens/discussions) 留言更新。

---

## 📄 开源许可证

本项目采用 [GNU Affero General Public License v3.0 (AGPL-3.0)](LICENSE) 开源许可证。
