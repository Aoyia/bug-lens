import {
  message,
  type RecordingHealthInfo,
  type RecordingHealthCode,
  type StreamHealthState,
  type StreamHealthVector,
} from "../shared/protocol.ts";
import { t } from "../shared/i18n.ts";

export class StreamHealthMonitor {
  private currentStreams: StreamHealthVector = {
    media: "ok",
    cdp: "ok",
    content: "ok",
    storage: "ok",
  };

  private currentTabId: number | undefined;
  private currentSessionId: string | undefined;

  /**
   * 初始化四流状态：按录制选项把未启用的流（视频 / 控制台网络）置为 disabled，
   * 其余默认 ok，并立即同步一次 badge 与页面健康提示。
   */
  public initialize(
    tabId: number,
    sessionId: string,
    options: { captureVideo: boolean; captureConsoleOrNetwork: boolean }
  ): void {
    this.currentTabId = tabId;
    this.currentSessionId = sessionId;
    this.currentStreams = {
      media: options.captureVideo ? "ok" : "disabled",
      cdp: options.captureConsoleOrNetwork ? "ok" : "disabled",
      content: "ok",
      storage: "ok",
    };
    void this.sync();
  }

  public getSessionId(): string | undefined {
    return this.currentSessionId;
  }

  /** 更新单条流的状态：仅在值变化时触发 UI 同步，避免无效刷新；返回最新健康信息。 */
  public updateStream(
    stream: keyof StreamHealthVector,
    state: StreamHealthState
  ): RecordingHealthInfo {
    if (this.currentStreams[stream] !== state) {
      this.currentStreams[stream] = state;
      void this.sync();
    }
    return this.evaluate();
  }

  public getHealth(): RecordingHealthInfo {
    return this.evaluate();
  }

  /**
   * 按优先级聚合四流状态为单一健康码：内容/存储 failed 最优先（不可恢复），
   * 依次为页面重连中、视频中断、存储接近上限、控制台/网络中断，均无异常才为
   * RECORDING；同时决定 badge 文案与颜色。
   */
  public evaluate(): RecordingHealthInfo {
    const s = this.currentStreams;

    let code: RecordingHealthCode = "RECORDING";
    let badgeText = "REC";
    let badgeColor = "#d92d20";
    let messageText = t("healthNormal");

    if (s.content === "failed" || s.storage === "failed") {
      code = "UNRECOVERABLE";
      badgeText = "ERR";
      badgeColor = "#101828";
      messageText = t("healthUnrecoverable");
    } else if (s.content === "reconnecting") {
      code = "RECONNECTING";
      badgeText = "LINK";
      badgeColor = "#eaaa08";
      messageText = t("healthReconnecting");
    } else if (s.media === "disrupted" || s.media === "failed") {
      code = "VIDEO_DISRUPTED";
      badgeText = "NO_V";
      badgeColor = "#f04438";
      messageText = t("healthVideoDisrupted");
    } else if (s.storage === "disrupted") {
      code = "STORAGE_NEAR_LIMIT";
      badgeText = "FULL";
      badgeColor = "#f79009";
      messageText = t("healthStorageNearLimit");
    } else if (s.cdp === "disrupted" || s.cdp === "reconnecting") {
      code = "PARTIAL_DISRUPTION";
      badgeText = "PART";
      badgeColor = "#f79009";
      messageText = t("healthPartialDisruption");
    }

    return {
      code,
      badgeText,
      badgeColor,
      message: messageText,
      streams: { ...this.currentStreams },
    };
  }

  /** 把聚合结果同步到 UI：badge 文案/颜色 + 录制态图标，并向 content 推送健康更新。 */
  public async sync(): Promise<void> {
    if (!this.currentTabId) return;
    const health = this.evaluate();
    try {
      await chrome.action.setBadgeText({
        tabId: this.currentTabId,
        text: health.badgeText,
      });
      await chrome.action.setBadgeBackgroundColor({
        tabId: this.currentTabId,
        color: health.badgeColor,
      });
      await chrome.action.setIcon({
        tabId: this.currentTabId,
        path: "icons/icon_recording.png",
      });
    } catch {
      // tab 可能已关闭
    }

    if (this.currentTabId && this.currentSessionId) {
      await chrome.tabs
        .sendMessage(
          this.currentTabId,
          message("content/health-update", { health }, this.currentSessionId)
        )
        .catch(() => undefined);
    }
  }

  /** 录制结束清理：清空目标 tab 的 badge 并恢复空闲图标，重置内部状态。 */
  public reset(tabId?: number): void {
    if (tabId) {
      chrome.action.setBadgeText({ tabId, text: "" }).catch(() => undefined);
      chrome.action
        .setIcon({ tabId, path: "icons/icon_idle.png" })
        .catch(() => undefined);
    }
    this.currentTabId = undefined;
    this.currentSessionId = undefined;
    this.currentStreams = {
      media: "ok",
      cdp: "ok",
      content: "ok",
      storage: "ok",
    };
  }
}
