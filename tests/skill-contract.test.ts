import assert from "node:assert/strict";
import test from "node:test";
import {
  hasCapability,
  LEGACY_CAPABILITIES,
  loadSkillContract,
  renderContractCommand,
} from "../src/triage-cli/contract.ts";

test("loadSkillContract 读取真实 CONTRACT.json（v5）", () => {
  const contract = loadSkillContract();
  assert.equal(contract.contract, "bug-lens-triage");
  assert.equal(contract.contractVersion, 1);
  assert.notEqual(contract.implVersion, "0.0.0");
  assert.equal(contract.implChannel, "v5");
  assert.equal(contract.packSchemaVersion, 5);
});

test("hasCapability 命中已声明能力、拒绝未知能力", () => {
  const contract = loadSkillContract();
  assert.equal(hasCapability(contract, "ticket-draft"), true);
  assert.equal(hasCapability(contract, "nope"), false);
});

test("loadSkillContract 在候选路径全部缺失时降级为 contractVersion 0", () => {
  const contract = loadSkillContract([
    "/nonexistent/bug-lens/CONTRACT.json",
    "/nonexistent/bug-lens/scripts/CONTRACT.json",
  ]);
  assert.equal(contract.contractVersion, 0);
  assert.equal(contract.implVersion, "0.0.0");
  assert.equal(contract.implChannel, "legacy");
  assert.equal(contract.workspaceNamespace, "bug-lens-workspace");
  assert.deepEqual(contract.capabilities, LEGACY_CAPABILITIES);
});

test("renderContractCommand 输出可被 JSON.parse 且不含寒暄文本", () => {
  const output = renderContractCommand(loadSkillContract());
  assert.equal(output.trimStart().startsWith("{"), true);
  const parsed = JSON.parse(output);
  assert.equal(parsed.contract, "bug-lens-triage");
  assert.ok(Array.isArray(parsed.capabilities));
  assert.ok(Array.isArray(parsed.commands));
});

test("v5 工作区命名空间与 legacy 平级并列，不嵌套在其内部", () => {
  const contract = loadSkillContract();
  assert.equal(contract.workspaceNamespace, "bug-lens-workspace-v5");
  assert.ok(contract.workspaceNamespace.endsWith("-v5"));
  assert.ok(!contract.workspaceNamespace.startsWith("bug-lens-workspace/"));
  assert.notEqual(contract.workspaceNamespace, "bug-lens-workspace");
});
