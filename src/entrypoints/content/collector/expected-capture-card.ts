import { t } from "../../../shared/i18n";
import type { ExpectedStatement } from "../../../shared/protocol";
import {
  attachContainerEventShield,
  attachFieldEventShield,
  installWindowFocusShield,
} from "../../../shared/dom/focus-shield";

export type ExpectedCaptureCardDeps = {
  /**
   * @param actual 实际现象（用户编辑后的草稿；未改动即预填草稿）
   * @param meta.auto 是否由超时兜底触发（用于告知用户"已帮你记了一句现象"）
   */
  onSubmit(
    expected: ExpectedStatement,
    actual: string,
    meta: { auto: boolean }
  ): void;
  /** 未形成期望陈述时：仍可能带上兜底的 actual 草稿 */
  onSkip(actual?: string, meta?: { auto: boolean }): void;
  /** 取消整条标记流程（Escape）：关闭卡片，不进入元素选择。 */
  onCancel(): void;
};

export type AnchorRectLike = {
  top: number;
  left: number;
  width: number;
  height: number;
};

export type CardViewport = { width: number; height: number };
export type CardSize = { width: number; height: number };
export type CardPlacement = "below" | "above";

export const CARD_ANCHOR_GAP_PX = 16;
export const CARD_VIEWPORT_MARGIN_PX = 16;
/** 卡片与选区之间额外保留的安全距离，避免贴边遮挡 */
const CARD_ANCHOR_CLEARANCE_PX = 24;

export type CardPosition = {
  top: number;
  left: number;
  placement: CardPlacement;
};

/**
 * 纯函数定位：以选区锚点框为基准，优先贴在下方（底部 + 16px）；
 * 下方放不下（底部剩余空间 < 卡片高度 + 24px）翻到上方；水平与锚点左边缘对齐，
 * 并做视口钳制（左右各留 16px）。上下同样钳制，保证卡片始终完整可见。
 */
export function computeCardPosition(
  anchor: AnchorRectLike,
  viewport: CardViewport,
  card: CardSize
): CardPosition {
  const margin = CARD_VIEWPORT_MARGIN_PX;
  const belowTop = anchor.top + anchor.height + CARD_ANCHOR_GAP_PX;
  const aboveTop = anchor.top - card.height - CARD_ANCHOR_GAP_PX;
  const fitsBelow =
    belowTop + card.height + CARD_ANCHOR_CLEARANCE_PX <= viewport.height;

  let placement: CardPlacement = fitsBelow ? "below" : "above";
  let top = fitsBelow ? belowTop : aboveTop;

  if (!fitsBelow && top < margin) {
    // 上下都放不下（极矮视口）：退到剩余空间更大的一侧，仍钳制在视口内
    const spaceBelow = viewport.height - (anchor.top + anchor.height);
    const spaceAbove = anchor.top;
    top = spaceBelow >= spaceAbove ? belowTop : aboveTop;
    placement = spaceBelow >= spaceAbove ? "below" : "above";
  }

  const maxTop = Math.max(margin, viewport.height - card.height - margin);
  const maxLeft = Math.max(margin, viewport.width - card.width - margin);

  return {
    top: Math.min(Math.max(top, margin), maxTop),
    left: Math.min(Math.max(anchor.left, margin), maxLeft),
    placement,
  };
}

const CHIP_KEYS = [
  "expectedChipCrash",
  "expectedChipWrongData",
  "expectedChipStyle",
  "expectedChipNoResponse",
  "expectedChipLoadFailed",
] as const;

/** 速记卡自动超时（D1：15s），超时未操作按"跳过"收起并标记 missing。 */
const AUTO_SKIP_TIMEOUT_MS = 15_000;

export function getAutoSkipRemainingSeconds(
  deadlineEpochMs: number,
  nowEpochMs = Date.now()
): number {
  return Math.max(0, Math.ceil((deadlineEpochMs - nowEpochMs) / 1000));
}

/**
 * 期望速记卡（Trigger-to-express）。
 * 用户点击"标记问题"后、进入元素选择前弹出，在记忆峰值捕获"预期应该发生什么"。
 * 确认 / 跳过均不阻断主流程；超时自动按跳过处理。
 */
