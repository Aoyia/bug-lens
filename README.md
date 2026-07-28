# Web Bug Recorder

基于 Manifest V3 的本地 Web 缺陷录制扩展。当前版本已打通最小可用链路：Popup 开始/结束录制、标签页 WebM、点击元素元数据、带红色圆环的点击截图、基础 Console/Network 采集、IndexedDB 持久化、预览页和离线 ZIP 报告。

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
- Network 当前保存基础请求、状态和失败信息，正文与完整重定向聚合尚未实现。
- Console 对象当前使用 CDP description/value 摘要，完整有界对象序列化尚未实现。
- WebM 当前按一次 MediaRecorder 会话组合，30 秒独立分段和 Cues 修复尚未实现。
- 导出采用内存内 ZIP，长录制的流式导出尚未实现。

详细需求、技术方案和后续阶段分别见 `01-requirements.md`、`02-technical-solution.md`、`03-implementation-design.md`。
