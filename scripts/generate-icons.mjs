import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

const root = resolve(process.cwd());
const iconsDir = resolve(root, "src/icons");
mkdirSync(iconsDir, { recursive: true });

const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="lensRing" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#3B82F6" />
      <stop offset="100%" stop-color="#1D4ED8" />
    </linearGradient>
    <linearGradient id="handleGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#2563EB" />
      <stop offset="100%" stop-color="#1E40AF" />
    </linearGradient>
    <radialGradient id="recDot" cx="35%" cy="35%" r="65%">
      <stop offset="0%" stop-color="#FF5252" />
      <stop offset="100%" stop-color="#E53935" />
    </radialGradient>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#1D4ED8" flood-opacity="0.3"/>
    </filter>
  </defs>

  <g filter="url(#shadow)">
    <!-- Lens Handle -->
    <path d="M 315 315 L 435 435" stroke="url(#handleGrad)" stroke-width="44" stroke-linecap="round" />

    <!-- Bug Antennae -->
    <path d="M 185 145 C 170 115 145 110 130 118" stroke="#3B82F6" stroke-width="16" stroke-linecap="round" fill="none" />
    <path d="M 255 145 C 270 115 295 110 310 118" stroke="#3B82F6" stroke-width="16" stroke-linecap="round" fill="none" />

    <!-- Bug Legs -->
    <path d="M 130 195 L 165 200 M 125 230 L 165 225 M 130 260 L 165 250" stroke="#475569" stroke-width="14" stroke-linecap="round" />
    <path d="M 310 195 L 275 200 M 315 230 L 275 225 M 310 260 L 275 250" stroke="#475569" stroke-width="14" stroke-linecap="round" />

    <!-- Magnifier Ring Outer -->
    <circle cx="220" cy="220" r="140" fill="none" stroke="url(#lensRing)" stroke-width="36" />

    <!-- Bug Body -->
    <circle cx="220" cy="165" r="26" fill="#334155" />
    <path d="M 160 215 C 160 165 280 165 280 215 C 280 275 160 275 160 215 Z" fill="#334155" />

    <!-- Red Recording Core -->
    <circle cx="220" cy="218" r="32" fill="url(#recDot)" />
    <circle cx="210" cy="208" r="9" fill="#FFFFFF" opacity="0.8" />
  </g>
</svg>`;

writeFileSync(resolve(iconsDir, "icon.svg"), svgContent, "utf-8");

const sizes = [16, 32, 48, 128];

const htmlContent = `<!DOCTYPE html>
<html>
<head>
<style>
  body { margin: 0; padding: 0; background: transparent; }
</style>
</head>
<body>
<div id="svg-container">${svgContent}</div>
<script>
window.renderIcon = function(size) {
  return new Promise((res) => {
    const svg = document.querySelector('svg');
    const svgData = new XMLSerializer().serializeToString(svg);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(img, 0, 0, size, size);
      res(canvas.toDataURL('image/png'));
    };
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
  });
};
</script>
</body>
</html>`;

const tempHtmlPath = resolve(root, "scripts/temp_icon_render.html");
writeFileSync(tempHtmlPath, htmlContent, "utf-8");

console.log("Generating transparent PNG icons...");

// Use Chrome to dump PNG base64 using canvas
const nodeScript = `
import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';

const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const tempHtml = "${tempHtmlPath.replace(/\\/g, "/")}";

for (const size of [16, 32, 48, 128]) {
  const outPath = "${iconsDir.replace(/\\/g, "/")}/icon" + size + ".png";
  // Screenshot directly with transparent background
  execSync(\`"\${chrome}" --headless --default-background-color=00000000 --screenshot="\${outPath}" --window-size=\${size},\${size} "file://\${tempHtml}"\`);
  console.log(\`Generated icon\${size}.png\`);
}
`;

const tempRunner = resolve(root, "scripts/temp_runner.mjs");
writeFileSync(tempRunner, nodeScript, "utf-8");

try {
  execSync(`node "${tempRunner}"`, { stdio: "inherit" });
} finally {
  // clean temporary files
}
