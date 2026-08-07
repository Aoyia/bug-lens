import { message } from "../shared/protocol.ts";
import type { FrameworkProbeEntry } from "../shared/protocol.ts";

const PROBE_ATTR = "data-bug-lens-probe-id";

/** 生成带随机前缀的探针 ID，避免与页面元素已有的同名属性冲突 */
function probeIdOf(idx: number): string {
  return `blp-${Date.now().toString(36)}-${idx}`;
}

/**
 * Content script 侧主世界探针封装：
 * 1. 为候选元素打上 data-bug-lens-probe-id 标记；
 * 2. 请求 background 以 executeScript({ world: "MAIN" }) 注入探针到页面主世界，
 *    读取 Vue/React 组件链（隔离世界读不到 __vue__/__reactFiber$ 等 expando 属性）；
 * 3. 合并结果并清理标记。
 * 任一环节失败均静默降级为空 Map（组件字段缺省），不影响截图主流程。
 */
export async function probeFrameworkComponents(
  elements: Element[],
  sendMessage: (msg: unknown) => Promise<unknown> = (m) =>
    chrome.runtime.sendMessage(m)
): Promise<Map<Element, FrameworkProbeEntry>> {
  const result = new Map<Element, FrameworkProbeEntry>();
  if (elements.length === 0) return result;

  const ids: string[] = elements.map((el, idx) => {
    const id = probeIdOf(idx);
    el.setAttribute(PROBE_ATTR, id);
    return id;
  });

  try {
    const response = (await sendMessage(
      message("screenshot/framework-probe", { probeIds: ids })
    )) as {
      ok?: boolean;
      results?: Record<string, FrameworkProbeEntry | null>;
    };
    if (response?.ok && response.results) {
      for (let i = 0; i < elements.length; i++) {
        const entry = response.results[ids[i]];
        if (entry) result.set(elements[i], entry);
      }
    }
  } catch {
    // 探针失败（无 host 权限/受限页面等）静默降级，保持截图流程不受影响
  } finally {
    for (const el of elements) el.removeAttribute(PROBE_ATTR);
  }
  return result;
}
