import { applyCharBudget } from "../format/budget.ts";
import {
  describeWorkspace,
  extractPackToDisk,
  getPackWorkspaceDir,
  openPack,
} from "../pack/open.ts";

export function runExtractPackTool(args: {
  pack?: string;
  dest?: string;
  format?: "text" | "json";
}): string {
  // open_pack 已将 ZIP 解压到工作区；未指定 --dest 时直接返回该工作区，指定时再复制一份
  const loaded = openPack(args.pack);
  const workspaceDir = getPackWorkspaceDir(loaded);
  const res =
    !args.dest && workspaceDir
      ? describeWorkspace(loaded, workspaceDir)
      : extractPackToDisk(loaded, args.dest);

  if (args.format === "json") {
    return applyCharBudget(JSON.stringify(res, null, 2));
  }

  const lines: string[] = [];
  lines.push(`# Extracted Bug Lens Pack`);
  lines.push(`- **Destination**: \`${res.destDir}\``);
  lines.push(`- **Written Files**: ${res.writtenFiles.length}`);
  if (res.renamedPaths.length > 0) {
    lines.push(
      `- **Sanitized Filenames (Windows-safe)**: ${res.renamedPaths.length} file(s) had reserved characters (\`:\` etc.) replaced with \`_\` and references updated in \`data/session-data.js\`.`
    );
  }
  if (res.reproduceSpecPath) {
    lines.push(
      `- **Playwright Reproduction Spec**: \`${res.reproduceSpecPath}\``
    );
    lines.push(
      `  - Run command: \`npx playwright test --headed "${res.reproduceSpecPath}"\``
    );
  }
  if (res.reportHtmlPath) {
    lines.push(`- **Interactive HTML Report**: \`${res.reportHtmlPath}\``);
  }
  if (res.screenshotPath) {
    lines.push(`- **Screenshot File**: \`${res.screenshotPath}\``);
  }

  return lines.join("\n");
}
