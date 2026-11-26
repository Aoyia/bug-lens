#!/usr/bin/env node
import { execSync } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  copyFileSync,
  existsSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";

const root = process.cwd();
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");

const repoArgIdx = args.indexOf("--repo");
const mirrorRepo =
  repoArgIdx !== -1 && args[repoArgIdx + 1]
    ? args[repoArgIdx + 1]
    : "Aoyia/bug-lens-skill";

const tagArgIdx = args.indexOf("--tag");
const targetTag =
  tagArgIdx !== -1 && args[tagArgIdx + 1] ? args[tagArgIdx + 1] : undefined;

function run(cmd, opts = {}) {
  return execSync(cmd, {
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
    ...opts,
  }).trim();
}

console.log(`[publish-skill] Target mirror repository: ${mirrorRepo}`);
if (dryRun) console.log("[publish-skill] Mode: --dry-run (no push)");

// 1. 验证 gh auth 状态
try {
  run("gh auth status");
} catch (err) {
  console.error("Error: gh is not authenticated. Please run `gh auth login`.");
  process.exit(1);
}

// 2. 检查或创建镜像仓库
let repoExists = true;
try {
  run(`gh repo view ${mirrorRepo}`);
} catch {
  repoExists = false;
}

if (!repoExists) {
  if (dryRun) {
    console.log(
      `[dry-run] Remote repository ${mirrorRepo} does not exist. Would create via gh repo create.`
    );
  } else {
    console.log(`Creating public repository ${mirrorRepo}...`);
    run(
      `gh repo create ${mirrorRepo} --public --description "Official Bug Lens triage agent skill for Claude Code, Cursor, Windsurf, and AI assistants."`
    );
    // 配置禁用 Issues / Wiki，引导集中至主仓库
    try {
      run(
        `gh repo edit ${mirrorRepo} --enable-issues=false --enable-wiki=false`
      );
    } catch {}
  }
}

// 3. 在临时目录准备工作副本
const workDir = join(tmpdir(), `bug-lens-skill-sync-${Date.now()}`);
mkdirSync(workDir, { recursive: true });

