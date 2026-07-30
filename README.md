# Bug Lens

基于 Manifest V3 的本地 Web 缺陷录制扩展。当前版本已打通最小可用链路：Popup 开始/结束录制、标签页 WebM、点击元素元数据、带红色圆环的点击截图、基础 Console/Network 采集、IndexedDB 持久化、预览页和离线 ZIP 报告。预览页可非破坏性排除并恢复交互、Console 和 Network 条目；导出的 `report.html` 复用预览页的展示模块与样式，以只读离线模式保留视频、步骤时间线、截图灯箱、Console 筛选和 Network 详情。ZIP 根目录还包含帮助人和 AI 理解证据资源的动态 `README.md` 和通用 `AI_PROMPT.md`。导出完成后预览页会显示本机 ZIP 绝对路径并提供一键复制 AI 提示词。

离线报告无需服务端。将导出的 ZIP 完整解压后双击 `report.html` 即可查看；报告不包含排除的证据，也不包含删除、恢复、再次导出或本机路径操作。

## 本地构建

```bash
npm install
npm run build
```

构建产物位于 `dist/`。

## 在 Chrome 中加载

1. 打开 `chrome://extensions/`。
2. 开启右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择本项目的 `dist/` 目录。
5. 打开一个普通 HTTP/HTTPS 页面，从扩展 Popup 开始录制。

修改源码后重新运行 `npm run build`，然后在扩展管理页点击刷新。

## 当前限制

- iframe 点击会保留交互，但在 CDP Frame 几何映射完成前不会绘制可能错误的红圈。
- Network 当前保存基础请求、状态、响应头和 CDP 可读取的响应正文；完整重定向链与乱序 ExtraInfo 聚合尚未实现。
- Console 对象当前使用 CDP description/value 摘要，完整有界对象序列化尚未实现。
- WebM 当前按一次 MediaRecorder 会话组合，30 秒独立分段和 Cues 修复尚未实现。
- 导出采用内存内 ZIP，长录制的流式导出尚未实现。

详细需求、技术方案和后续阶段分别见 `docs/01-requirements.md`、`docs/02-technical-solution.md`、`docs/03-implementation-design.md`。
