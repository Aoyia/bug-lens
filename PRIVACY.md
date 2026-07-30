# Privacy Policy for Bug Lens

**Effective Date**: July 30, 2026

Bug Lens ("the Extension") is committed to protecting your privacy. This Privacy Policy explains how the Extension handles, processes, and protects your information.

## 1. Data Collection and Processing
- **Local-Only Storage**: All captured data—including DOM snapshots, Console logs, Network request headers/bodies, screenshots, and audio/video recordings—are **stored exclusively in your local browser's IndexedDB**.
- **No Remote Servers**: The Extension does NOT operate any external servers, does NOT track user behavior, and NEVER transmits, sells, or shares your personal data or browsing activity with any third party.

## 2. Permission Justifications
- **debugger (DevTools Protocol)**: Used solely during an active recording session to capture Console logs and Network request details to generate structured debugging reports.
- **tabCapture & offscreen**: Used solely upon user action to record tab media and render annotated screenshots in a local offscreen canvas.
- **storage & unlimitedStorage**: Used solely to persist un-exported evidence packages locally on your machine.

## 3. User Control
You retain full control over your data. You can clear all stored sessions and evidence packages at any time within the Extension's preview workspace or by uninstalling the Extension.

## 4. Contact Us
If you have any questions regarding this Privacy Policy, please open an issue on our GitHub repository:
https://github.com/Aoyia/bug-lens
