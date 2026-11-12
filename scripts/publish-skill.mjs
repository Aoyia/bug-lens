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
  const cliContent = readFileSync(
    join(srcSkillDir, "scripts/bug-lens-cli.mjs"),
    "utf-8"
  );
  const licenseContent = readFileSync(resolve(root, "LICENSE"), "utf-8");

  writeFileSync(join(targetSkillDir, "SKILL.md"), skillMdContent, "utf-8");
  writeFileSync(
    join(targetSkillDir, "scripts/bug-lens-cli.mjs"),
    cliContent,
    "utf-8"
  );
  writeFileSync(join(workDir, "LICENSE"), licenseContent, "utf-8");

  // 写入镜像仓库 README.md
  const readmeContent = `# Bug Lens Triage Skill

> Official Agent Skill for **[Bug Lens](https://github.com/Aoyia/bug-lens)** — Browser bug evidence triage & AI code fix.

This repository distributes the official \`bug-lens-triage\` skill for modern AI coding assistants (Claude Code, Cursor, Windsurf, Antigravity, Codex, etc.).

## 🚀 Quick Install

Install globally to all supported AI assistants:

\`\`\`bash
npx skills add Aoyia/bug-lens-skill -g -y
\`\`\`

Or install in your current project workspace:

\`\`\`bash
npx skills add Aoyia/bug-lens-skill -y
\`\`\`

## 🔄 Updating Skill

\`\`\`bash
npx skills update bug-lens-triage
\`\`\`

## 🗑️ Uninstalling Skill

\`\`\`bash
# Global uninstall
npx skills remove bug-lens-triage -g -y

# Or project-scoped uninstall
npx skills remove bug-lens-triage -y
\`\`\`

## 📖 How It Works

Once installed, your AI programming assistant automatically gains the ability to:
1. Idempotently extract \`web-bug-report-*.zip\` and \`bug-lens-screenshot-*.zip\` archives into an isolated workspace directory with plain formatted \`data/*.json\` and an \`INDEX.md\` schema index.
2. Inspect key screenshots, extracted video frames, Console errors, Network payloads, and DOM/CSS cascade trees without polluting your workspace.
3. Automatically prune historical workspace packages via an LRU cache (defaulting to the 10 most recent packs).

## 🔗 Links & Feedback

- **Main Repository & Browser Extension**: [Aoyia/bug-lens](https://github.com/Aoyia/bug-lens)
- **Issue Tracker**: [Report a Bug or Feature Request](https://github.com/Aoyia/bug-lens/issues)
- **License**: AGPL-3.0 (same as Bug Lens core)
`;

  writeFileSync(join(workDir, "README.md"), readmeContent, "utf-8");

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
