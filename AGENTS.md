# AGENTS.md

This document serves as the project instructions and rules for AI Coding Agents (such as OpenAI Codex, Cursor, Trae, etc.) operating in this repository.

## 核心规则与规范 (Core Rules)

### 0. 终端命令环境规范 (Local Command Execution)

- **规则说明**：当前项目中的所有 Bash / Terminal 命令必须**直接在本地环境（Local Environment）**中运行。由于系统隔离或环境变量限制，执行 Shell 命令时需通过 `PATH` 显式引入用户本地 Node/fnm/pnpm/npm 可执行文件路径（如 `/Users/zhijian/.local/share/fnm/node-versions/v20.20.2/installation/bin`），严禁使用限制或未加载工具链的沙盒虚拟环境。

### 1. UI 界面元素修复必须同步更新 E2E / 单元测试 (UI & E2E Test Synchronization)

- **规则说明**：凡是涉及前端 UI 界面元素（包含面板、悬浮挂件 Widget、文案、按钮状态、计时器、交互响应等）的缺陷修复、需求变更或重构，**必须**同步在端到端测试（`e2e/` 目录）及单元测试（`tests/` 目录）中补充或修改对应的测试用例。
- **触发条件**：
  - 变更影响了组件的 DOM 渲染或 selector（如 ID、class、data 属性）。
  - 变更修正了 UI 上的计算数据或状态表现（如计时器、暂停/恢复显示、提示文案等）。
- **执行要求**：
  - 修改代码后，必须补充/更新对应的断言（`expect()` 或 `assert`）。
  - 修复完成后，必须执行 `npm test` 及 `npm run typecheck`（必要时运行 E2E 测试），确保修改被测试覆盖且全量测试通过。

---

## 项目常规约定 (Repository Guidelines)

### 开发与验证流程

1. **代码修改前**：优先定位已有逻辑与架构约定，严格遵守现有的代码风格与命名模式。
2. **代码修改后**：
   - 运行类型检查：`npm run typecheck`
   - 运行单元与逻辑测试：`npm test`
