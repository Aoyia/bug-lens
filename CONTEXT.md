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
