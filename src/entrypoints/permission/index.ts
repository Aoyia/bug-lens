import { message, type RecordingOptions } from "../../shared/protocol";
import { applyI18n } from "../../shared/i18n";

applyI18n();

const $ = <T extends HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;

function setError(errorMsg: string): void {
  const errorBox = $("#error-box");
  const statusContainer = $("#status-container");
  const grantBtn = $("#grant-btn");
  errorBox.hidden = false;
  errorBox.textContent = errorMsg;
  if (statusContainer) statusContainer.hidden = true;
  if (grantBtn) grantBtn.hidden = true;
}

function setStatus(text: string): void {
  const statusContainer = $("#status-container");
  const statusText = $("#status-text");
  if (statusContainer) statusContainer.hidden = false;
  if (statusText) statusText.textContent = text;
}

async function run(): Promise<void> {
  const storage = (await chrome.storage.local.get(
    "pendingRecordingRequest"
  )) as {
    pendingRecordingRequest?: { tabId: number; options: RecordingOptions };
  };
  const pendingRecordingRequest = storage.pendingRecordingRequest;
  if (!pendingRecordingRequest?.tabId || !pendingRecordingRequest?.options) {
    setError("未找到待处理的录制请求，请重新在插件中发起。");
    return;
  }

  const tabId = pendingRecordingRequest.tabId;
  const options = pendingRecordingRequest.options;
  const grantBtn = $("#grant-btn");

  grantBtn.addEventListener("click", async () => {
    grantBtn.hidden = true;
    setStatus("请在浏览器提示框中选择“允许”…");

    try {
      const granted = await chrome.permissions
        .request({ origins: ["http://*/*", "https://*/*"] })
        .catch(() => false);

      if (!granted) {
        setError("未授予全站访问权限：无法开启录制。");
        await chrome.storage.local.remove("pendingRecordingRequest");
        return;
      }

      setStatus("已获授权，正在启动录制…");
      await chrome.storage.local.remove("pendingRecordingRequest");

      const response = await chrome.runtime.sendMessage(
        message("session/start", {
          tabId,
          options,
          commandId: crypto.randomUUID(),
        })
      );

      if (!response?.ok) {
        throw new Error(response?.error || "启动录制失败");
      }

      setStatus("录制已成功启动！正在关闭中转页…");
      setTimeout(() => {
        window.close();
      }, 600);
    } catch (err) {
      setError(String(err));
    }
  });
}

void run();
