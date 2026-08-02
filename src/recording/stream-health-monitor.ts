import { message, type RecordingHealthInfo, type RecordingHealthCode, type StreamHealthState, type StreamHealthVector } from "../shared/protocol.ts";

export class StreamHealthMonitor {
  private currentStreams: StreamHealthVector = {
    media: "ok",
    cdp: "ok",
    content: "ok",
    storage: "ok"
  };

  private currentTabId: number | undefined;
  private currentSessionId: string | undefined;

  public initialize(tabId: number, sessionId: string, options: { captureVideo: boolean; captureConsoleOrNetwork: boolean }): void {
    this.currentTabId = tabId;
    this.currentSessionId = sessionId;
    this.currentStreams = {
      media: options.captureVideo ? "ok" : "disabled",
      cdp: options.captureConsoleOrNetwork ? "ok" : "disabled",
      content: "ok",
      storage: "ok"
    };
    void this.sync();
  }

  public getSessionId(): string | undefined {
    return this.currentSessionId;
  }



  public updateStream(stream: keyof StreamHealthVector, state: StreamHealthState): RecordingHealthInfo {
    if (this.currentStreams[stream] !== state) {
      this.currentStreams[stream] = state;
      void this.sync();
    }
    return this.evaluate();
  }

  public getHealth(): RecordingHealthInfo {
    return this.evaluate();
  }

  public evaluate(): RecordingHealthInfo {
    const s = this.currentStreams;

    let code: RecordingHealthCode = "RECORDING";
    let badgeText = "REC";
    let badgeColor = "#d92d20";
    let messageText = "正常录制中";

    if (s.content === "failed" || s.storage === "failed") {
      code = "UNRECOVERABLE";
      badgeText = "ERR";
      badgeColor = "#101828";
      messageText = "录制环境不可恢复或存储失败";
    } else if (s.content === "reconnecting") {
      code = "RECONNECTING";
      badgeText = "LINK";
      badgeColor = "#eaaa08";
      messageText = "页面采集重连中...";
    } else if (s.media === "disrupted" || s.media === "failed") {
      code = "VIDEO_DISRUPTED";
      badgeText = "NO_V";
      badgeColor = "#f04438";
      messageText = "视频画面流中断 (仅采集日志/事件)";
    } else if (s.storage === "disrupted") {
      code = "STORAGE_NEAR_LIMIT";
      badgeText = "FULL";
      badgeColor = "#f79009";
      messageText = "存储空间接近配额上限 (>=90%)";
    } else if (s.cdp === "disrupted" || s.cdp === "reconnecting") {
      code = "PARTIAL_DISRUPTION";
      badgeText = "PART";
      badgeColor = "#f79009";
      messageText = "控制台/网络日志采集中断 (DevTools可能已打开)";
    }

    return {
      code,
      badgeText,
      badgeColor,
      message: messageText,
      streams: { ...this.currentStreams }
    };
  }

  public async sync(): Promise<void> {
    if (!this.currentTabId) return;
    const health = this.evaluate();
    try {
      await chrome.action.setBadgeText({ tabId: this.currentTabId, text: health.badgeText });
      await chrome.action.setBadgeBackgroundColor({ tabId: this.currentTabId, color: health.badgeColor });
      await chrome.action.setIcon({ tabId: this.currentTabId, path: "icons/icon_recording.png" });
    } catch {
      // tab 可能已关闭
    }

    if (this.currentTabId && this.currentSessionId) {
      await chrome.tabs.sendMessage(
        this.currentTabId,
        message("content/health-update", { health }, this.currentSessionId)
      ).catch(() => undefined);
    }
  }

  public reset(tabId?: number): void {
    if (tabId) {
      chrome.action.setBadgeText({ tabId, text: "" }).catch(() => undefined);
      chrome.action.setIcon({ tabId, path: "icons/icon_idle.png" }).catch(() => undefined);
    }
    this.currentTabId = undefined;
    this.currentSessionId = undefined;
    this.currentStreams = { media: "ok", cdp: "ok", content: "ok", storage: "ok" };
  }
}
