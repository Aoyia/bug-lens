import { t } from "../../../shared/i18n";
import type { ExpectedStatement } from "../../../shared/protocol";

export type ExpectedCaptureCardDeps = {
  onSubmit(expected: ExpectedStatement): void;
  onSkip(): void;
};

const CHIP_KEYS = [
  "expectedChipCrash",
  "expectedChipWrongData",
  "expectedChipStyle",
  "expectedChipNoResponse",
  "expectedChipLoadFailed",
] as const;

/** 速记卡自动超时（D1：15s），超时未操作按"跳过"收起并标记 missing。 */
const AUTO_SKIP_TIMEOUT_MS = 15_000;

/**
 * 期望速记卡（Trigger-to-express）。
 * 用户点击"标记问题"后、进入元素选择前弹出，在记忆峰值捕获"预期应该发生什么"。
 * 确认 / 跳过均不阻断主流程；超时自动按跳过处理。
 */
export class ExpectedCaptureCard {
  private cardElement: HTMLDivElement | undefined;
  private inputElement: HTMLInputElement | undefined;
  private chipButtons: HTMLButtonElement[] = [];
  private selectedChips = new Set<string>();
  private autoSkipTimer: number | undefined;
  private keydownListener: ((e: KeyboardEvent) => void) | undefined;
  private submitted = false;

  constructor(private readonly deps: ExpectedCaptureCardDeps) {}

  get isOpen(): boolean {
    return Boolean(this.cardElement);
  }

  get element(): HTMLDivElement | undefined {
    return this.cardElement;
  }

  open(anchor?: { x: number; y: number }): void {
    if (this.cardElement) return;
    this.submitted = false;
    this.selectedChips.clear();

    const root = document.createElement("div");
    root.id = "__wbr_expected_card__";
    root.setAttribute("data-wbr-ignore", "true");
    Object.assign(root.style, {
      position: "fixed",
      top: "76px",
      left: "50%",
      transform: "translateX(-50%)",
      zIndex: "2147483645",
      width: "min(calc(100vw - 32px), 460px)",
      background: "rgba(255,255,255,0.97)",
      border: "1px solid #e5e6eb",
      borderRadius: "4px",
      boxShadow: "0 8px 30px rgba(0,0,0,0.18)",
      padding: "12px 14px",
      fontFamily:
        '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif',
      display: "flex",
      flexDirection: "column",
      gap: "10px",
      boxSizing: "border-box",
    });

    const title = document.createElement("div");
    title.textContent = t("expectedCardTitle");
    Object.assign(title.style, {
      fontSize: "13px",
      fontWeight: "600",
      color: "#1d2129",
    });

    const chipsRow = document.createElement("div");
    Object.assign(chipsRow.style, {
      display: "flex",
      flexWrap: "wrap",
      gap: "6px",
    });
    this.chipButtons = CHIP_KEYS.map((key) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.textContent = t(key);
      chip.setAttribute("data-expected-chip", key);
      this.applyChipStyle(chip, false);
      chip.addEventListener("click", (e) => {
        e.stopPropagation();
        this.toggleChip(chip, t(key));
      });
      chipsRow.appendChild(chip);
      return chip;
    });

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = t("expectedPlaceholder");
    input.setAttribute("data-expected-input", "true");
    Object.assign(input.style, {
      width: "100%",
      boxSizing: "border-box",
      height: "34px",
      padding: "0 10px",
      fontSize: "12px",
      fontFamily: "inherit",
      border: "1px solid #e5e6eb",
      borderRadius: "2px",
      background: "#f7f8fa",
      color: "#1d2129",
      outline: "none",
    });
    input.addEventListener("input", () => {
      // 用户手动编辑后，清除 chips 选中态（文本以输入框为准）
      if (this.selectedChips.size > 0) {
        this.selectedChips.clear();
        this.chipButtons.forEach((chip) => this.applyChipStyle(chip, false));
      }
      // 输入即视为活跃操作，重新武装超时，避免组织语言时卡片静默收起
      this.resetAutoSkipTimer();
    });
    input.addEventListener("focus", () => this.resetAutoSkipTimer());

    const actionsRow = document.createElement("div");
    Object.assign(actionsRow.style, {
      display: "flex",
      justifyContent: "flex-end",
      gap: "8px",
    });

