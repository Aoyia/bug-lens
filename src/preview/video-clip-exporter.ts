export async function exportVideoClip(
  video: HTMLVideoElement,
  startTimeSec: number,
  endTimeSec: number,
  filename: string,
  onNotify: (msg: string) => void
): Promise<void> {
  if (
    !video ||
    !video.duration ||
    isNaN(video.duration) ||
    video.duration <= 0
  ) {
    onNotify("暂无有效视频录像，无法导出片段");
    return;
  }

  const duration = video.duration;
  const start = Math.max(0, startTimeSec);
  const end = Math.min(duration, endTimeSec);

  if (end <= start) {
    onNotify("视频剪辑时间区间无效");
    return;
  }

  onNotify("正在生成前后 5s 视频片段，请稍候…");

  const originalTime = video.currentTime;
  const originalPaused = video.paused;
  const originalRate = video.playbackRate;

  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth || 1920;
  canvas.height = video.videoHeight || 1080;
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    onNotify("Canvas 初始化失败");
    return;
  }

  try {
    const mp4Types = [
      "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
      "video/mp4;codecs=avc1",
      "video/mp4;codecs=h264",
      "video/mp4",
    ];

    let mimeType = "video/mp4";
    let extension = "mp4";

    const supportedMp4 = mp4Types.find(
      (t) =>
        typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)
    );

    if (supportedMp4) {
      mimeType = supportedMp4;
      extension = "mp4";
    } else if (
      typeof MediaRecorder !== "undefined" &&
      MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
    ) {
      mimeType = "video/webm;codecs=vp9";
      extension = "webm";
    } else {
      mimeType = "video/webm";
      extension = "webm";
    }

    const finalFilename =
      filename.replace(/\.(mp4|webm)$/i, "") + `.${extension}`;

    const stream = canvas.captureStream(30);
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 5000000,
    });

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        chunks.push(e.data);
      }
    };

    recorder.onstop = async () => {
      video.playbackRate = originalRate;
      video.currentTime = originalTime;
      if (originalPaused) {
        video.pause();
      } else {
        void video.play().catch(() => undefined);
      }

      const clipBlob = new Blob(chunks, { type: mimeType });
      const blobUrl = URL.createObjectURL(clipBlob);

      try {
        if (typeof chrome !== "undefined" && chrome.downloads?.download) {
          await chrome.downloads.download({
            url: blobUrl,
            filename: finalFilename,
            saveAs: true,
          });
        } else {
          const a = document.createElement("a");
          a.href = blobUrl;
          a.download = finalFilename;
          document.body.appendChild(a);
          a.click();
          a.remove();
        }
        onNotify(`已成功触发下载 MP4 视频片段 (${finalFilename})`);
      } catch (err) {
        onNotify(`下载失败：${String(err)}`);
      } finally {
        setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
      }
    };

    video.pause();
    video.currentTime = start;

    await new Promise<void>((resolve) => {
      const onSeeked = () => {
        video.removeEventListener("seeked", onSeeked);
        resolve();
      };
      video.addEventListener("seeked", onSeeked);
    });

    recorder.start();
    video.playbackRate = 2.0;
    void video.play();

    let animId: number;
    const renderFrame = () => {
      if (video.currentTime >= end || video.paused || video.ended) {
        cancelAnimationFrame(animId);
        video.pause();
        if (recorder.state !== "inactive") {
          recorder.stop();
        }
        return;
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      animId = requestAnimationFrame(renderFrame);
    };

    animId = requestAnimationFrame(renderFrame);
  } catch (error) {
    video.playbackRate = originalRate;
    video.currentTime = originalTime;
    onNotify(`导出视频片段失败：${String(error)}`);
  }
}
