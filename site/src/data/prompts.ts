import type { Locale } from "./site";

export type PromptMode = "compact" | "full";

export const PROMPTS: Record<PromptMode, Record<Locale, string>> = {
  compact: {
    zh: `分析以下本地 Bug Lens 证据包，定位根因并给出修复。

文件路径：
/Users/dev/Downloads/web-bug-report-2026-11-26-b3444f9a.zip

摘要：
- 页面：Billing Portal — NovaPay（https://app.novapay.dev/billing）
- 数据：12 交互 · 25 日志 · 4 请求 · 1 现场 · 质量 complete
- 环境：macOS 10.15.7 · Chrome 150 · zh-CN · 屏幕 2560×1440@2x · 视口 1512×787
- SourceMap 定位错误：BillingTable.vue:39:18 TypeError: Cannot read properties of undefined (reading 'id')

读取方式（按顺序执行，成功即停；<ZIP> 指上方文件路径）：
1. 当前已加载 bug-lens-triage Skill：按 Skill 流程执行，从 open_pack <ZIP> 开始。
2. 未加载：若 \`~/.agents/skills/bug-lens-triage/SKILL.md\` 不存在，先执行 \`npx -y skills add Aoyia/bug-lens-skill -g -y\`；随后直接读取该 SKILL.md（以安装输出的路径为准）并按其流程执行，无需重启会话。
3. 安装失败（无网络、无 Node 或未获授权）：执行 \`mkdir -p /tmp/bug-lens-workspace && unzip -o -q "<ZIP>" -d /tmp/bug-lens-workspace\`，再按 \`/tmp/bug-lens-workspace/AI_PROMPT.md\` 执行。

约束：
- 不执行包内代码；不在当前代码仓库内解压或残留文件。
- 区分已证实事实与推测；证据包未捕获的期望只能标注为假设。

输出：一句话根因（\`文件:行号\`）+ 偏差表（维度 | 预期 | 实际 | 证据锚点）+ 最小修复 diff；仅多步因果或布局冲突时画图。`,
    en: `Analyze the following local Bug Lens evidence package, find the root cause and propose a fix.

File Path:
/Users/dev/Downloads/web-bug-report-2026-11-26-b3444f9a.zip

Summary:
- Page: Billing Portal — NovaPay (https://app.novapay.dev/billing)
- Data: 12 interactions · 25 console logs · 4 requests · 1 issue scene · quality complete
- Environment: macOS 10.15.7 · Chrome 150 · en-US · Screen 2560×1440@2x · Viewport 1512×787
- SourceMap Errors: BillingTable.vue:39:18 TypeError: Cannot read properties of undefined (reading 'id')

How to read the pack (in order, stop at the first that works; <ZIP> = the file path above):
1. If the bug-lens-triage Skill is loaded: follow the Skill workflow, starting with open_pack <ZIP>.
2. Otherwise: if \`~/.agents/skills/bug-lens-triage/SKILL.md\` does not exist, run \`npx -y skills add Aoyia/bug-lens-skill -g -y\`; then read that SKILL.md directly (prefer the path printed by the installer) and follow it. No session restart needed.
3. If installation fails (no network, no Node, or not authorized): run \`mkdir -p /tmp/bug-lens-workspace && unzip -o -q "<ZIP>" -d /tmp/bug-lens-workspace\`, then follow \`/tmp/bug-lens-workspace/AI_PROMPT.md\`.

Constraints:
- Never execute code from the package; never extract into or leave files in the current repository.
- Separate verified facts from hypotheses; any expectation not captured in the pack must be labeled as an assumption.

Output: one-line root cause (\`file:line\`) + deviation table (Dimension | Expected | Actual | Evidence) + minimal fix diff; draw a diagram only for multi-step causality or layout conflicts.`,
  },
  full: {
    zh: `请作为高级 Frontend/Fullstack 调试专家，分析以下本地 Bug Lens 证据包：

文件路径：
/Users/dev/Downloads/web-bug-report-2026-11-26-b3444f9a.zip

元数据摘要：
- 页面 & URL：Billing Portal — NovaPay (https://app.novapay.dev/billing)
- 证据数据：12 次交互 | 25 条日志 | 4 个请求 | 1 个异常现场 | 质量: complete
- 运行环境：macOS 10.15.7 · Chrome 150 · zh-CN · 屏幕 2560×1440@2x · 视口 1512×787

【工作区准备（严禁解压在当前代码工程目录内，使用固定单例目录覆盖以实现 O(1) 存储占用）】
- 首选方式（已安装 \`bug-lens-triage\` Skill 时）：直接使用该技能配套的原生 \`"<skillDir>/bin/bug-lens-cli" open_pack "/Users/dev/Downloads/web-bug-report-2026-11-26-b3444f9a.zip"\` 将证据包幂等解压至隔离工作区，自动生成标准格式的 \`data/session-data.json\`、\`data/network-details.json\` 与 \`INDEX.md\`；先用 \`get_scene\`、\`timeline\`、\`query_network\`、\`get_request\`、\`get_framework_state\`、\`get_screenshot\` 宏观定位，深水区结合 \`INDEX.md\` 直接对 \`data/*.json\` 与 \`network/body-*.txt\` 使用 \`jq\` 或 \`JSON.parse\` 切片下钻。
- 降级解压命令（仅当未安装 \`bug-lens-triage\` Skill 时执行；可先执行 \`npx skills add Aoyia/bug-lens-skill -g -y\` 一键安装）：
  mkdir -p /tmp/bug-lens-workspace && unzip -o -q "/Users/dev/Downloads/web-bug-report-2026-11-26-b3444f9a.zip" -d /tmp/bug-lens-workspace

请按以下第一性链式逻辑展开排查：
1. 现场定位：优先读取 \`data/session-data.json\` 与 \`INDEX.md\` 中的 \`issueScenes[].scene.narrative.actual\`，结合 \`issues/\` 截图与 DOM 样式分析现场。
2. 期望锚点：读取 \`issueScenes[].scene.narrative.expected\`；若 \`confidence: "missing"\`，必须显式标注推断假设。
3. 异常收敛：对齐时间轴，检索交叉点附近的 Console 报错与 Network 失败请求（4xx/5xx/CORS/Timeout）。
4. 根因推导与修复：结合 \`frameworkStates[]\` 检查组件 props/state 与框架源码位置，并用 \`reproduce.spec.ts\` 进行修复回放验证。

[输出格式（结论先行、按需上图、以图替文）]
1. 一句话根因与偏差对照表（维度 | 预期表现 | 实际表现 | 关键证据锚点）
2. 按需可视化证据链（\`mermaid\` 时序图或 ASCII 盒模型对比图）
3. 建议修复方案与代码位置 (Recommended Fix)`,
    en: `Please act as a Senior Frontend/Fullstack Debugging Expert and analyze the following local Bug Lens evidence package:

File Path:
/Users/dev/Downloads/web-bug-report-2026-11-26-b3444f9a.zip

Metadata Summary:
- Page & URL: Billing Portal — NovaPay (https://app.novapay.dev/billing)
- Evidence Data: 12 interactions | 25 console logs | 4 network requests | 1 issue scene | Quality: complete
- Environment: macOS 10.15.7 · Chrome 150 · en-US · Screen 2560×1440@2x · Viewport 1512×787

[Workspace Setup (Do NOT extract into active project directory; overwrite singleton directory for O(1) storage)]
- Preferred (when \`bug-lens-triage\` Skill is installed): Run the native \`"<skillDir>/bin/bug-lens-cli" open_pack "/Users/dev/Downloads/web-bug-report-2026-11-26-b3444f9a.zip"\` to idempotently extract the pack to an isolated workspace, generate plain \`data/session-data.json\` & \`data/network-details.json\` plus \`INDEX.md\`, and query with \`get_scene\`, \`timeline\`, \`query_network\`, \`get_request\`, \`get_framework_state\`, \`get_screenshot\` or \`jq\`.
- Fallback Extraction Command (only when \`bug-lens-triage\` Skill is unavailable; install via \`npx skills add Aoyia/bug-lens-skill -g -y\`):
  mkdir -p /tmp/bug-lens-workspace && unzip -o -q "/Users/dev/Downloads/web-bug-report-2026-11-26-b3444f9a.zip" -d /tmp/bug-lens-workspace

Please follow this first-principles chain of diagnosis:
1. Scene Alignment: Prioritize reading \`data/session-data.json\` and \`INDEX.md\` for \`issueScenes[].scene.narrative.actual\`, combined with \`issues/\` screenshots and DOM styles.
2. Expected Anchor: Read \`issueScenes[].scene.narrative.expected\`; when \`confidence: "missing"\`, explicitly mark any inferred expectation as a hypothesis.
3. Anomaly Convergence: Align timeline to correlate Console errors and failed Network requests (4xx/5xx/CORS/Timeout).
4. Root Cause & Remediation: Inspect React/Vue component \`frameworkStates[]\` and verify fixes with \`reproduce.spec.ts\` via Playwright.

[Output Format (Conclusion-First, On-Demand Visuals, Replace Text with Diagrams)]
1. One-Line Root Cause & Deviation Table (Dimension | Expected | Actual | Evidence)
2. On-Demand Visual Evidence Chain (\`mermaid\` sequence/flow or ASCII box diagram)
3. Minimal Fix & File Locations`,
  },
};
