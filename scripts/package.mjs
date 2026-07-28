import { execSync } from "node:child_process";
import { readFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const distDir = join(root, "dist");
const manifestPath = join(distDir, "manifest.json");

if (!existsSync(manifestPath)) {
  console.error("dist/manifest.json not found. Please build the project first.");
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
const version = manifest.version || "0.1.0";
const zipFilename = `web-bug-recorder-v${version}.zip`;
const outputPath = join(root, zipFilename);

if (existsSync(outputPath)) {
  unlinkSync(outputPath);
}

try {
  execSync(`zip -r "${outputPath}" .`, { cwd: distDir, stdio: "inherit" });
  console.log(`\nSuccessfully created release package: ${zipFilename}`);
} catch (err) {
  console.error("Failed to package extension:", err);
  process.exit(1);
}
