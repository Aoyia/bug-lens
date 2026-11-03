import type { ExportArtifact } from "../shared/protocol";
import { copyTextToClipboard, copyRichTextToClipboard } from "./clipboard";
import { incrementPromptCopyCount } from "../diagnostics/diagnostics-store";
import { t } from "../shared/i18n.ts";

export type PreviewAiHandoffOptions = {
  root: Document;
  getArtifact(): ExportArtifact | undefined;
  getPrompt(zipPath?: string): string;
  getTicketTemplate?(zipPath?: string): string;
  getTicketBundle?(zipPath?: string): { markdown: string; html: string };
  notify(message: string): void;
};

export class PreviewAiHandoff {
  constructor(private readonly options: PreviewAiHandoffOptions) {
    options.root
      .querySelector<HTMLButtonElement>("#copy-ai-prompt")
      ?.addEventListener("click", () => void this.copyPrompt());
    options.root
      .querySelector<HTMLButtonElement>("#copy-ticket-template")
      ?.addEventListener("click", () => void this.copyTicketTemplate());
    options.root
      .querySelector<HTMLButtonElement>("#copy-ai-path")
      ?.addEventListener("click", () => void this.copyPath());
    options.root
      .querySelector<HTMLButtonElement>("#show-ai-file")
      ?.addEventListener("click", () => this.showFile());
  }

  render(): void {
    const artifact = this.options.getArtifact();
    const path = artifact?.filename;
    const complete = artifact?.state === "complete" && Boolean(path);
    const status = this.options.root.querySelector<HTMLElement>("#ai-status");
    if (status)
      status.textContent = complete
        ? t("downloadComplete")
        : artifact?.state === "complete"
          ? t("downloadCompleteNoPath")
          : artifact?.state === "in_progress"
            ? t("downloading")
            : artifact?.state === "interrupted"
              ? t("downloadInterrupted")
              : t("waitForEvidenceLoad");
    const pathNode = this.options.root.querySelector<HTMLElement>("#ai-path");
    if (pathNode)
      pathNode.textContent = complete
        ? path!
        : artifact?.state === "complete"
          ? t("downloadNoAbsolutePath")
          : artifact?.error || t("exportBeforeCopyPath");
    const prompt = this.options.root.querySelector<HTMLElement>("#ai-prompt");
    if (prompt) prompt.textContent = this.options.getPrompt(path);
    const copyPath =
      this.options.root.querySelector<HTMLButtonElement>("#copy-ai-path");
    if (copyPath) copyPath.hidden = !complete;
    const showFile =
      this.options.root.querySelector<HTMLButtonElement>("#show-ai-file");
    if (showFile) showFile.hidden = !complete;
  }

  async copyPrompt(): Promise<void> {
    await this.copy(
      this.options.getPrompt(this.options.getArtifact()?.filename),
      t("aiPromptCopied")
    );
    void incrementPromptCopyCount().catch(() => undefined);
  }

  async copyTicketTemplate(): Promise<void> {
    const filename = this.options.getArtifact()?.filename;
    const bundle = this.options.getTicketBundle?.(filename);
    if (bundle) {
      try {
        await copyRichTextToClipboard(
          { html: bundle.html, text: bundle.markdown },
          this.options.root
        );
        this.options.notify(t("ticketTemplateCopied"));
        return;
      } catch (error) {
        this.options.notify(t("copyFailed", String(error)));
        return;
      }
    }
    const template = this.options.getTicketTemplate?.(filename);
    if (!template) return;
    await this.copy(template, t("ticketTemplateCopied"));
  }

  async copyPath(): Promise<void> {
    const path = this.options.getArtifact()?.filename;
    if (!path) return;
    await this.copy(path, t("zipPathCopied"));
  }

  async autoCopyPrompt(): Promise<boolean> {
    const path = this.options.getArtifact()?.filename;
    if (!path) return false;
    try {
      await copyTextToClipboard(
        this.options.getPrompt(path),
        this.options.root
      );
      this.options.notify(t("exportSuccessCopied"));
      void incrementPromptCopyCount().catch(() => undefined);
      return true;
    } catch {
      return false;
    }
  }

  async autoCopyTicketTemplate(silent = false): Promise<boolean> {
    const filename = this.options.getArtifact()?.filename;
    const bundle = this.options.getTicketBundle?.(filename);
    if (bundle) {
      try {
        await copyRichTextToClipboard(
          { html: bundle.html, text: bundle.markdown },
          this.options.root
        );
        if (!silent) this.options.notify(t("exportSuccessTicketCopied"));
        return true;
      } catch {
        // 回退到纯文本方式
      }
    }
    const template = this.options.getTicketTemplate?.(filename);
    if (!template) return false;
    try {
      await copyTextToClipboard(template, this.options.root);
      if (!silent) this.options.notify(t("exportSuccessTicketCopied"));
      return true;
    } catch {
      return false;
    }
  }

  private showFile(): void {
    const artifact = this.options.getArtifact();
    if (artifact) chrome.downloads.show(artifact.downloadId);
  }

  private async copy(value: string, successMessage: string): Promise<void> {
    try {
      await copyTextToClipboard(value, this.options.root);
      this.options.notify(successMessage);
    } catch (error) {
      this.options.notify(t("copyFailed", String(error)));
    }
  }
}