export class ExpectedCaptureCard {
  private cardElement: HTMLDivElement | undefined;
  private inputElement: HTMLInputElement | undefined;
  private actualElement: HTMLTextAreaElement | undefined;
  private actualDraft = "";
  /** 用户是否动过 actual（输入或主动清空）：未动 = 提交时回填草稿 */
  private actualTouched = false;
  private chipButtons: HTMLButtonElement[] = [];
  private selectedChips = new Set<string>();
  private autoSkipTimer: number | undefined;
  private autoSkipDeadlineEpochMs: number | undefined;
  private countdownInterval: number | undefined;
  private countdownElement: HTMLDivElement | undefined;
  private keydownListener: ((e: KeyboardEvent) => void) | undefined;
  private removeFocusShield: (() => void) | undefined;
  private submitted = false;

  constructor(private readonly deps: ExpectedCaptureCardDeps) {}

  get isOpen(): boolean {
    return Boolean(this.cardElement);
  }

  get element(): HTMLDivElement | undefined {
    return this.cardElement;
  }

  /**
   * @param anchor 触发"标记问题"的指针位置（无元素锚点时的兜底）
   * @param context.anchorRect 选区锚点框（标记元素的视口 rect）
   * @param context.draft 本地规则预填的 actual 草稿
   */
  open(
    anchor?: { x: number; y: number },
    context?: { anchorRect?: AnchorRectLike; draft?: string }
  ): void {
    if (this.cardElement) return;
    this.submitted = false;
    this.selectedChips.clear();
    this.actualTouched = false;
    this.actualDraft = context?.draft ?? "";

    const root = document.createElement("div");
    root.id = "__wbr_expected_card__";
    root.setAttribute("data-wbr-ignore", "true");
    Object.assign(root.style, {
      position: "fixed",
      top: "0px",
      left: "0px",
      visibility: "hidden",
      zIndex: "2147483647",
      width: "min(calc(100vw - 32px), 460px)",
      background: "rgba(255,255,255,0.98)",
      border: "1px solid #e5e6eb",
      borderRadius: "8px",
      boxShadow: "0 12px 36px rgba(0,0,0,0.22), 0 0 0 1px rgba(0,0,0,0.04)",
      padding: "14px 16px",
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

    const countdown = document.createElement("div");
    countdown.setAttribute("data-expected-countdown", "true");
    Object.assign(countdown.style, {
      color: "#86909c",
      fontSize: "11px",
      lineHeight: "1.2",
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
      pointerEvents: "auto",
      userSelect: "text",
      cursor: "text",
      caretColor: "#165dff",
    });
    input.addEventListener("input", (e) => {
      e.stopPropagation?.();
      // 输入即视为活跃操作，重新武装超时，避免组织语言时卡片静默收起；不清除已勾选症状标签
      this.resetAutoSkipTimer();
    });
    attachFieldEventShield(input, {
      onFocusOrPointer: () => this.resetAutoSkipTimer(),
    });

    const actualInput = document.createElement("textarea");
    actualInput.setAttribute("data-expected-actual", "true");
    actualInput.rows = 2;
    actualInput.placeholder = t("expectedActualPlaceholder");
    actualInput.value = this.actualDraft;
    Object.assign(actualInput.style, {
      width: "100%",
      boxSizing: "border-box",
      minHeight: "46px",
      padding: "6px 10px",
      fontSize: "12px",
      lineHeight: "1.5",
      fontFamily: "inherit",
      border: "1px solid #e5e6eb",
      borderRadius: "2px",
      background: "#f7f8fa",
      color: "#1d2129",
      outline: "none",
      resize: "none",
      pointerEvents: "auto",
      userSelect: "text",
      cursor: "text",
      caretColor: "#165dff",
    });
    actualInput.addEventListener("input", (e) => {
      e.stopPropagation?.();
      this.actualTouched = true;
      this.resetAutoSkipTimer();
    });
    attachFieldEventShield(actualInput, {
      onFocusOrPointer: () => this.resetAutoSkipTimer(),
    });

    const clearActualBtn = document.createElement("button");
    clearActualBtn.type = "button";
    clearActualBtn.textContent = t("expectedActualClear");
    clearActualBtn.setAttribute("data-expected-actual-clear", "true");
    Object.assign(clearActualBtn.style, {
      height: "20px",
      padding: "0 6px",
      fontSize: "11px",
      fontWeight: "500",
      color: "#5f6b7c",
      background: "transparent",
      border: "1px solid #e5e6eb",
      borderRadius: "2px",
      cursor: "pointer",
      lineHeight: "1",
    });
    clearActualBtn.addEventListener("click", (e) => {
      e.stopPropagation?.();
      actualInput.value = "";
      this.actualTouched = true;
      actualInput.focus();
      this.resetAutoSkipTimer();
    });

    const actualLabelRow = document.createElement("div");
    Object.assign(actualLabelRow.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "8px",
    });
    const actualLabel = document.createElement("span");
    actualLabel.textContent = t("expectedActualLabel");
    actualLabel.setAttribute("data-expected-actual-label", "true");
    Object.assign(actualLabel.style, {
      fontSize: "11px",
      fontWeight: "500",
      color: "#86909c",
    });
    actualLabelRow.append(actualLabel, clearActualBtn);

    const actualBlock = document.createElement("div");
    Object.assign(actualBlock.style, {
      display: "flex",
      flexDirection: "column",
      gap: "4px",
    });
    actualBlock.append(actualLabelRow, actualInput);

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
      e.stopPropagation?.();
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
      e.stopPropagation?.();
      this.submit();
    });