    const skipBtn = document.createElement("button");
    skipBtn.type = "button";
    skipBtn.textContent = t("expectedSkip");
    skipBtn.setAttribute("data-expected-skip", "true");
    Object.assign(skipBtn.style, {
      height: "30px",
      padding: "0 12px",
      fontSize: "12px",
      fontWeight: "500",
      color: "#5f6b7c",
      background: "#ffffff",
      border: "1px solid #e5e6eb",
      borderRadius: "2px",
      cursor: "pointer",
    });
    skipBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.skip();
    });

    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.textContent = t("expectedConfirm");
    confirmBtn.setAttribute("data-expected-confirm", "true");
    Object.assign(confirmBtn.style, {
      height: "30px",
      padding: "0 16px",
      fontSize: "12px",
      fontWeight: "600",
      color: "#ffffff",
      background: "#165dff",
      border: "1px solid #165dff",
      borderRadius: "2px",
      cursor: "pointer",
    });
    confirmBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.submit();
    });

    actionsRow.append(skipBtn, confirmBtn);
    root.append(title, chipsRow, input, actionsRow);
    document.documentElement.appendChild(root);
    this.cardElement = root;
    this.inputElement = input;
    this.positionCard(anchor);

    setTimeout(() => input.focus(), 30);
    this.resetAutoSkipTimer();
    this.keydownListener = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        this.submit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        this.skip();
      }
    };
    window.addEventListener("keydown", this.keydownListener, true);
  }

  close(): void {
    if (this.autoSkipTimer !== undefined) {
      window.clearTimeout(this.autoSkipTimer);
      this.autoSkipTimer = undefined;
    }
    if (this.keydownListener) {
      window.removeEventListener("keydown", this.keydownListener, true);
      this.keydownListener = undefined;
    }
    this.cardElement?.remove();
    this.cardElement = undefined;
    this.inputElement = undefined;
  }

  // ─── Private ───

  /**
   * 就近定位：默认锚定鼠标右下方并做视口钳制，让卡片"从点击处长出来"。
   * 仅在锚点缺失（如快捷键触发）或视口放不下面板时，回退顶部居中。
   */
  private positionCard(anchor?: { x: number; y: number }): void {
    const root = this.cardElement;
    if (!root) return;
    const cardWidth = root.offsetWidth || 460;
    const cardHeight = root.offsetHeight || 180;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const canFit = cardWidth <= vw - 16 && cardHeight <= vh - 16;
    if (!anchor || !canFit) {
      Object.assign(root.style, {
        top: "76px",
        left: "50%",
        transform: "translateX(-50%)",
      });
      return;
    }
    const gap = 14;
    const left = Math.max(8, Math.min(vw - cardWidth - 8, anchor.x + gap));
    const top = Math.max(8, Math.min(vh - cardHeight - 8, anchor.y + gap));
    Object.assign(root.style, {
      top: `${top}px`,
      left: `${left}px`,
      transform: "none",
    });
  }

  private applyChipStyle(chip: HTMLButtonElement, active: boolean): void {
    Object.assign(chip.style, {
      height: "26px",
      padding: "0 10px",
      fontSize: "12px",
      fontWeight: "500",
      borderRadius: "999px",
      cursor: "pointer",
      background: active ? "#e8f1ff" : "#f7f8fa",
      color: active ? "#165dff" : "#4e5969",
      border: active ? "1px solid #165dff" : "1px solid #e5e6eb",
    });
  }

  private toggleChip(chip: HTMLButtonElement, label: string): void {
    if (this.selectedChips.has(label)) {
      this.selectedChips.delete(label);
      this.applyChipStyle(chip, false);
    } else {
      this.selectedChips.add(label);
      this.applyChipStyle(chip, true);
    }
    if (this.inputElement) {
      this.inputElement.value = [...this.selectedChips].join("；");
    }
    this.resetAutoSkipTimer();
  }

  private buildExpected(): ExpectedStatement | undefined {
    const text = this.inputElement?.value?.trim() ?? "";
    if (!text) return undefined;
    return {
      text,
      ...(this.selectedChips.size > 0 ? { tags: [...this.selectedChips] } : {}),
      confidence: "explicit",
    };
  }

  private submit(): void {
    if (this.submitted) return;
    this.submitted = true;
    const expected = this.buildExpected();
    this.close();
    if (expected) {
      this.deps.onSubmit(expected);
    } else {
      this.deps.onSkip();
    }
  }

  /**
   * 重新武装自动跳过计时器：用户在卡片上输入、聚焦或切换速记标签时调用，
   * 防止长时间停顿组织语言时卡片静默收起而丢失已输入内容。
   * 超时兜底：输入框已有内容则自动提交保留（不静默丢弃），为空才跳过。
   */
  private resetAutoSkipTimer(): void {
    if (this.cardElement == null || this.submitted) return;
    if (this.autoSkipTimer !== undefined) {
      window.clearTimeout(this.autoSkipTimer);
      this.autoSkipTimer = undefined;
    }
    this.autoSkipTimer = window.setTimeout(() => {
      this.autoSkipTimer = undefined;
      this.submit();
    }, AUTO_SKIP_TIMEOUT_MS);
  }

  private skip(): void {
    if (this.submitted) return;
    this.submitted = true;
    this.close();
    this.deps.onSkip();
  }
}
