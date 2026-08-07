import type {
  CascadeElementRef,
  CascadeIndex,
  CascadeInheritedRuleRef,
  CascadePropertySource,
  CascadeRuleSource,
  CascadeSheetSource,
  DomContextTreeV2,
} from "../domain/screenshot-payload";

const INHERITABLE_PROPERTIES = new Set([
  "line-height",
  "color",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "text-align",
  "letter-spacing",
  "visibility",
  "word-break",
  "cursor",
]);

export interface CollectCascadeOptions {
  domTree?: DomContextTreeV2;
  elements?: Element[];
  bounds?: { x: number; y: number; width: number; height: number };
}

export function collectCascadeIndex(
  options: CollectCascadeOptions = {}
): CascadeIndex {
  const sheets: CascadeSheetSource[] = [];
  const rules: CascadeRuleSource[] = [];
  const elements: CascadeElementRef[] = [];
  const perPropertyMap: Record<string, CascadePropertySource[]> = {};

  if (typeof document === "undefined") {
    return {
      sheets: [],
      rules: [],
      elements: [],
      perProperty: {},
      meta: {
        sheetCount: 0,
        ruleCount: 0,
        elementCount: 0,
        capturedAtEpochMs: Date.now(),
      },
    };
  }

  let sheetCounter = 0;
  let ruleCounter = 0;

  // 1. 遍历所有 styleSheets
  const styleSheetList = Array.from(document.styleSheets || []);
  for (const sheet of styleSheetList) {
    const sheetId = `s_${sheetCounter++}`;
    const ownerNode = sheet.ownerNode as HTMLElement | null;
    const isInline = ownerNode?.tagName?.toLowerCase() === "style";
    let rulesCount = 0;
    let cssRules: CSSRuleList | null = null;

    try {
      cssRules = sheet.cssRules;
      rulesCount = cssRules ? cssRules.length : 0;
    } catch {
      // 跨域样式表可能抛出 SecurityError，降级处理
      rulesCount = 0;
    }

    sheets.push({
      id: sheetId,
      href: sheet.href || undefined,
      ownerNodeTag: ownerNode?.tagName?.toLowerCase(),
      rulesCount,
      isInline,
    });

    if (!cssRules) continue;

    for (let i = 0; i < cssRules.length; i++) {
      const rule = cssRules[i];
      if (typeof CSSStyleRule !== "undefined" && rule instanceof CSSStyleRule) {
        const ruleId = `r_${ruleCounter++}`;
        const styleProps: Record<string, string> = {};
        for (let j = 0; j < rule.style.length; j++) {
          const propName = rule.style[j];
          styleProps[propName] = rule.style.getPropertyValue(propName);
        }

        rules.push({
          id: ruleId,
          sheetId,
          selectorText: rule.selectorText,
          cssText: rule.cssText,
          styleProps,
        });
      }
    }
  }

  // 2. 收集目标元素
  let targetElements: Element[] = [];
  if (options.elements && options.elements.length > 0) {
    targetElements = options.elements;
  } else if (options.domTree) {
    const selectors = [
      ...options.domTree.anchors.map((a) => a.selector),
      ...options.domTree.leaves.map((l) => l.selector),
    ];
    const uniqueSelectors = Array.from(new Set(selectors));
    for (const sel of uniqueSelectors) {
      try {
        const el = document.querySelector(sel);
        if (el) targetElements.push(el);
      } catch {
        // 忽略非法 selector
      }
    }
  }

  let elementCounter = 0;
  for (const el of targetElements) {
    const elId = `e_${elementCounter++}`;
    const matchedRuleIds: string[] = [];
    const tagName = el.tagName ? el.tagName.toLowerCase() : "";
    const selector = el.id
      ? `#${el.id}`
      : el.className && typeof el.className === "string"
        ? `.${el.className.split(" ").join(".")}`
        : tagName;

    // 匹配该元素的自身直属规则
    for (const r of rules) {
      try {
        if (el.matches && el.matches(r.selectorText)) {
          matchedRuleIds.push(r.id);

          // 收集按属性归纳来源
          for (const [prop, val] of Object.entries(r.styleProps)) {
            if (!perPropertyMap[prop]) {
              perPropertyMap[prop] = [];
            }
            perPropertyMap[prop].push({
              property: prop,
              value: val,
              sourceRuleId: r.id,
            });
          }
        }
      } catch {
        // 遇到伪类或不合法选择器时跳过
      }
    }

    // 向上遍历祖先节点，抓取 Inherited Rules (如 line-height: 40px 来自 div.el-form-item__content)
    const inheritedRules: CascadeInheritedRuleRef[] = [];
    let currParent = el.parentElement;
    while (
      currParent &&
      currParent !== document.body &&
      currParent !== document.documentElement
    ) {
      const parentTagName = currParent.tagName
        ? currParent.tagName.toLowerCase()
        : "";
      const parentSelector = currParent.id
        ? `#${currParent.id}`
        : currParent.className && typeof currParent.className === "string"
          ? `.${currParent.className.split(" ").join(".")}`
          : parentTagName;

      for (const r of rules) {
        try {
          if (currParent.matches && currParent.matches(r.selectorText)) {
            const inheritedProps: Record<string, string> = {};
            for (const [prop, val] of Object.entries(r.styleProps)) {
              if (INHERITABLE_PROPERTIES.has(prop.toLowerCase())) {
                inheritedProps[prop] = val;
                if (!perPropertyMap[prop]) {
                  perPropertyMap[prop] = [];
                }
                perPropertyMap[prop].push({
                  property: prop,
                  value: val,
                  sourceRuleId: r.id,
                  inheritedFromSelector: parentSelector,
                });
              }
            }
            if (Object.keys(inheritedProps).length > 0) {
              inheritedRules.push({
                ancestorSelector: parentSelector,
                ancestorTagName: parentTagName,
                ruleId: r.id,
                inheritedProps,
              });
            }
          }
        } catch {
          // 忽略
        }
      }
      currParent = currParent.parentElement;
    }

    // 检查内联样式 style="..."
    if (
      typeof HTMLElement !== "undefined" &&
      el instanceof HTMLElement &&
      el.style &&
      el.style.length > 0
    ) {
      for (let k = 0; k < el.style.length; k++) {
        const prop = el.style[k];
        const val = el.style.getPropertyValue(prop);
        if (!perPropertyMap[prop]) {
          perPropertyMap[prop] = [];
        }
        perPropertyMap[prop].push({
          property: prop,
          value: val,
          isInline: true,
        });
      }
    }

    elements.push({
      id: elId,
      selector,
      tagName,
      matchedRuleIds,
      inheritedRules: inheritedRules.length > 0 ? inheritedRules : undefined,
    });
  }

  return {
    sheets,
    rules,
    elements,
    perProperty: perPropertyMap,
    meta: {
      sheetCount: sheets.length,
      ruleCount: rules.length,
      elementCount: elements.length,
      capturedAtEpochMs: Date.now(),
    },
  };
}
