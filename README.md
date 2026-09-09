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

### 3. Step-by-Step Action Capture & Visual Timeline (Click Highlights & Locators)

Automatically captures keyframe snapshots for each interaction with precise click indicators (red visual circles). Concurrently extracts target element context (tag, class, role, coordinates) and generates stability-scored Playwright locators, enabling AI assistants to reconstruct user actions and generate automated regression tests effortlessly.

![Step-by-Step Action Capture & Visual Timeline](docs/assets/evidence-preview-workspace.png)

### 4. Web Screenshot & AI Prompt Annotation

Standalone screenshot capture with pixel dimension measurement, directional arrows, and bilingual notes to formulate precise visual bug reports and design modification prompts for AI.

![Web Screenshot & Annotation Tool](docs/assets/screenshot-annotation.png)

---

## 🚀 3-Step Quickstart

1. **Install Extension**: Download the pre-compiled [bug-lens-v0.7.34.zip](https://github.com/Aoyia/bug-lens/releases/latest), unzip, and load via **"Load unpacked"** in Chrome (`chrome://extensions/` with Developer Mode enabled).
2. **One-Click Record**: Click the extension icon (or press `Ctrl/Cmd+Shift+Y`) on any web page and reproduce the bug.
3. **Feed to AI**: Click **"Stop & Export"**—Bug Lens automatically downloads the offline ZIP archive and copies the optimized `AI_PROMPT.md` to your clipboard. Simply paste into Cursor, Claude Code, Codex, Antigravity, or other AI assistants to fix the bug instantly!

---

## 📦 Build from Source

```bash
pnpm install
pnpm run build
# Package release ZIP
pnpm run package
```

## 💬 Community & Feedback

- **Discussions & Ideas**: Join our [GitHub Discussions](https://github.com/Aoyia/bug-lens/discussions) to share ideas, ask questions, or request features.
- **Bug Reports**: Open a [GitHub Issue](https://github.com/Aoyia/bug-lens/issues) with captured evidence.
- **WeChat Group**: Scan the QR code below (primarily for Chinese community):

<img src="docs/assets/wechat-group.jpg" width="200" alt="WeChat Group" />

> If the QR code expires, please open an [Issue](https://github.com/Aoyia/bug-lens/issues).

---

## 📄 License

This project is licensed under the [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0).
