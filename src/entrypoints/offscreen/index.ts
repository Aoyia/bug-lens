import { isEnvelope, message, type RuntimeMessage } from "../../shared/protocol";
import { db } from "../../storage/db";

let recorder: MediaRecorder | undefined;
let capturedStream: MediaStream | undefined;
let playbackContext: AudioContext | undefined;
let sequence = 0;
let activeSessionId: string | undefined;
let mediaLimitReached = false;
const pendingWrites = new Set<Promise<void>>();

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, messageText: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(messageText)), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}

function chooseMimeType(audio: boolean): string | undefined {
  const candidates = audio ? ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"] : ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
}

async function startMedia(payload: Extract<RuntimeMessage, { type: "offscreen/start-media" }>["payload"]): Promise<void> {
  if (recorder && recorder.state !== "inactive") throw new Error("媒体录制已在进行中 (MEDIA_ALREADY_RECORDING)");
  activeSessionId = payload.sessionId;
  sequence = 0;
  mediaLimitReached = false;
  const constraints: MediaStreamConstraints = {
    video: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: payload.streamId } } as unknown as MediaTrackConstraints,
    audio: payload.captureAudio ? { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: payload.streamId } } as unknown as MediaTrackConstraints : false
  };
  try {
    capturedStream = await navigator.mediaDevices.getUserMedia(constraints);
    if (payload.captureAudio && capturedStream.getAudioTracks().length) {
      playbackContext = new AudioContext();
      const source = playbackContext.createMediaStreamSource(new MediaStream(capturedStream.getAudioTracks()));
      source.connect(playbackContext.destination);
    }
    const recordingStream = new MediaStream([...capturedStream.getVideoTracks(), ...(payload.captureAudio ? capturedStream.getAudioTracks() : [])]);
    recorder = new MediaRecorder(recordingStream, {
      mimeType: chooseMimeType(payload.captureAudio),
      videoBitsPerSecond: 2_500_000,
      audioBitsPerSecond: payload.captureAudio ? 128_000 : undefined
    });
    recorder.ondataavailable = (event) => {
      if (!event.data.size || !activeSessionId || mediaLimitReached) return;
      const sessionId = activeSessionId;
      const chunkSequence = sequence++;
      const mimeType = event.data.type || recorder?.mimeType || "video/webm";
      let write!: Promise<void>;
      write = event.data.arrayBuffer()
        .then(async (buffer) => {
          const result = await db.saveMediaChunkWithinBudget({ id: `${sessionId}:${chunkSequence}`, sessionId, chunk: buffer, sequence: chunkSequence, mimeType, recordedAt: Date.now() });
          if (result.stored) return;
          mediaLimitReached = true;
          await chrome.runtime.sendMessage(message("offscreen/media-state", { sessionId, state: "error", error: "SESSION_STORAGE_LIMIT_REACHED: 已停止录像以遵守单会话大小限制。" }, sessionId)).catch(() => undefined);
          if (recorder?.state === "recording") recorder.stop();
        })
        .catch(async (error) => {
          await chrome.runtime.sendMessage(message("offscreen/media-state", { sessionId, state: "error", error: `媒体分片写入失败：${String(error)}` }, sessionId)).catch(() => undefined);
          throw error;
        })
        .finally(() => pendingWrites.delete(write));
      pendingWrites.add(write);
      void write.catch(() => undefined);
    };
    recorder.onerror = (event) => { void chrome.runtime.sendMessage(message("offscreen/media-state", { sessionId: activeSessionId, state: "error", error: String(event.error ?? "MediaRecorder error") }, activeSessionId)); };
    capturedStream.getTracks().forEach((track) => track.addEventListener("ended", () => { if (recorder?.state === "recording") void chrome.runtime.sendMessage(message("offscreen/media-state", { sessionId: activeSessionId, state: "error", error: "媒体轨道意外结束" }, activeSessionId)); }));
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
  if (activeSessionId && activeSessionId !== sessionId) throw new Error(`媒体会话不匹配 (MEDIA_SESSION_MISMATCH:${activeSessionId})`);
  let stopError: unknown;
  try {
    if (recorder && recorder.state !== "inactive") {
      await withTimeout(new Promise<void>((resolve) => { recorder!.addEventListener("stop", () => resolve(), { once: true }); recorder!.stop(); }), 5_000, "停止媒体录制超时 (MEDIA_STOP_TIMEOUT)");
    }
  } catch (error) {
    stopError = error;
  }
  const writes = await Promise.allSettled([...pendingWrites]);
  const failures = writes.filter((result): result is PromiseRejectedResult => result.status === "rejected");
  capturedStream?.getTracks().forEach((track) => track.stop());
  await playbackContext?.close().catch(() => undefined);
  playbackContext = undefined;
  capturedStream = undefined;
  recorder = undefined;
  activeSessionId = undefined;
  mediaLimitReached = false;
  if (stopError) throw stopError;
  if (failures.length) throw new Error(`媒体数据块写入失败 (MEDIA_CHUNK_WRITE_FAILED:${failures.map((failure) => String(failure.reason)).join("; ")})`);
}

async function annotateImage(payload: Extract<RuntimeMessage, { type: "offscreen/annotate-image" }>["payload"]): Promise<string> {
  const response = await fetch(payload.dataUrl);
  const bitmap = await createImageBitmap(await response.blob());
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D 绘图上下文不可用");
    context.drawImage(bitmap, 0, 0);
    const x = payload.clientX * (bitmap.width / Math.max(1, payload.viewportWidth));
    const y = payload.clientY * (bitmap.height / Math.max(1, payload.viewportHeight));
    const radius = Math.max(12, Math.min(bitmap.width, bitmap.height) * 0.018);
    context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.lineWidth = Math.max(7, radius * 0.45); context.strokeStyle = "rgba(255,255,255,.95)"; context.stroke();
    context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.lineWidth = Math.max(3, radius * 0.22); context.strokeStyle = "#ef233c"; context.stroke();
    const blob = await canvas.convertToBlob({ type: "image/png" });
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } finally { bitmap.close(); }
}

chrome.runtime.onMessage.addListener((raw: unknown) => {
  if (!isEnvelope(raw)) return;
  const incoming = raw as RuntimeMessage;
  if (incoming.type === "offscreen/start-media") return startMedia(incoming.payload).then(() => ({ ok: true })).catch((error) => ({ ok: false, error: String(error) }));
  if (incoming.type === "offscreen/stop-media") return stopMedia(incoming.payload.sessionId).then(() => ({ ok: true })).catch((error) => ({ ok: false, error: String(error) }));
  if (incoming.type === "offscreen/status") return Promise.resolve({ ok: true, active: activeSessionId === incoming.payload.sessionId && recorder?.state === "recording" });
  if (incoming.type === "offscreen/annotate-image") return annotateImage(incoming.payload).then((dataUrl) => ({ ok: true, dataUrl })).catch((error) => ({ ok: false, error: String(error) }));
});