    actionsRow.append(skipBtn, confirmBtn);
    root.append(title, countdown, chipsRow, input, actualBlock, actionsRow);

    // 卡片整体事件屏障与焦点防劫持
    attachContainerEventShield(root);
    this.removeFocusShield = installWindowFocusShield({
      root,
      isOpen: () => this.isOpen,
      getActiveField: () => {
        const active = document.activeElement;
        if (this.actualElement && active === this.actualElement) {
          return this.actualElement;
        }
        return input;
      },
    });

    document.documentElement.appendChild(root);
    this.cardElement = root;
    this.inputElement = input;
    this.actualElement = actualInput;
    this.countdownElement = countdown;
    this.positionCard(anchor, context?.anchorRect);

    setTimeout(() => input.focus(), 30);
    this.resetAutoSkipTimer();
    this.keydownListener = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        this.submit();
      } else if (e.key === "Escape") {
        // Escape 语义与流程内其余模态保持一致（选择遮罩 / 问题编辑器均为
        // Escape = 取消）：在这里是取消整条标记流程，而不是"跳过并进入
        // 元素选择"——否则误触标记入口的用户会被推入更侵入式的选择遮罩，
        // 且速记卡将是流程中唯一没有取消通道的模态。
        e.preventDefault();
        e.stopPropagation();
        this.cancel();
      }
    };
    window.addEventListener("keydown", this.keydownListener, true);
  }

  close(): void {
    this.clearAutoSkipTimer();
    if (this.keydownListener) {
      window.removeEventListener("keydown", this.keydownListener, true);
      this.keydownListener = undefined;
    }
    if (this.removeFocusShield) {
      this.removeFocusShield();
      this.removeFocusShield = undefined;
    }
    this.cardElement?.remove();
    this.cardElement = undefined;
    this.inputElement = undefined;
    this.actualElement = undefined;
    this.countdownElement = undefined;
  }

  // ─── Private ───

  /**
   * 跟着选区走：以锚点框为基准定位（下方优先、空间不足翻上方、左右钳制），
   * 无锚点框时退化为"触发点下方 16px"，仍然做边界钳制。定位本身交给纯函数
   * `computeCardPosition`，这里只负责测量卡片实际尺寸。
   */
  private positionCard(
    anchor?: { x: number; y: number },
    anchorRect?: AnchorRectLike
  ): void {
    const root = this.cardElement;
    if (!root) return;

    const viewport: CardViewport = {
      width: Math.max(1, window.innerWidth || 0),
      height: Math.max(1, window.innerHeight || 0),
    };
    const anchorBox: AnchorRectLike = anchorRect ?? {
      top: anchor?.y ?? 0,
      left: anchor?.x ?? 0,
      width: 0,
      height: 0,
    };

    const measured =
      typeof root.getBoundingClientRect === "function"
        ? root.getBoundingClientRect()
        : undefined;
    const card: CardSize = {
      width:
        measured && measured.width > 0
          ? measured.width
          : Math.min(460, Math.max(1, viewport.width - 32)),
      height: measured && measured.height > 0 ? measured.height : 260,
    };

    const { top, left } = computeCardPosition(anchorBox, viewport, card);
    Object.assign(root.style, {
      top: `${Math.round(top)}px`,
      left: `${Math.round(left)}px`,
      visibility: "visible",
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
    this.resetAutoSkipTimer();
  }

  private buildExpected(): ExpectedStatement | undefined {
    const text = this.inputElement?.value?.trim() ?? "";
    const tags = [...this.selectedChips];
    if (!text && tags.length === 0) return undefined;
    if (!text) {
      return {
        text: "",
        tags,
        confidence: "tag-only",
      };
    }
    return {
      text,
      ...(tags.length > 0 ? { tags } : {}),
      confidence: "explicit",
    };
  }

  /**
   * 实际现象取值：用户动过（含主动清空）就用输入框内容，否则用预填草稿。
   * 清空是显式意图，此时返回空串而不是回填草稿。
   */
  private readActual(): string {
    if (!this.actualElement) return this.actualDraft;
    if (!this.actualTouched) return this.actualDraft;
    return this.actualElement.value?.trim() ?? "";
  }

  /**
   * 提交：期望走原有 explicit/tag-only 语义，actual 独立携带。
   * 无期望陈述时不伪造 ExpectedStatement（草稿绝不升格为预期）。
   */
  private submit(meta: { auto?: boolean } = {}): void {
    if (this.submitted) return;
    this.submitted = true;
    const expected = this.buildExpected();
    const actual = this.readActual();
    this.close();
    const auto = meta.auto === true;
    if (expected) {
      this.deps.onSubmit(expected, actual, { auto });
    } else {
      this.deps.onSkip(actual || undefined, { auto });
    }
  }

  /**
   * 重新武装自动跳过计时器：用户在卡片上输入、聚焦或切换速记标签时调用，
   * 防止长时间停顿组织语言时卡片静默收起而丢失已输入内容。
   * 超时兜底：actual 取预填草稿（用户改过就用改过的），期望照旧走 buildExpected，
   * 因此超时不会丢现象，也不会把草稿冒充成"预期"。
   */
  private resetAutoSkipTimer(): void {
    if (this.cardElement == null || this.submitted) return;
    this.clearAutoSkipTimer();
    this.autoSkipDeadlineEpochMs = Date.now() + AUTO_SKIP_TIMEOUT_MS;
    this.updateAutoSkipCountdown();
    this.countdownInterval = window.setInterval(
      () => this.updateAutoSkipCountdown(),
      250
    );
    this.autoSkipTimer = window.setTimeout(() => {
      this.autoSkipTimer = undefined;
      // 超时不丢数据：actual 用草稿兜底落盘，expected 仍按用户输入走原逻辑
      this.submit({ auto: true });
    }, AUTO_SKIP_TIMEOUT_MS);
  }

  private clearAutoSkipTimer(): void {
    if (this.autoSkipTimer !== undefined) {
      window.clearTimeout(this.autoSkipTimer);
      this.autoSkipTimer = undefined;
    }
    if (this.countdownInterval !== undefined) {
      window.clearInterval(this.countdownInterval);
      this.countdownInterval = undefined;
    }
    this.autoSkipDeadlineEpochMs = undefined;
  }

  private updateAutoSkipCountdown(): void {
    if (this.countdownElement == null || this.autoSkipDeadlineEpochMs == null)
      return;
    this.countdownElement.textContent = t("expectedAutoSkipCountdown", [
      String(getAutoSkipRemainingSeconds(this.autoSkipDeadlineEpochMs)),
    ]);
  }

  /**
   * 跳过：不产出 expected（语义仍为 missing），但 actual 与超时路径一致地带上
   * 草稿（用户改过就用改过的）——"不想填预期"不等于"不想记录现象"。
   */
  private skip(): void {
    if (this.submitted) return;
    this.submitted = true;
    const actual = this.readActual();
    this.close();
    this.deps.onSkip(actual || undefined, { auto: false });
  }

  /** 取消整条标记流程：与 skip() 对称，但回调 onCancel 而非 onSkip。 */
  private cancel(): void {
    if (this.submitted) return;
    this.submitted = true;
    this.close();
    this.deps.onCancel();
  }
}
