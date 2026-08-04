import {
  isEnvelope,
  message,
  type RuntimeMessage,
} from "../../shared/protocol";
import { db } from "../../storage/db";
import { evaluateOffscreenStorageWrite } from "../../storage/storage-health-coordinator";
import { PreviewSessionRuntime } from "../../preview/preview-session-runtime";
import {
  buildEvidencePackage,
  buildAiPrompt,
  type StaticReportAssets,
} from "../../preview/evidence-package";
import {
  writeEvidenceArchive,
  type ArchiveFile,
} from "../../export/export-pipeline";

let recorder: MediaRecorder | undefined;
let capturedStream: MediaStream | undefined;
let playbackContext: AudioContext | undefined;
let sequence = 0;
let activeSessionId: string | undefined;
let storageWarningSent = false;
let recordingBlocked = false;
const pendingWrites = new Set<Promise<void>>();

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  messageText: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(messageText)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function chooseMimeType(audio: boolean): string | undefined {
  const candidates = audio
    ? ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]
    : ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  return candidates.find((candidate) =>
    MediaRecorder.isTypeSupported(candidate)
  );
}

async function startMedia(
  payload: Extract<RuntimeMessage, { type: "offscreen/start-media" }>["payload"]
): Promise<void> {
  if (recorder && recorder.state !== "inactive")
    throw new Error("媒体录制已在进行中 (MEDIA_ALREADY_RECORDING)");
  activeSessionId = payload.sessionId;
  sequence = 0;
  storageWarningSent = false;
  recordingBlocked = false;
  const constraints: MediaStreamConstraints = {
    video: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: payload.streamId,
      },
    } as unknown as MediaTrackConstraints,
    audio: payload.captureAudio
      ? ({
          mandatory: {
            chromeMediaSource: "tab",
            chromeMediaSourceId: payload.streamId,
          },
        } as unknown as MediaTrackConstraints)
      : false,
  };
  try {
    capturedStream = await navigator.mediaDevices.getUserMedia(constraints);
    if (payload.captureAudio && capturedStream.getAudioTracks().length) {
      playbackContext = new AudioContext();
      const source = playbackContext.createMediaStreamSource(
        new MediaStream(capturedStream.getAudioTracks())
      );
      source.connect(playbackContext.destination);
    }
    const recordingStream = new MediaStream([
      ...capturedStream.getVideoTracks(),
      ...(payload.captureAudio ? capturedStream.getAudioTracks() : []),
    ]);
    recorder = new MediaRecorder(recordingStream, {
      mimeType: chooseMimeType(payload.captureAudio),
      videoBitsPerSecond: 2_500_000,
      audioBitsPerSecond: payload.captureAudio ? 128_000 : undefined,
    });
    recorder.ondataavailable = (event) => {
      if (!event.data.size || !activeSessionId || recordingBlocked) return;
      const sessionId = activeSessionId;
      const chunkSequence = sequence++;
      const mimeType = event.data.type || recorder?.mimeType || "video/webm";
      let write!: Promise<void>;
      write = event.data
        .arrayBuffer()
        .then(async (buffer) => {
          const result = await db.saveMediaChunkWithinBudget({
            id: `${sessionId}:${chunkSequence}`,
            sessionId,
            chunk: buffer,
            sequence: chunkSequence,
            mimeType,
            recordedAt: Date.now(),
          });
          const decision = evaluateOffscreenStorageWrite(
            sessionId,
            result,
            storageWarningSent
          );
          if (decision.shouldNotify && decision.message) {
            void chrome.runtime
              .sendMessage(decision.message)
              .catch(() => undefined);
          }
          if (result.stored && result.limitReached) {
            storageWarningSent = true;
          }
          if (!result.stored) {
            recordingBlocked = true;
            await chrome.runtime
              .sendMessage(
                message(
                  "offscreen/media-state",
                  {
                    sessionId,
                    state: "error",
                    error:
                      "SESSION_STORAGE_LIMIT_REACHED: 已停止录像以遵守单会话大小限制。",
                  },
                  sessionId
                )
              )
              .catch(() => undefined);
            if (recorder?.state === "recording") recorder.stop();
          }
        })
        .catch(async (error) => {
          await chrome.runtime
            .sendMessage(
              message(
                "offscreen/media-state",
                {
                  sessionId,
                  state: "error",
                  error: `媒体分片写入失败：${String(error)}`,
                },
                sessionId
              )
            )
            .catch(() => undefined);
          throw error;
        })
        .finally(() => pendingWrites.delete(write));
      pendingWrites.add(write);
      void write.catch(() => undefined);
    };
    recorder.onerror = (event) => {
      void chrome.runtime.sendMessage(
        message(
          "offscreen/media-state",
          {
            sessionId: activeSessionId,
            state: "error",
            error: String(event.error ?? "MediaRecorder error"),
          },
          activeSessionId
        )
      );
    };
    capturedStream.getTracks().forEach((track) =>
      track.addEventListener("ended", () => {
        if (recorder?.state === "recording")
          void chrome.runtime.sendMessage(
            message(
              "offscreen/media-state",
              {
                sessionId: activeSessionId,
                state: "error",
                error: "媒体轨道意外结束",
              },
              activeSessionId
            )
          );
      })
    );
    recorder.start(Math.max(250, payload.timesliceMs));
  } catch (error) {
    capturedStream?.getTracks().forEach((track) => track.stop());
    capturedStream = undefined;
    recorder = undefined;
    activeSessionId = undefined;
    await playbackContext?.close().catch(() => undefined);
    playbackContext = undefined;
    throw error;
  }
}

