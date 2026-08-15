# Bug Lens

**English** | [中文文档](README_zh.md)

> **The Ultimate Context Provider for AI Code Assistants & Vibe Coders**  
> Effortlessly capture full-stack bug context from browser sessions—DOM snapshots, click tracks, console errors, and network payloads—and export structured AI prompts ready for instant diagnosis.

---

## ⚡ Highlights & Features

### 1. Full-Context Safe Recording Panel

One-click session recording with full control over DOM snapshots, console logs, network request/response bodies, and framework state, with built-in local data sanitization.

<img src="docs/assets/popup-panel.png" width="380" alt="Extension Popup Panel" />

### 2. In-Page Compact Recording Widget

A lightweight floating widget docked during recording. Supports instant issue marking (`Alt/Option+S`), live timer display, and one-click silent export (`Stop & Export`).

![In-Page Recording Widget](docs/assets/in-page-recording-widget.png)

### 3. Interactive Evidence Preview & Timeline Inspection

Inspect recorded sessions with video-timeline synchronization, sanitized network payloads, console error logs, and multi-track filtering before exporting.

![Evidence Preview & Timeline Workspace](docs/assets/evidence-preview-workspace.png)

### 4. Web Screenshot & AI Prompt Annotation

Standalone screenshot capture with pixel dimension measurement, directional arrows, and bilingual notes to formulate precise visual bug reports and design modification prompts for AI.

![Web Screenshot & Annotation Tool](docs/assets/screenshot-annotation.png)

---

## 🚀 3-Step Quickstart

1. **Install Extension**: Download the pre-compiled [bug-lens-v0.6.0.zip](https://github.com/Aoyia/bug-lens/releases/latest), unzip, and load via **"Load unpacked"** in Chrome (`chrome://extensions/` with Developer Mode enabled).
2. **One-Click Record**: Click the extension icon (or press `Ctrl/Cmd+Shift+Y`) on any web page and reproduce the bug.
3. **Feed to AI**: Click **"Stop & Export"**—Bug Lens automatically downloads the offline ZIP archive and copies the optimized `AI_PROMPT.md` to your clipboard. Simply paste into Cursor, Claude Code, or Antigravity to fix the bug instantly!

---

## 📦 Build from Source

```bash
pnpm install
pnpm run build
# Package release ZIP
pnpm run package
```

---

## 📄 License

This project is licensed under the [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0).
