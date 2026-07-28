import { createServer } from "node:http";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { exec } from "node:child_process";

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
  </defs>

  <!-- Lens Handle -->
  <path d="M 315 315 L 435 435" stroke="url(#handleGrad)" stroke-width="44" stroke-linecap="round" />

  <!-- Bug Antennae -->
  <path d="M 185 145 C 170 115 145 110 130 118" stroke="#3B82F6" stroke-width="18" stroke-linecap="round" fill="none" />
  <path d="M 255 145 C 270 115 295 110 310 118" stroke="#3B82F6" stroke-width="18" stroke-linecap="round" fill="none" />

  <!-- Bug Legs -->
  <path d="M 130 195 L 165 200 M 125 230 L 165 225 M 130 260 L 165 250" stroke="#475569" stroke-width="14" stroke-linecap="round" />
  <path d="M 310 195 L 275 200 M 315 230 L 275 225 M 310 260 L 275 250" stroke="#475569" stroke-width="14" stroke-linecap="round" />

  <!-- Magnifier Ring Outer -->
  <circle cx="220" cy="220" r="140" fill="none" stroke="url(#lensRing)" stroke-width="38" />

  <!-- Bug Body -->
  <circle cx="220" cy="165" r="26" fill="#334155" />
  <path d="M 160 215 C 160 165 280 165 280 215 C 280 275 160 275 160 215 Z" fill="#334155" />

  <!-- Red Recording Core -->
  <circle cx="220" cy="218" r="32" fill="url(#recDot)" />
  <circle cx="210" cy="208" r="9" fill="#FFFFFF" opacity="0.85" />
</svg>`;

writeFileSync(resolve(iconsDir, "icon.svg"), svgContent, "utf-8");

const sizes = [16, 32, 48, 128];
let savedCount = 0;

const server = createServer((req, res) => {
  if (req.method === "POST") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      const { size, dataUrl } = JSON.parse(body);
      const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");
      const filePath = resolve(iconsDir, `icon${size}.png`);
      writeFileSync(filePath, Buffer.from(base64Data, "base64"));
      console.log(`Saved transparent icon: icon${size}.png`);
      savedCount++;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true }));

      if (savedCount === sizes.length) {
        console.log("All transparent icons generated successfully!");
        setTimeout(() => {
          server.close();
          process.exit(0);
        }, 300);
      }
    });
    return;
  }

  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(`<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body>
<div id="container" style="display:none;">${svgContent}</div>
<script>
async function generate() {
  const svgEl = document.querySelector('svg');
  const svgString = new XMLSerializer().serializeToString(svgEl);
  const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  for (const size of ${JSON.stringify(sizes)}) {
    await new Promise((res) => {
      const img = new Image();
      img.onload = async () => {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, size, size);
        ctx.drawImage(img, 0, 0, size, size);
        const dataUrl = canvas.toDataURL('image/png');
        await fetch('/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ size, dataUrl })
        });
        URL.revokeObjectURL(url);
        res();
      };
      img.src = url;
    });
  }
}
generate();
</script>
</body>
</html>`);
});

server.listen(9876, () => {
  const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  exec(`"${chrome}" --headless --disable-gpu "http://localhost:9876"`);
});
