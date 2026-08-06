# Bug Lens

Bug Lens is a local-first browser extension that turns a browser interaction into a bounded, reviewable diagnostic evidence package.

## Language

**Recording Session**:
One bounded capture attempt for one browser tab, including its configuration, lifecycle and collected evidence.
_Avoid_: recording, task, report

**Evidence Stream**:
One independently configurable kind of session evidence, such as video, screenshots, Console, Network metadata or Network bodies.
_Avoid_: artifact, log channel

**Evidence State**:
The user-visible outcome for an Evidence Stream: captured, partial, failed, redacted, disabled or pending.
_Avoid_: quality, health

**Storage Budget**:
The maximum local bytes a Recording Session may retain before a stream is stopped or new evidence is rejected.
_Avoid_: quota, cache limit

**Continuation Session**:
A new Recording Session linked to an interrupted earlier session; it preserves the original evidence but never claims to resume its media stream.
_Avoid_: resume, restore recording

**Export Manifest**:
The versioned, unhashed index of an evidence package's files, their byte sizes, hashes and compatible schema revisions.
_Avoid_: report metadata, checksum file

**Offline Evidence Report**:
The read-only, fully local projection of the selected evidence in an exported package. It shares the Preview display module but never exposes selection editing, extension storage or local download-path actions.
_Avoid_: second preview implementation, editable export

**Issue Scene**:
A user-confirmed abnormal page state containing a clean screenshot, independent SVG annotation, target DOM snapshot, narrative and observed timestamp. It does not own or automatically link Network, Console or interaction records.
_Avoid_: automatically inferred causal evidence, linked request bundle

**Framework State Snapshot**:
A React component tree or Vue component chain (including Pinia/Vuex stores) and key webStorage entries captured at a moment, with sensitive keys redacted.
_Avoid_: framework dump, component dump

**Environment Snapshot**:
The top-frame runtime environment captured at a moment: user agent, platform, language, screen and viewport size, device pixel ratio and online status.
_Avoid_: env info, browser fingerprint

**Video Clip**:
A short re-encoded segment (default 5 seconds around a selected time) exported from the recorded media via Canvas + MediaRecorder. It is a derived artifact, never the source recording.
_Avoid_: video editing, trimmed video

**Silent Export**:
A stop-flow that packages and downloads the evidence package from the Offscreen document without opening the Preview page. A failure must surface as a session quality issue, never as a fake success.
_Avoid_: background export, auto-export

**Screenshot Evidence Package**:
A standalone ZIP produced by the crop-and-annotate flow (screenshot.png, ai-prompt.md, dom-context.json, environment.json). It is independent of any Recording Session and its stores.
_Avoid_: quick screenshot, screenshot export

**Spatial-Temporal Causal Slice**:
A structured evidence slice combining a user-selected pixel region, spatially pruned DOM components and a short temporal trace of errors and network responses around the capture moment.
_Avoid_: crop analysis, region dump