async function stopMedia(sessionId: string): Promise<void> {
  if (activeSessionId && activeSessionId !== sessionId)
    throw new Error(
      `媒体会话不匹配 (MEDIA_SESSION_MISMATCH:${activeSessionId})`
    );
  let stopError: unknown;
  try {
    if (recorder && recorder.state !== "inactive") {
      await withTimeout(
        new Promise<void>((resolve) => {
          recorder!.addEventListener("stop", () => resolve(), { once: true });
          recorder!.stop();
        }),
        5_000,
        "停止媒体录制超时 (MEDIA_STOP_TIMEOUT)"
      );
    }
  } catch (error) {
    stopError = error;
  }
  const writes = await Promise.allSettled([...pendingWrites]);
  const failures = writes.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected"
  );
  capturedStream?.getTracks().forEach((track) => track.stop());
  await playbackContext?.close().catch(() => undefined);
  playbackContext = undefined;
  capturedStream = undefined;
  recorder = undefined;
  activeSessionId = undefined;
  storageWarningSent = false;
  recordingBlocked = false;
  if (stopError) throw stopError;
  if (failures.length)
    throw new Error(
      `媒体数据块写入失败 (MEDIA_CHUNK_WRITE_FAILED:${failures.map((failure) => String(failure.reason)).join("; ")})`
    );
}

async function pauseMedia(sessionId: string): Promise<void> {
  if (activeSessionId && activeSessionId !== sessionId) return;
  if (recorder && recorder.state === "recording") {
    recorder.pause();
  }
}

async function resumeMedia(sessionId: string): Promise<void> {
  if (activeSessionId && activeSessionId !== sessionId) return;
  if (recorder && recorder.state === "paused") {
    recorder.resume();
  }
}

async function annotateImage(
  payload: Extract<
    RuntimeMessage,
    { type: "offscreen/annotate-image" }
  >["payload"]
): Promise<string> {
  const response = await fetch(payload.dataUrl);
  const bitmap = await createImageBitmap(await response.blob());
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D 绘图上下文不可用");
    context.drawImage(bitmap, 0, 0);
    const x =
      payload.clientX * (bitmap.width / Math.max(1, payload.viewportWidth));
    const y =
      payload.clientY * (bitmap.height / Math.max(1, payload.viewportHeight));
    const radius = Math.max(12, Math.min(bitmap.width, bitmap.height) * 0.018);
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.lineWidth = Math.max(7, radius * 0.45);
    context.strokeStyle = "rgba(255,255,255,.95)";
    context.stroke();
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.lineWidth = Math.max(3, radius * 0.22);
    context.strokeStyle = "#ef233c";
    context.stroke();
    const blob = await canvas.convertToBlob({ type: "image/png" });
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } finally {
    bitmap.close();
  }
}