try {
  if (repoExists) {
    try {
      run(
        `git clone --depth 1 https://github.com/${mirrorRepo}.git "${workDir}"`
      );
    } catch {
      // 仓库刚创建可能无默认分支，初始化本地 repo
      run(`git init -b main "${workDir}"`);
      run(`git remote add origin https://github.com/${mirrorRepo}.git`, {
        cwd: workDir,
      });
    }
  } else {
    run(`git init -b main "${workDir}"`);
    run(`git remote add origin https://github.com/${mirrorRepo}.git`, {
      cwd: workDir,
    });
  }

  // 4. 从主仓库提取 Skill 文件与 License
  const pkgVersion = JSON.parse(
    readFileSync(resolve(root, "package.json"), "utf-8")
  ).version;
  const version = targetTag ? targetTag.replace(/^v/, "") : pkgVersion;

  const targetSkillDir = join(workDir, "skills", "bug-lens-triage");
  rmSync(targetSkillDir, { recursive: true, force: true });
  mkdirSync(join(targetSkillDir, "scripts"), { recursive: true });

  const srcSkillDir = resolve(root, ".agents/skills/bug-lens-triage");
  const skillMdContent = readFileSync(join(srcSkillDir, "SKILL.md"), "utf-8");
  const installShContent = readFileSync(
    join(srcSkillDir, "scripts/install.sh"),
    "utf-8"
  );
  const installPs1Content = readFileSync(
    join(srcSkillDir, "scripts/install.ps1"),
    "utf-8"
  );
  const licenseContent = readFileSync(resolve(root, "LICENSE"), "utf-8");

  writeFileSync(join(targetSkillDir, "SKILL.md"), skillMdContent, "utf-8");
  writeFileSync(join(targetSkillDir, "scripts/install.sh"), installShContent, {
    encoding: "utf-8",
    mode: 0o755,
  });
  writeFileSync(
    join(targetSkillDir, "scripts/install.ps1"),
    installPs1Content,
    "utf-8"
  );
  writeFileSync(join(workDir, "LICENSE"), licenseContent, "utf-8");

  // 写入镜像仓库 README.md 与 README_zh.md
  const readmeContent = `# Bug Lens Triage Skill

**English** | [中文文档](README_zh.md)

> Official Agent Skill for **[Bug Lens](https://github.com/Aoyia/bug-lens)** — Browser bug evidence triage & AI code fix.

This repository distributes the official \`bug-lens-triage\` skill (powered by the native Rust \`bug-lens-cli\` binary) for modern AI coding assistants (Claude Code, Cursor, Windsurf, Antigravity, Codex, etc.).

## Quick Install

Install globally to all supported AI assistants:

\`\`\`bash
npx skills add Aoyia/bug-lens-skill -g -y
\`\`\`

Or install in your current project workspace:

\`\`\`bash
npx skills add Aoyia/bug-lens-skill -y
\`\`\`

Then install the native Rust \`bug-lens-cli\` binary (one-time SHA-256 verified download from GitHub Releases; runtime CLI has zero outbound network access):

\`\`\`bash
# macOS / Linux
bash "<skillDir>/scripts/install.sh"

# Windows (PowerShell)
powershell -ExecutionPolicy Bypass -File "<skillDir>\\scripts\\install.ps1"
\`\`\`

## Updating Skill

\`\`\`bash
npx skills update bug-lens-triage
\`\`\`

## Uninstalling Skill

\`\`\`bash
# Global uninstall
npx skills remove bug-lens-triage -g -y

# Or project-scoped uninstall
npx skills remove bug-lens-triage -y
\`\`\`

## How It Works

Once installed, your AI programming assistant automatically gains the ability to:
1. Stream-extract \`web-bug-report-*.zip\` and \`bug-lens-screenshot-*.zip\` archives into an isolated workspace directory with plain formatted \`data/*.json\` and an \`INDEX.md\` schema index using the native Rust \`bug-lens-cli\` binary.
2. Inspect key screenshots, extracted video frames, Console errors, Network payloads, and DOM/CSS cascade trees without polluting your workspace.
3. Automatically prune historical workspace packages via an LRU cache (defaulting to the 10 most recent packs).

## Links & Feedback

- **Main Repository & Browser Extension**: [Aoyia/bug-lens](https://github.com/Aoyia/bug-lens)
- **Issue Tracker**: [Report a Bug or Feature Request](https://github.com/Aoyia/bug-lens/issues)
- **License**: AGPL-3.0 (same as Bug Lens core)
`;

  const readmeZhContent = `# Bug Lens Triage Skill

[English Version](README.md) | **中文文档**

> **[Bug Lens](https://github.com/Aoyia/bug-lens)** 官方 Agent Skill — 浏览器缺陷证据排查与 AI 代码修复。

本仓库分发官方 \`bug-lens-triage\` Skill（内置原生 Rust \`bug-lens-cli\` 二进制），适用于 Claude Code、Cursor、Windsurf、Antigravity、Codex 等现代 AI 编程助手。

## 快速安装

全局安装到所有受支持的 AI 助手：

\`\`\`bash
npx skills add Aoyia/bug-lens-skill -g -y
\`\`\`

或仅安装到当前项目工作区：

\`\`\`bash
npx skills add Aoyia/bug-lens-skill -y
\`\`\`

随后安装原生 Rust \`bug-lens-cli\` 二进制（仅首次通过 SHA-256 校验从 GitHub Releases 下载，CLI 运行时严格零外联）：

\`\`\`bash
# macOS / Linux
bash "<skillDir>/scripts/install.sh"

# Windows (PowerShell)
powershell -ExecutionPolicy Bypass -File "<skillDir>\\scripts\\install.ps1"
\`\`\`

## 更新 Skill

\`\`\`bash
npx skills update bug-lens-triage
\`\`\`

## 卸载 Skill

\`\`\`bash
# 全局卸载
npx skills remove bug-lens-triage -g -y

# 或项目级卸载
npx skills remove bug-lens-triage -y
\`\`\`

## 工作原理

安装完成后，AI 编程助手将自动获得以下能力：
1. 使用原生 Rust \`bug-lens-cli\` 二进制将 \`web-bug-report-*.zip\` 与 \`bug-lens-screenshot-*.zip\` 流式解压到独立工作区，生成标准 \`data/*.json\` 与 \`INDEX.md\` 结构索引。
2. 在不污染当前工程目录的前提下，按需下钻检查关键截图、视频抽帧、Console 报错、Network 报文与 DOM/CSS 级联树。
3. 通过 LRU 缓存自动清理历史工作区证据包（默认保留最近 10 个包）。

## 相关链接与反馈

- **主仓库与浏览器扩展**：[Aoyia/bug-lens](https://github.com/Aoyia/bug-lens)
- **问题反馈**：[提交 Bug 或功能建议](https://github.com/Aoyia/bug-lens/issues)
- **开源协议**：AGPL-3.0（与 Bug Lens 主仓库一致）
`;

  writeFileSync(join(workDir, "README.md"), readmeContent, "utf-8");
  writeFileSync(join(workDir, "README_zh.md"), readmeZhContent, "utf-8");

  // 5. 检查变动
  const status = run("git status --porcelain", { cwd: workDir });
  if (!status) {
    console.log(
      `[publish-skill] No changes detected in ${mirrorRepo}. Already in sync with v${version}.`
    );
    process.exit(0);
  }

  console.log(`[publish-skill] Changes detected:\n${status}\n`);

  if (dryRun) {
    console.log(
      `[dry-run] Verification passed. Would commit and push to https://github.com/${mirrorRepo}.git`
    );
    process.exit(0);
  }

  // 6. 提交并推送
  run("git config user.name 'Aoyia'", { cwd: workDir });
  run("git config user.email 'ddhyuan@gmail.com'", { cwd: workDir });
  run("git add -A", { cwd: workDir });
  run(
    `git commit -m "chore(sync): sync bug-lens-triage skill from bug-lens v${version}"`,
    { cwd: workDir }
  );
  run(`git tag -f v${version}`, { cwd: workDir });
  run("git push -u origin main --tags --force", { cwd: workDir });

  console.log(
    `\nSuccessfully published bug-lens-triage skill to https://github.com/${mirrorRepo} (v${version})`
  );
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
