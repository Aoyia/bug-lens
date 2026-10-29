#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const newVersion = args.find((arg) => !arg.startsWith("--"));

if (!newVersion || !/^\d+\.\d+\.\d+$/.test(newVersion)) {
  console.error(
    "Usage: node scripts/release-bump.mjs <new-version> [--dry-run]\nExample: node scripts/release-bump.mjs 0.7.38 --dry-run"
  );
  process.exit(1);
}

const root = process.cwd();
const pkgPath = resolve(root, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const oldVersion = pkg.version;

if (oldVersion === newVersion) {
  console.error(`Current version in package.json is already ${newVersion}.`);
  process.exit(1);
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const targets = [
  {
    relPath: "package.json",
    replace: (content) =>
      content.replace(
        new RegExp(`("version":\\s*")${escapeRegExp(oldVersion)}(")`),
        `$1${newVersion}$2`
      ),
  },
  {
    relPath: "src/manifest.json",
    replace: (content) =>
      content.replace(
        new RegExp(`("version":\\s*")${escapeRegExp(oldVersion)}(")`),
        `$1${newVersion}$2`
      ),
  },
  {
    relPath: "src/components/options/OptionsApp.tsx",
    replace: (content) =>
      content.replace(
        new RegExp(`(:\\s*")${escapeRegExp(oldVersion)}("\\})`),
        `$1${newVersion}$2`
      ),
  },
  {
    relPath: "CHROMEWEBSTORE.md",
    replace: (content) =>
      content
        .replace(
          new RegExp(`(Manifest\\s+\`v)${escapeRegExp(oldVersion)}(\`)`),
          `$1${newVersion}$2`
        )
        .replace(
          new RegExp(
            `(dist-zip/bug-lens-v)${escapeRegExp(oldVersion)}(\\.zip)`,
            "g"
          ),
          `$1${newVersion}$2`
        ),
  },
  {
    relPath: "README.md",
    replace: (content) =>
      content.replace(
        new RegExp(`(bug-lens-v)${escapeRegExp(oldVersion)}(\\.zip)`, "g"),
        `$1${newVersion}$2`
      ),
  },
  {
    relPath: "README_zh.md",
    replace: (content) =>
      content.replace(
        new RegExp(`(bug-lens-v)${escapeRegExp(oldVersion)}(\\.zip)`, "g"),
        `$1${newVersion}$2`
      ),
  },
];

console.log(
  `${dryRun ? "[DRY-RUN] " : ""}Bumping version: ${oldVersion} -> ${newVersion}\n`
);

let hasFailure = false;

for (const target of targets) {
  const absPath = resolve(root, target.relPath);
  const before = readFileSync(absPath, "utf8");
  const after = target.replace(before);

  if (before === after) {
    console.error(`[ERROR] No version match updated in ${target.relPath}`);
    hasFailure = true;
    continue;
  }

  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  console.log(`=== ${target.relPath} ===`);
  for (let i = 0; i < beforeLines.length; i++) {
    if (beforeLines[i] !== afterLines[i]) {
      console.log(`  L${i + 1}:`);
      console.log(`    - ${beforeLines[i]}`);
      console.log(`    + ${afterLines[i]}`);
    }
  }

  // Check if any non-changelog line in the file still has oldVersion
  const residualLines = [];
  afterLines.forEach((line, idx) => {
    if (!line.includes(oldVersion)) return;
    // Allow historical changelog row in CHROMEWEBSTORE.md section 6
    if (
      target.relPath === "CHROMEWEBSTORE.md" &&
      line.trimStart().startsWith(`| \`v${oldVersion}\``)
    ) {
      return;
    }
    residualLines.push(`L${idx + 1}: ${line.trim()}`);
  });

  if (residualLines.length > 0) {
    console.error(
      `  [ERROR] Residual ${oldVersion} found in ${target.relPath}:\n    ${residualLines.join("\n    ")}`
    );
    hasFailure = true;
  }

  if (!dryRun) {
    writeFileSync(absPath, after, "utf8");
  }
}

if (hasFailure) {
  process.exit(1);
}

console.log("\n=== git grep check ===");
try {
  const grepOut = execFileSync(
    "git",
    ["grep", "-n", oldVersion, "--", ...targets.map((t) => t.relPath)],
    { cwd: root, encoding: "utf8" }
  ).trim();

  if (dryRun) {
    console.log(
      "Verified in-memory replacement for all 6 files: 0 unexpected residuals (only CHROMEWEBSTORE.md historical table row preserved)."
    );
  } else {
    const unexpected = grepOut
      .split("\n")
      .filter(Boolean)
      .filter((line) => !line.includes(`| \`v${oldVersion}\``));
    if (unexpected.length > 0) {
      console.error(
        "Unexpected residual version references:\n" + unexpected.join("\n")
      );
      process.exit(1);
    }
    console.log("All 6 files updated cleanly. Historical row preserved:");
    console.log("  " + grepOut);
  }
} catch (err) {
  if (err.status === 1) {
    console.log("0 residual references found in target files.");
  } else {
    throw err;
  }
}
