import type { ExportArtifact } from "../shared/protocol";
import { copyTextToClipboard } from "./clipboard";
import { t } from "../shared/i18n.ts";

export type PreviewAiHandoffOptions = {
  root: Document;
  getArtifact(): ExportArtifact | undefined;
  getPrompt(zipPath?: string): string;
  notify(message: string): void;
};

export class PreviewAiHandoff {
  constructor(private readonly options: PreviewAiHandoffOptions) {
    options.root
      .querySelector<HTMLButtonElement>("#copy-ai-prompt")
      ?.addEventListener("click", () => void this.copyPrompt());
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
      t("promptCopied")
    );
  }

  async copyPath(): Promise<void> {
    const path = this.options.getArtifact()?.filename;
    if (!path) return;
    await this.copy(path, t("pathCopied"));
  }

  async autoCopyPrompt(): Promise<boolean> {
    const path = this.options.getArtifact()?.filename;
    if (!path) return false;
    try {
      await copyTextToClipboard(
        this.options.getPrompt(path),
        this.options.root
      );
      this.options.notify(t("autoCopiedPrompt"));
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
