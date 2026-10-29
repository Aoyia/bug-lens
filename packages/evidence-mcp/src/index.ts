import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createEvidenceMcpServer } from "./server.ts";

function installSkillCli(args: string[]): void {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(__dirname, "SKILL.md"),
    resolve(__dirname, "../../../.agents/skills/bug-lens-triage/SKILL.md"),
  ];
  const skillPath = candidates.find((p) => existsSync(p));
  if (!skillPath) {
    process.stderr.write("[bug-lens-mcp] SKILL.md not found in package.\n");
    process.exit(1);
  }
  const content = readFileSync(skillPath, "utf8");
  const home = homedir();
  const targetArg = args.find((a) => !a.startsWith("-")) ?? "auto";

  const targetMap: Record<string, string> = {
    antigravity: join(home, ".gemini/config/skills/bug-lens-triage/SKILL.md"),
    claude: join(home, ".claude/skills/bug-lens-triage/SKILL.md"),
    cursor: join(home, ".cursor/skills/bug-lens-triage/SKILL.md"),
    project: resolve(process.cwd(), ".agents/skills/bug-lens-triage/SKILL.md"),
  };

  const destPaths: string[] = [];
  if (targetArg === "auto") {
    if (existsSync(join(home, ".gemini")))
      destPaths.push(targetMap.antigravity);
    if (existsSync(join(home, ".claude"))) destPaths.push(targetMap.claude);
    if (existsSync(join(home, ".cursor"))) destPaths.push(targetMap.cursor);
    if (destPaths.length === 0) destPaths.push(targetMap.antigravity);
  } else if (targetMap[targetArg]) {
    destPaths.push(targetMap[targetArg]);
  } else {
    process.stderr.write(
      `Usage: bug-lens-mcp install-skill [auto|antigravity|claude|cursor|project]\n`
    );
    process.exit(1);
  }

  for (const dst of destPaths) {
    mkdirSync(dirname(dst), { recursive: true });
    writeFileSync(dst, content, "utf8");
    process.stdout.write(`[bug-lens-mcp] Installed skill to ${dst}\n`);
  }
}

async function main(): Promise<void> {
  if (process.argv[2] === "install-skill") {
    installSkillCli(process.argv.slice(3));
    return;
  }
  const server = createEvidenceMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  const message =
    err instanceof Error ? (err.stack ?? err.message) : String(err);
  process.stderr.write(`[bug-lens-mcp] Fatal error: ${message}\n`);
  process.exit(1);
});
