import { isEnvelope, message, type RuntimeMessage } from "../../shared/protocol";
import { db } from "../../storage/db";

let recorder: MediaRecorder | undefined;
let capturedStream: MediaStream | undefined;
let sequence = 0;
let activeSessionId: string | undefined;
const pendingWrites = new Set<Promise<void>>();

function chooseMimeType(audio: boolean): string | undefined {
  const candidates = audio ? ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"] : ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
}

async function startMedia(payload: Extract<RuntimeMessage, { type: "offscreen/start-media" }>["payload"]): Promise<void> {
  activeSessionId = payload.sessionId;
  sequence = 0;
  const constraints: MediaStreamConstraints = {
    video: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: payload.streamId } } as unknown as MediaTrackConstraints,
    audio: payload.captureAudio ? { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: payload.streamId } } as unknown as MediaTrackConstraints : false
  };
  try {
    capturedStream = await navigator.mediaDevices.getUserMedia(constraints);
    if (payload.captureAudio && capturedStream.getAudioTracks().length) {
      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(new MediaStream(capturedStream.getAudioTracks()));
      source.connect(audioContext.destination);
    }
    const recordingStream = new MediaStream([...capturedStream.getVideoTracks(), ...(payload.captureAudio ? capturedStream.getAudioTracks() : [])]);
    recorder = new MediaRecorder(recordingStream, { mimeType: chooseMimeType(payload.captureAudio) });
    recorder.ondataavailable = (event) => {
      if (!event.data.size || !activeSessionId) return;
      const sessionId = activeSessionId;
      const chunkSequence = sequence++;
      const mimeType = event.data.type || recorder?.mimeType || "video/webm";
      const write = event.data.arrayBuffer().then((buffer) => db.saveMediaChunk({ id: `${sessionId}:${chunkSequence}`, sessionId, chunk: buffer, sequence: chunkSequence, mimeType, recordedAt: Date.now() }));
      pendingWrites.add(write);
      void write.catch((error) => chrome.runtime.sendMessage(message("offscreen/media-state", { sessionId, state: "error", error: `媒体分片写入失败：${String(error)}` }, sessionId))).finally(() => pendingWrites.delete(write));
    };
    recorder.onerror = (event) => { void chrome.runtime.sendMessage(message("offscreen/media-state", { sessionId: activeSessionId, state: "error", error: String(event.error ?? "MediaRecorder error") }, activeSessionId)); };
    capturedStream.getTracks().forEach((track) => track.addEventListener("ended", () => { if (recorder?.state === "recording") void chrome.runtime.sendMessage(message("offscreen/media-state", { sessionId: activeSessionId, state: "error", error: "媒体轨道意外结束" }, activeSessionId)); }));
    recorder.start(Math.max(250, payload.timesliceMs));
    await chrome.runtime.sendMessage(message("offscreen/media-state", { sessionId: payload.sessionId, state: "started" }, payload.sessionId));
  } catch (error) {
    await chrome.runtime.sendMessage(message("offscreen/media-state", { sessionId: payload.sessionId, state: "error", error: String(error) }, payload.sessionId));
  }
}

async function stopMedia(sessionId: string): Promise<void> {
  if (recorder && recorder.state !== "inactive") {
    await new Promise<void>((resolve) => { recorder!.addEventListener("stop", () => resolve(), { once: true }); recorder!.stop(); });
  }
  await Promise.allSettled([...pendingWrites]);
  capturedStream?.getTracks().forEach((track) => track.stop());
  capturedStream = undefined;
  recorder = undefined;
  activeSessionId = undefined;
  await chrome.runtime.sendMessage(message("offscreen/media-state", { sessionId, state: "stopped" }, sessionId));
}

async function annotateImage(payload: Extract<RuntimeMessage, { type: "offscreen/annotate-image" }>["payload"]): Promise<string> {
  const response = await fetch(payload.dataUrl);
  const bitmap = await createImageBitmap(await response.blob());
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D context unavailable");
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
  if (incoming.type === "offscreen/annotate-image") return annotateImage(incoming.payload).then((dataUrl) => ({ ok: true, dataUrl })).catch((error) => ({ ok: false, error: String(error) }));
});
