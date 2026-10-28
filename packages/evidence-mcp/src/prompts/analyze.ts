export function buildAnalyzePromptText(
  packPath?: string,
  lang: "zh" | "en" = "zh"
): string {
  const trimmedPath = packPath?.trim();
  const targetDisplay =
    trimmedPath ||
    (lang === "en"
      ? "<ZIP path from user message, or latest web-bug-report-*.zip / bug-lens-screenshot-*.zip in ~/Downloads>"
      : "<用户消息中给出的 ZIP 路径，或 ~/Downloads 下最新的 web-bug-report-*.zip / bug-lens-screenshot-*.zip>");
  const argExample = trimmedPath || "<pack_path>";

  if (lang === "en") {
    return `Please act as a Senior Frontend/Fullstack Debugging Expert and analyze the local Bug Lens evidence package at:
\`${targetDisplay}\`

Use the \`bug-lens-mcp\` tools directly (do NOT manually unzip or run \`node -e\` / \`vm\` scripts on \`session-data.js\`):

1. **Pack Overview**: Call \`open_pack(pack="${argExample}")\` to inspect the session summary, environment, issue scene overview, top console errors, and failed network requests.
2. **Scene & Expectation Anchor**:
   - If the pack is a \`session\` pack, call \`get_scene(pack="${argExample}")\` to inspect \`narrative.actual\`, \`narrative.expected\`, selected DOM targets, and the annotated screenshot.
   - If \`expected.confidence\` is \`"missing"\`, you MUST explicitly state: "Expected behavior was not captured; the following expectation is an inferred hypothesis." Never present an inferred expectation as a confirmed user fact.
   - Treat \`sequenceContext\` strictly as raw same-time context, never as a proven causal chain.
   - If the pack is a \`screenshot\` pack, call \`get_screenshot(pack="${argExample}", kind="screenshot")\` and \`read_pack_file(pack="${argExample}", path="dom-context.json")\`.
3. **Chronological Evidence Chain**: Call \`timeline(pack="${argExample}", windowMs=15000)\` to align user interactions, console errors/warnings, and network requests leading up to the defect.
4. **Deep Dive & Root Cause**:
   - Use \`query_network\` / \`get_request\` (with \`jsonPath\` for large JSON responses) to inspect API contracts and payloads.
   - Use \`get_framework_state\` to check Vue/React component props/state and webStorage.
   - Correlate the evidence with the active repository source code to pinpoint the exact file, function, and root cause.

Output Structure:
1. Problem Definition (Actual vs. Expected & Confidence Level)
2. Chronological Evidence Chain (Interaction -> Request/Log -> Visual Scene)
3. Root Cause Analysis (Confirmed Facts vs. Inferred Hypotheses)
4. Recommended Fix`;
  }

  return `请作为高级 Frontend/Fullstack 调试专家，使用 \`bug-lens-mcp\` 工具分析以下本地 Bug Lens 证据包（严禁手写 \`node -e\` / \`vm\` 脚本解析或执行包内代码）：
\`${targetDisplay}\`

请按以下第一性链式步骤调用 MCP 工具展开排查：
1. **全局概览**：调用 \`open_pack(pack="${argExample}")\` 获取会话摘要、运行环境、异常现场列表、Top 控制台报错与失败网络请求。
2. **现场定位与期望锚点**：
   - 若为会话录制包（\`kind: "session"\`），调用 \`get_scene(pack="${argExample}")\` 查看 \`narrative.actual\`（真实主观问题描述）、选中 DOM 靶点结构及批注截图。
   - 检查 \`narrative.expected\`：若 \`confidence: "explicit"\`，以此作为诊断锚点；若 \`confidence: "missing"\` 或未捕获，必须显式声明“未捕获期望，以下为推断假设”，严禁将推断出的期望表述为已知事实。
   - \`sequenceContext\` 仅作为“同时刻原始上下文”，严禁直接当作已证实的因果链。
   - 若为截图证据包（\`kind: "screenshot"\`），调用 \`get_screenshot(pack="${argExample}", kind="screenshot")\` 查看标注图片，并用 \`read_pack_file(pack="${argExample}", path="dom-context.json")\` 读取 DOM 树与 \`intentFlags\`。
3. **时序证据链对齐**：调用 \`timeline(pack="${argExample}", windowMs=15000)\` 查看缺陷发生前后的交互、Console 报错与 Network 请求时序。
4. **深挖请求与组件状态**：
   - 按需调用 \`query_network\` 与 \`get_request\`（大 JSON 响应体可传 \`jsonPath\` 精确抽取，如 \`data.definition.form.elements[id=xxx]\`）。
   - 按需调用 \`get_framework_state\` 检查交互前后的 Vue/React 组件 props/state 与 webStorage。
   - 结合当前代码库定位根因与修复位置；如需运行 Playwright 复现脚本，可调用 \`extract_pack\` 安全落盘后执行。

输出格式：
1. 用户诉求与问题定义（对比 narrative.actual 与 expected，标明期望置信度）
2. 关键时序证据链（交互 -> 报错/请求 -> 现场截图）
3. 根本原因定位（区分已确认事实与推论假设）
4. 建议修复代码与验证方式`;
}
