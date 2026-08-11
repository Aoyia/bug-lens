# Privacy Policy for Bug Lens

**Effective Date**: July 30, 2026

Bug Lens ("the Extension") is committed to protecting your privacy. This Privacy Policy explains how the Extension handles, processes, and protects your information.

## 1. Data Collection and Processing

- **Local-Only Storage**: All captured data—including DOM snapshots, Console logs, Network request headers/bodies, screenshots, and audio/video recordings—are **stored exclusively in your local browser's IndexedDB**.
- **No Remote Servers**: The Extension does NOT operate any external servers, does NOT track user behavior, and NEVER transmits, sells, or shares your personal data or browsing activity with any third party. Exported evidence packages are self-contained ZIP files that you choose to share.

## 2. Capture Modes & Redaction Limits

- **Text Redaction (default)**: Bug Lens applies rule-based redaction to URL credentials and query values, DOM text, Console text, sensitive response headers, JSON fields, and common credential patterns. Base64-encoded response bodies are omitted.
- **Raw Text**: Raw mode preserves captured URL, DOM, Console, and Network text wherever the browser makes it available. It may contain credentials, personal information, and confidential business data.
- **Visual Evidence Is Not Redacted**: Video recordings, screenshots, and optional tab audio are captured as rendered and are not automatically blurred or sanitized in either mode. Users must review exported evidence before sharing it or providing it to an AI system.
- **Best-Effort Rules**: Text redaction reduces accidental disclosure but cannot identify every site-specific sensitive value. It is not a guarantee that an evidence package contains no sensitive information.

## 3. Permission Justifications

- **activeTab**: To inspect the current active tab and control recording sessions.
- **tabs**: To track tab lifecycle and keep evidence capture attached to the tab being recorded.
- **alarms**: To schedule background housekeeping (session finalization and stale-data cleanup) while the browser is running.
- **clipboardWrite**: To copy evidence summaries or report content to the clipboard only on explicit user action.
- **debugger (DevTools Protocol)**: Used solely during an active recording session to capture Console logs and Network request details to generate structured debugging reports.
- **downloads**: To allow downloading exported evidence packages to local disk.
- **offscreen**: To perform audio/video processing and annotated screenshot rendering locally in an offscreen canvas.
- **scripting**: To track click interactions on web pages during a recording session.
- **storage & unlimitedStorage**: Used solely to persist un-exported evidence packages and recording preferences locally on your machine.
- **tabCapture**: To record the active tab's media during bug reproduction, solely upon user action.
- **webNavigation**: To track navigation events so evidence capture continues across page loads.

## 4. User Control

You retain full control over your data. You can clear all stored sessions and evidence packages at any time within the Extension's preview workspace or by uninstalling the Extension.

## 5. Contact Us

If you have any questions regarding this Privacy Policy, please open an issue on our GitHub repository:
https://github.com/Aoyia/bug-lens