async function renderIssueImage(
  payload: Extract<
    RuntimeMessage,
    { type: "offscreen/render-issue-image" }
  >["payload"]
): Promise<{ annotatedAssetId: string }> {
  const original = await db.getEvidenceAsset(payload.originalAssetId);
  if (!original)
    throw new Error("ISSUE_ORIGINAL_ASSET_MISSING: 找不到问题现场原始截图");
  const bitmap = await createImageBitmap(
    new Blob([original.bytes], { type: original.mimeType })
  );
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D 绘图上下文不可用");
    context.drawImage(bitmap, 0, 0);
    const x =
      bitmap.width * Math.min(1, Math.max(0, payload.annotation.point.xRatio));
    const y =
      bitmap.height * Math.min(1, Math.max(0, payload.annotation.point.yRatio));
    const unit = Math.max(2, Math.min(bitmap.width, bitmap.height) / 220);
    const red = payload.annotation.color || "#ef233c";
    const boxes = payload.annotation.targetBoxes?.length
      ? payload.annotation.targetBoxes
      : payload.annotation.targetBox
        ? [payload.annotation.targetBox]
        : [];
    const dpr =
      payload.devicePixelRatio || Math.max(1, Math.round(bitmap.width / 1200));
    const borderWidth = Math.max(1, Math.round(1 * dpr));
    const radius = Math.max(2, Math.round(2 * dpr));

    for (const box of boxes) {
      const bx = Math.round(bitmap.width * box.xRatio);
      const by = Math.round(bitmap.height * box.yRatio);
      const bw = Math.round(bitmap.width * box.widthRatio);
      const bh = Math.round(bitmap.height * box.heightRatio);
      const r = Math.min(radius, bh * 0.1, bw * 0.1);

      context.save();
      context.strokeStyle = "#ef233c";
      context.lineWidth = borderWidth;
      if (typeof context.roundRect === "function") {
        context.beginPath();
        context.roundRect(bx, by, bw, bh, r);
        context.stroke();
      } else {
        context.strokeRect(bx, by, bw, bh);
      }
      context.restore();
    }
    if (payload.annotation.label) {
      context.save();
      context.font = `600 ${Math.max(14, unit * 12)}px -apple-system, BlinkMacSystemFont, sans-serif`;
      const label = payload.annotation.label.slice(0, 80);
      const metrics = context.measureText(label);
      const padding = unit * 8;
      const labelX = Math.max(
        padding,
        Math.min(bitmap.width - metrics.width - padding * 2, x + unit * 18)
      );
      const labelY = Math.max(
        padding + unit * 14,
        Math.min(bitmap.height - padding, y - unit * 18)
      );
      context.fillStyle = "rgba(29,33,41,.9)";
      context.fillRect(
        labelX,
        labelY - unit * 18,
        metrics.width + padding * 2,
        unit * 26
      );
      context.fillStyle = "#ffffff";
      context.fillText(label, labelX + padding, labelY);
      context.restore();
    }
    if (payload.annotation.userAnnotations?.length) {
      const userBorderWidth = Math.max(2, Math.round(2.5 * dpr));
      for (const item of payload.annotation.userAnnotations) {
        context.save();
        const strokeColor = item.color || "#165dff";
        context.strokeStyle = strokeColor;
        context.fillStyle = strokeColor;
        context.lineWidth = userBorderWidth;

        if (item.type === "rect") {
          const rx = Math.round(bitmap.width * item.xRatio);
          const ry = Math.round(bitmap.height * item.yRatio);
          const rw = Math.round(bitmap.width * item.widthRatio);
          const rh = Math.round(bitmap.height * item.heightRatio);
          context.strokeRect(rx, ry, rw, rh);
        } else if (item.type === "arrow") {
          const sx = Math.round(bitmap.width * item.startXRatio);
          const sy = Math.round(bitmap.height * item.startYRatio);
          const ex = Math.round(bitmap.width * item.endXRatio);
          const ey = Math.round(bitmap.height * item.endYRatio);

          context.beginPath();
          context.moveTo(sx, sy);
          context.lineTo(ex, ey);
          context.stroke();

          const angle = Math.atan2(ey - sy, ex - sx);
          const headLen = Math.max(12, Math.round(14 * dpr));
          context.beginPath();
          context.moveTo(ex, ey);
          context.lineTo(
            ex - headLen * Math.cos(angle - Math.PI / 6),
            ey - headLen * Math.sin(angle - Math.PI / 6)
          );
          context.lineTo(
            ex - headLen * Math.cos(angle + Math.PI / 6),
            ey - headLen * Math.sin(angle + Math.PI / 6)
          );
          context.closePath();
          context.fill();
        } else if (item.type === "text" && item.text) {
          const tx = Math.round(bitmap.width * item.xRatio);
          const ty = Math.round(bitmap.height * item.yRatio);
          const fontSize = Math.max(
            14,
            Math.round((item.fontSize || 16) * dpr)
          );
          context.font = `700 ${fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
          const pad = Math.round(4 * dpr);

          context.fillStyle = strokeColor;
          context.fillText(item.text, tx, ty - pad / 2);
        }
        context.restore();
      }
    }
    const bytes = await (
      await canvas.convertToBlob({ type: "image/png" })
    ).arrayBuffer();
    const stored = await db.saveEvidenceAssetWithinBudget({
      id: payload.annotatedAssetId,
      sessionId: payload.sessionId,
      issueSceneId: payload.issueSceneId,
      kind: "issue-annotated",
      mimeType: "image/png",
      bytes,
      width: bitmap.width,
      height: bitmap.height,
      createdAtEpochMs: Date.now(),
    });
    if (!stored.stored)
      throw new Error("SESSION_STORAGE_LIMIT_REACHED: 批注图片未保存");
    return { annotatedAssetId: payload.annotatedAssetId };
  } finally {
    bitmap.close();
  }
}

async function exportPack(payload: { sessionId: string }): Promise<{
  prompt: string;
  blobUrl: string;
  filename: string;
}> {
  const runtime = new PreviewSessionRuntime(db);
  await runtime.load(payload.sessionId);
  const snapshot = runtime.getPackageSnapshot();
  if (!snapshot) {
    throw new Error("FAILED_TO_LOAD_SNAPSHOT: 无法生成报告快照");
  }

  const filename = `web-bug-report-${payload.sessionId.slice(0, 8)}.zip`;
  const reportAssets: StaticReportAssets = {
    html: "",
    script: "",
    styles: "",
    icon: new Uint8Array(0),
  };

  const packageFiles = buildEvidencePackage(snapshot, reportAssets);
  const zipChunks: Uint8Array[] = [];
  const sink = {
    write: async (chunk: Uint8Array) => {
      zipChunks.push(chunk);
    },
    close: async () => {},
    abort: async () => {},
  };

  await writeEvidenceArchive({
    files: packageFiles as ArchiveFile[],
    sessionId: payload.sessionId,
    mediaSource: db,
    sink,
  });

  const zipBlob = new Blob(zipChunks as BlobPart[], {
    type: "application/zip",
  });
  const blobUrl = URL.createObjectURL(zipBlob);
  const prompt = buildAiPrompt(snapshot, filename);

  return { prompt, blobUrl, filename };
}

chrome.runtime.onMessage.addListener((raw: unknown) => {
  if (!isEnvelope(raw)) return;
  const incoming = raw as RuntimeMessage;
  if (incoming.type === "offscreen/start-media")
    return startMedia(incoming.payload)
      .then(() => ({ ok: true }))
      .catch((error) => ({ ok: false, error: String(error) }));
  if (incoming.type === "offscreen/stop-media")
    return stopMedia(incoming.payload.sessionId)
      .then(() => ({ ok: true }))
      .catch((error) => ({ ok: false, error: String(error) }));
  if (incoming.type === "offscreen/pause-media")
    return pauseMedia(incoming.payload.sessionId)
      .then(() => ({ ok: true }))
      .catch((error) => ({ ok: false, error: String(error) }));
  if (incoming.type === "offscreen/resume-media")
    return resumeMedia(incoming.payload.sessionId)
      .then(() => ({ ok: true }))
      .catch((error) => ({ ok: false, error: String(error) }));
  if (incoming.type === "offscreen/status")
    return Promise.resolve({
      ok: true,
      active:
        activeSessionId === incoming.payload.sessionId &&
        (recorder?.state === "recording" || recorder?.state === "paused"),
    });
  if (incoming.type === "offscreen/annotate-image")
    return annotateImage(incoming.payload)
      .then((dataUrl) => ({ ok: true, dataUrl }))
      .catch((error) => ({ ok: false, error: String(error) }));
  if (incoming.type === "offscreen/render-issue-image")
    return renderIssueImage(incoming.payload)
      .then((result) => ({ ok: true, ...result }))
      .catch((error) => ({ ok: false, error: String(error) }));
  if (incoming.type === "offscreen/export-pack")
    return exportPack(incoming.payload)
      .then((result) => ({ ok: true, ...result }))
      .catch((error) => ({ ok: false, error: String(error) }));
});
