#!/usr/bin/env node
// Skill 契约校验：CONTRACT.json / cli.ts help / SKILL.md 三者必须自洽。
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const contractPath = resolve(
  root,
  ".agents/skills/bug-lens-triage/CONTRACT.json"
);
const cliPath = resolve(root, "src/triage-cli/cli.ts");
const contractSrcPath = resolve(root, "src/triage-cli/contract.ts");
const skillMdPath = resolve(root, ".agents/skills/bug-lens-triage/SKILL.md");
const packagePath = resolve(root, "package.json");

const failures = [];

function fail(message) {
  failures.push(message);
}

function read(path) {
  if (!existsSync(path)) {
    fail(`缺少文件: ${path}`);
    return "";
  }
  return readFileSync(path, "utf8");
}

// 1. CONTRACT.json 存在、JSON 合法、implVersion 与 package.json 一致
let contract = null;
const contractRaw = read(contractPath);
if (contractRaw) {
  try {
    contract = JSON.parse(contractRaw);
  } catch (err) {
    fail(`CONTRACT.json 不是合法 JSON: ${err.message}`);
  }
}

const pkgVersion = JSON.parse(read(packagePath) || "{}").version;
if (contract) {
  if (contract.implVersion !== pkgVersion) {
    fail(
      `CONTRACT.json implVersion (${contract.implVersion}) !== package.json version (${pkgVersion})`
    );
  }
}

// 2. capabilities 无重复，且包含 LEGACY_CAPABILITIES 全部项
// LEGACY_CAPABILITIES 以 src/triage-cli/contract.ts 为单一事实来源
const contractSrc = read(contractSrcPath);
function extractStringArray(source, constName) {
  const match = new RegExp(
    `export const ${constName}\\s*:[^=]*=\\s*\\[([\\s\\S]*?)\\]`
  ).exec(source);
  if (!match) return null;
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

const legacyCapabilities = extractStringArray(
  contractSrc,
  "LEGACY_CAPABILITIES"
);
if (!legacyCapabilities || legacyCapabilities.length === 0) {
  fail(`无法从 src/triage-cli/contract.ts 解析 LEGACY_CAPABILITIES`);
}

if (contract && Array.isArray(contract.capabilities)) {
  const seen = new Set();
  for (const cap of contract.capabilities) {
    if (seen.has(cap)) fail(`capabilities 存在重复项: ${cap}`);
    seen.add(cap);
  }
  for (const cap of legacyCapabilities ?? []) {
    if (!seen.has(cap)) fail(`capabilities 缺少基线能力: ${cap}`);
  }
}

// 3. commands 集合与 cli.ts help 文本列出的子命令集合完全相等
const cliSrc = read(cliPath);
const helpCommands = [];
const helpStart = cliSrc.indexOf("Commands:");
if (helpStart === -1) {
  fail(`src/triage-cli/cli.ts 中找不到 help 的 Commands 列表`);
} else {
  const helpBody = cliSrc.slice(helpStart + "Commands:".length);
  const helpEnd = helpBody.indexOf("`");
  const block = helpEnd === -1 ? helpBody : helpBody.slice(0, helpEnd);
  for (const line of block.split("\n")) {
    const m = /^\s{2}([a-z][a-z0-9_]*)(?=[\s<[])/.exec(line);
    if (!m) continue;
    if (m[1] === "help") continue;
    helpCommands.push(m[1]);
  }
}

if (contract && Array.isArray(contract.commands)) {
  const declared = new Set(contract.commands);
  const actual = new Set(helpCommands);
  for (const cmd of actual) {
    if (!declared.has(cmd)) {
      fail(`CONTRACT.json commands 缺少 help 中列出的子命令: ${cmd}`);
    }
  }
  for (const cmd of declared) {
    if (!actual.has(cmd)) {
      fail(`CONTRACT.json commands 声明了 help 中不存在的子命令: ${cmd}`);
    }
  }
  if (new Set(contract.commands).size !== contract.commands.length) {
    fail(`CONTRACT.json commands 存在重复项`);
  }
}

// 4. SKILL.md 的 [cap: X] 必须已声明；且不得出现硬编码版本号
const skillMd = read(skillMdPath);
if (skillMd) {
  const declaredCaps = new Set(contract?.capabilities ?? []);
  // 占位符（如 `[cap: X]` / `[cap: ...]`）不是能力引用，只校验 kebab-case 能力名
  for (const m of skillMd.matchAll(/\[cap:\s*([a-z][a-z0-9-]*)\]/g)) {
    const cap = m[1].trim();
    if (!declaredCaps.has(cap)) {
      fail(`SKILL.md 引用了未声明能力: [cap: ${cap}]`);
    }
  }

  const versionPatterns = [
    /(?<![\w.])v?\d+\.\d+\.\d+(?![\w.])/g,
    /(?<![\w.])v\d+\.\d+(?![\w.])/g,
  ];
  for (const pattern of versionPatterns) {
    for (const m of skillMd.matchAll(pattern)) {
      fail(`SKILL.md 含硬编码版本号: ${m[0]}`);
    }
  }
}

if (failures.length > 0) {
  console.error("verify:skill-contract 失败:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(
  `verify:skill-contract 通过 (implVersion=${contract.implVersion}, capabilities=${contract.capabilities.length}, commands=${contract.commands.length})`
);
