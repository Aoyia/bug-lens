import { message, type RecordingOptions } from "../../shared/protocol";
import { applyI18n, getLocale, t } from "../../shared/i18n";

applyI18n();
document.documentElement.lang = getLocale();

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
    setError(t("permissionErrorNoPendingRequest"));
    return;
  }

  const tabId = pendingRecordingRequest.tabId;
  const options = pendingRecordingRequest.options;
  const grantBtn = $("#grant-btn");

  grantBtn.addEventListener("click", async () => {
    grantBtn.hidden = true;
    setStatus(t("permissionStatusPromptSelectAllow"));

    try {
      const granted = await chrome.permissions
        .request({ origins: ["http://*/*", "https://*/*"] })
        .catch(() => false);

      if (!granted) {
        setError(t("permissionErrorNoAccess"));
        await chrome.storage.local.remove("pendingRecordingRequest");
        return;
      }

      setStatus(t("permissionStatusGrantedStarting"));
      await chrome.storage.local.remove("pendingRecordingRequest");

      const response = await chrome.runtime.sendMessage(
        message(
          "session/start",
          {
            tabId,
            options,
            commandId: crypto.randomUUID(),
          },
          undefined,
          "background"
        )
      );

      if (!response?.ok) {
        throw new Error(response?.error || t("permissionErrorStartFailed"));
      }

      setStatus(t("permissionStatusRecordingStartedClosing"));
      setTimeout(() => {
        window.close();
      }, 600);
    } catch (err) {
      setError(String(err));
    }
  });
}

void run();
