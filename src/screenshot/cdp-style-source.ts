export interface RuleSourceInfo {
  selectorText: string;
  url?: string;
  startLine?: number;
  startColumn?: number;
}

export async function fetchStyleSourceInfoWithCDP(
  tabId: number,
  selectors: string[] = []
): Promise<RuleSourceInfo[]> {
  const sources: RuleSourceInfo[] = [];

  try {
    await chrome.debugger.attach({ tabId }, "1.3");
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
      for (const sel of selectors) {
        try {
          const queryRes = (await chrome.debugger.sendCommand(
            { tabId },
            "DOM.querySelector",
            {
              nodeId: rootNodeId,
              selector: sel,
            }
          )) as { nodeId: number };

          if (queryRes?.nodeId) {
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

            if (stylesRes?.matchedCSSRules) {
              for (const matched of stylesRes.matchedCSSRules) {
                const rule = matched.rule;
                if (rule.range) {
                  sources.push({
                    selectorText: rule.selectorList?.text || sel,
                    startLine: rule.range.startLine,
                    startColumn: rule.range.startColumn,
                  });
                }
              }
            }
          }
        } catch {
          // 单个 selector 定位失败静默忽略
        }
      }
    }

    await chrome.debugger.detach({ tabId });
  } catch {
    // CDP attach 失败或发生冲突时做静默降级处理，不抛出异常
    try {
      await chrome.debugger.detach({ tabId });
    } catch {
      // 忽略 detach 异常
    }
  }

  return sources;
}
