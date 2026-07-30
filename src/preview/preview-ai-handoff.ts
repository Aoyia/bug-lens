import type { ExportArtifact } from "../shared/protocol";
import { copyTextToClipboard } from "./clipboard";

export type PreviewAiHandoffOptions = {
  root: Document;
  getArtifact(): ExportArtifact | undefined;
  getPrompt(zipPath?: string): string;
  notify(message: string): void;
};

export class PreviewAiHandoff {
  constructor(private readonly options: PreviewAiHandoffOptions) {
    options.root.querySelector<HTMLButtonElement>("#copy-ai-prompt")?.addEventListener("click", () => void this.copyPrompt());
    options.root.querySelector<HTMLButtonElement>("#copy-ai-path")?.addEventListener("click", () => void this.copyPath());
    options.root.querySelector<HTMLButtonElement>("#show-ai-file")?.addEventListener("click", () => this.showFile());
  }

  render(): void {
    const artifact = this.options.getArtifact();
    const path = artifact?.filename;
    const complete = artifact?.state === "complete" && Boolean(path);
    const status = this.options.root.querySelector<HTMLElement>("#ai-status");
    if (status) status.textContent = complete
      ? "下载完成"
      : artifact?.state === "complete"
        ? "下载完成（路径不可用）"
        : artifact?.state === "in_progress"
          ? "正在下载"
          : artifact?.state === "interrupted"
            ? "下载中断"
            : "等待导出";
    const pathNode = this.options.root.querySelector<HTMLElement>("#ai-path");
    if (pathNode) pathNode.textContent = complete
      ? path!
      : artifact?.state === "complete"
        ? "Chrome 未返回绝对路径；可从下载列表定位文件。"
        : artifact?.error || "请先点击“导出离线报告”，完成下载后获取绝对路径。";
    const prompt = this.options.root.querySelector<HTMLElement>("#ai-prompt");
    if (prompt) prompt.textContent = this.options.getPrompt(path);
    const copyPath = this.options.root.querySelector<HTMLButtonElement>("#copy-ai-path");
    if (copyPath) copyPath.hidden = !complete;
    const showFile = this.options.root.querySelector<HTMLButtonElement>("#show-ai-file");
    if (showFile) showFile.hidden = !complete;
  }

  private async copyPrompt(): Promise<void> {
    await this.copy(this.options.getPrompt(this.options.getArtifact()?.filename), "AI 提示词已复制");
  }

  private async copyPath(): Promise<void> {
    const path = this.options.getArtifact()?.filename;
    if (path) await this.copy(path, "ZIP 绝对路径已复制");
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
      this.options.notify(`复制失败：${String(error)}`);
    }
  }
}
