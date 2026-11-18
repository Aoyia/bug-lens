import { isWidgetElement } from "./dom-snapshot";

export interface DomSettledResult {
  settled: boolean;
  reason: "dom-quiet" | "idle-window" | "timeout" | "no-dom";
  mutationCount: number;
  elapsedMs: number;
}

export interface WaitDomSettledOptions {
  quietWindowMs?: number;
  maxWaitMs?: number;
  root?: Node;
}

function isIgnoredMutationTarget(node: Node | null): boolean {
  if (!node) return false;
  const el = node instanceof Element ? node : node.parentElement;
  if (!el) return false;
  if (isWidgetElement(el)) return true;
  if (el.closest("#__wbr_expected_card__")) return true;
  return false;
}

/**
 * 监听页面 DOM Mutation 进入连续静默期（默认 150ms 无有效变更，上限 maxWaitMs）。
 * 自动过滤 Bug Lens 自身挂件节点（计时器更新等），避免扩展 UI 干扰判定。
 */
export function waitForDomSettled(
  options: WaitDomSettledOptions = {}
): Promise<DomSettledResult> {
  const quietWindowMs = Math.max(40, options.quietWindowMs ?? 150);
  const maxWaitMs = Math.max(quietWindowMs, options.maxWaitMs ?? 1100);
  const targetRoot =
    options.root ??
    (typeof document !== "undefined" ? document.documentElement : undefined);

  if (!targetRoot || typeof MutationObserver === "undefined") {
    return Promise.resolve({
      settled: true,
      reason: "no-dom",
      mutationCount: 0,
      elapsedMs: 0,
    });
  }

  const startedAt = Date.now();
  return new Promise<DomSettledResult>((resolve) => {
    let mutationCount = 0;
    let settled = false;
    let quietTimer: ReturnType<typeof setTimeout> | undefined;
    let maxTimer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = (reason: DomSettledResult["reason"]): void => {
      if (settled) return;
      settled = true;
      if (quietTimer !== undefined) clearTimeout(quietTimer);
      if (maxTimer !== undefined) clearTimeout(maxTimer);
      observer.disconnect();
      resolve({
        settled: true,
        reason,
        mutationCount,
        elapsedMs: Math.max(0, Date.now() - startedAt),
      });
    };

    const armQuietTimer = (): void => {
      if (quietTimer !== undefined) clearTimeout(quietTimer);
      quietTimer = setTimeout(() => {
        cleanup(mutationCount > 0 ? "dom-quiet" : "idle-window");
      }, quietWindowMs);
    };

    const observer = new MutationObserver((records) => {
      const hasAppMutation = records.some((rec) => {
        if (!isIgnoredMutationTarget(rec.target)) return true;
        return false;
      });
      if (!hasAppMutation) return;
      mutationCount += 1;
      armQuietTimer();
    });

    try {
      observer.observe(targetRoot, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });
    } catch {
      cleanup("no-dom");
      return;
    }

    armQuietTimer();
    maxTimer = setTimeout(() => cleanup("timeout"), maxWaitMs);
  });
}
