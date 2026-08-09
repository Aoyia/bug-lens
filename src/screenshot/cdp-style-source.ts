export interface RuleSourceInfo {
  selectorText: string;
  url?: string;
  startLine?: number;
  startColumn?: number;
}

export async function isTabAlreadyAttached(tabId: number): Promise<boolean> {
  try {
    if (
      typeof chrome === "undefined" ||
      !chrome.debugger ||
      !chrome.debugger.getTargets
    ) {
      return false;
    }
    const targets = await chrome.debugger.getTargets();
    const target = targets.find((t) => t.tabId === tabId);
    return Boolean(target?.attached);
  } catch {
    return false;
  }
}

export async function fetchStyleSourceInfoWithCDP(
  tabId: number,
  selectors: string[] = []
): Promise<RuleSourceInfo[]> {
  if (!selectors.length) return [];
  const sources: RuleSourceInfo[] = [];
  const alreadyAttached = await isTabAlreadyAttached(tabId);

  try {
    if (!alreadyAttached) {
      await chrome.debugger.attach({ tabId }, "1.3");
    }
    await chrome.debugger.sendCommand({ tabId }, "DOM.enable");
    await chrome.debugger.sendCommand({ tabId }, "CSS.enable");

    // 获取根节点
    const docRes = (await chrome.debugger.sendCommand(
      { tabId },
      "DOM.getDocument",
      {}
    )) as {
      root: { nodeId: number };
    };
    const rootNodeId = docRes?.root?.nodeId;

    if (rootNodeId) {
      const queryTasks = selectors.map(async (sel) => {
        try {
          const queryRes = (await chrome.debugger.sendCommand(
            { tabId },
            "DOM.querySelector",
            {
              nodeId: rootNodeId,
              selector: sel,
            }
          )) as { nodeId: number };

          if (!queryRes?.nodeId) return [];

          const stylesRes = (await chrome.debugger.sendCommand(
            { tabId },
            "CSS.getMatchedStylesForNode",
            { nodeId: queryRes.nodeId }
          )) as {
            matchedCSSRules?: Array<{
              rule: {
                selectorList: { text: string };
                styleSheetId?: string;
                origin?: string;
                range?: { startLine: number; startColumn: number };
              };
            }>;
          };

          const matchedList: RuleSourceInfo[] = [];
          if (stylesRes?.matchedCSSRules) {
            for (const matched of stylesRes.matchedCSSRules) {
              const rule = matched.rule;
              if (rule.range) {
                matchedList.push({
                  selectorText: rule.selectorList?.text || sel,
                  startLine: rule.range.startLine,
                  startColumn: rule.range.startColumn,
                });
              }
            }
          }
          return matchedList;
        } catch {
          return [];
        }
      });

      const results = await Promise.all(queryTasks);
      for (const resList of results) {
        sources.push(...resList);
      }
    }
  } catch {
    // CDP attach 失败或发生冲突时做静默降级处理，不抛出异常
  } finally {
    if (!alreadyAttached) {
      try {
        await chrome.debugger.detach({ tabId });
      } catch {
        // 忽略 detach 异常
      }
    }
  }

  return sources;
}
