import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Skill 契约：skill 身份唯一（`bug-lens-triage`），版本能力差异由 CONTRACT.json 显式声明。
 * 调用方先执行 `contract` 子命令自检，再按 capabilities 决定启用哪些流程段落。
 */
export interface SkillContract {
  /** 固定身份标识，与 skill name 一致。 */
  contract: string;
  /** 契约机制自身版本；0 表示无契约层（legacy 降级）。 */
  contractVersion: number;
  /** CLI 实现版本，与 package.json version 保持一致。 */
  implVersion: string;
  /** 实现通道：v5 / stable / legacy。 */
  implChannel: string;
  /** 证据包 Schema 版本。 */
  packSchemaVersion: number;
  /** 工作区命名空间，不同实现版本物理隔离。 */
  workspaceNamespace: string;
  /** 已声明的能力集合。 */
  capabilities: string[];
  /** CLI 子命令集合。 */
  commands: string[];
}

export const CONTRACT_NAME = "bug-lens-triage";

/** 基线能力：任何实现都应具备，不含 v5 新增能力。 */
export const LEGACY_CAPABILITIES: string[] = [
  "open-pack",
  "derived-index",
  "timeline",
  "console-query",
  "network-query",
  "request-body",
  "interactions",
  "framework-state",
  "search",
  "raw-read",
  "extract",
];

/** v5 在基线之外新增的能力。 */
export const V5_EXTRA_CAPABILITIES: string[] = [
  "contract",
  "pack-mode",
  "ticket-draft",
  "customer-note",
  "expectation-assertion",
];

const LEGACY_FALLBACK_CONTRACT: SkillContract = {
  contract: CONTRACT_NAME,
  contractVersion: 0,
  implVersion: "0.0.0",
  implChannel: "legacy",
  packSchemaVersion: 0,
  workspaceNamespace: "bug-lens-workspace",
  capabilities: [...LEGACY_CAPABILITIES],
  commands: [],
};

/**
 * 候选路径（按优先级）：
 * 1. 打包后 `scripts/../CONTRACT.json`；源码直跑 `src/triage-cli/../CONTRACT.json`
 * 2. CLI 同级目录 `CONTRACT.json`
 * 3. 源码直跑时从 `src/triage-cli/` 回溯到仓库 `.agents/skills/bug-lens-triage/`
 * 4. 当前工作目录下的 skill 目录
 */
function defaultCandidatePaths(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  return [
    resolve(here, "..", "CONTRACT.json"),
    resolve(here, "CONTRACT.json"),
    resolve(
      here,
      "..",
      "..",
      "..",
      ".agents",
      "skills",
      "bug-lens-triage",
      "CONTRACT.json"
    ),
    resolve(
      process.cwd(),
      ".agents",
      "skills",
      "bug-lens-triage",
      "CONTRACT.json"
    ),
  ];
}

function isUsableContract(value: unknown): value is SkillContract {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Partial<SkillContract>;
  return (
    typeof c.contractVersion === "number" &&
    typeof c.workspaceNamespace === "string" &&
    Array.isArray(c.capabilities)
  );
}

/**
 * 读取 skill 契约。找不到任何 CONTRACT.json 或解析失败时返回内置降级契约
 * （contractVersion: 0），绝不抛错——legacy 实现没有契约层是预期状态。
 */
export function loadSkillContract(
  candidates: readonly string[] = defaultCandidatePaths()
): SkillContract {
  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(candidate, "utf8"));
      if (isUsableContract(parsed)) return parsed;
    } catch {
      // 缺失或解析失败：继续尝试下一个候选路径
    }
  }
  return {
    ...LEGACY_FALLBACK_CONTRACT,
    capabilities: [...LEGACY_CAPABILITIES],
  };
}

export function hasCapability(contract: SkillContract, cap: string): boolean {
  return contract.capabilities.includes(cap);
}

/** `contract` 子命令输出：纯 JSON，供 agent 直接解析，不含任何人类寒暄文本。 */
export function renderContractCommand(contract: SkillContract): string {
  return JSON.stringify(contract, null, 2);
}
