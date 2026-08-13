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

interface RuleIndexBucket {
  byClass: Map<string, CascadeRuleSource[]>;
  byId: Map<string, CascadeRuleSource[]>;
  byTag: Map<string, CascadeRuleSource[]>;
  universal: CascadeRuleSource[];
  // 专门用于祖先节点查找的桶（规则中包含 INHERITABLE_PROPERTIES 属性）
  inheritableByClass: Map<string, CascadeRuleSource[]>;
  inheritableById: Map<string, CascadeRuleSource[]>;
  inheritableByTag: Map<string, CascadeRuleSource[]>;
  inheritableUniversal: CascadeRuleSource[];
}

function extractKeySelector(selectorText: string): string {
  // 处理 CSS 选择器组 (逗号分割)，针对每个选择器取 key 选择器
  const selectors = selectorText.split(",");
  const keys: string[] = [];
  for (let i = 0; i < selectors.length; i++) {
    const parts = selectors[i].trim().split(/[\s>+~]+/);
    const lastPart = parts[parts.length - 1] || selectors[i];
    keys.push(lastPart.split(":")[0]);
  }
  return keys.join(" ");
}

function buildRuleBucket(rules: CascadeRuleSource[]): RuleIndexBucket {
  const bucket: RuleIndexBucket = {
    byClass: new Map(),
    byId: new Map(),
    byTag: new Map(),
    universal: [],
    inheritableByClass: new Map(),
    inheritableById: new Map(),
    inheritableByTag: new Map(),
    inheritableUniversal: [],
  };

  const addToMap = (
    map: Map<string, CascadeRuleSource[]>,
    key: string,
    rule: CascadeRuleSource
  ) => {
    let list = map.get(key);
    if (!list) {
      list = [];
      map.set(key, list);
    }
    list.push(rule);
  };

  for (const rule of rules) {
    let hasInheritable = false;
    for (const propName of Object.keys(rule.styleProps)) {
      if (INHERITABLE_PROPERTIES.has(propName.toLowerCase())) {
        hasInheritable = true;
        break;
      }
    }

    const keySel = extractKeySelector(rule.selectorText);
    const idMatch = keySel.match(/#([\w-]+)/);
    const classMatches = keySel.match(/\.([\w-]+)/g);
    const tagMatch = keySel.match(/^[a-zA-Z0-9]+/);

    let indexed = false;
    if (idMatch) {
      const id = idMatch[1];
      addToMap(bucket.byId, id, rule);
      if (hasInheritable) addToMap(bucket.inheritableById, id, rule);
      indexed = true;
    }
    if (classMatches) {
      for (const cls of classMatches) {
        const className = cls.slice(1);
        addToMap(bucket.byClass, className, rule);
        if (hasInheritable)
          addToMap(bucket.inheritableByClass, className, rule);
      }
      indexed = true;
    }
    if (tagMatch) {
      const tag = tagMatch[0].toLowerCase();
      addToMap(bucket.byTag, tag, rule);
      if (hasInheritable) addToMap(bucket.inheritableByTag, tag, rule);
      indexed = true;
    }

    if (!indexed) {
      bucket.universal.push(rule);
      if (hasInheritable) bucket.inheritableUniversal.push(rule);
    }
  }

  return bucket;
}

function getCandidateRules(
  el: Element,
  bucket: RuleIndexBucket,
  isAncestorOnly: boolean
): CascadeRuleSource[] {
  const candidateSet = new Set<CascadeRuleSource>();
  const byClass = isAncestorOnly ? bucket.inheritableByClass : bucket.byClass;
  const byId = isAncestorOnly ? bucket.inheritableById : bucket.byId;
  const byTag = isAncestorOnly ? bucket.inheritableByTag : bucket.byTag;
  const universal = isAncestorOnly
    ? bucket.inheritableUniversal
    : bucket.universal;

  if (el.id && byId.has(el.id)) {
    const list = byId.get(el.id)!;
    for (let i = 0; i < list.length; i++) candidateSet.add(list[i]);
  }

  if (el.classList && el.classList.length > 0) {
    for (let i = 0; i < el.classList.length; i++) {
      const cls = el.classList[i];
      if (byClass.has(cls)) {
        const list = byClass.get(cls)!;
        for (let j = 0; j < list.length; j++) candidateSet.add(list[j]);
      }
    }
  }

  const tagName = el.tagName ? el.tagName.toLowerCase() : "";
  if (tagName && byTag.has(tagName)) {
    const list = byTag.get(tagName)!;
    for (let i = 0; i < list.length; i++) candidateSet.add(list[i]);
  }

  for (let i = 0; i < universal.length; i++) {
    candidateSet.add(universal[i]);
  }

  return Array.from(candidateSet);
}

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

  // 2. 构建规则快速索引桶 Bucket
  const ruleBucket = buildRuleBucket(rules);
  const ancestorCache = new WeakMap<
    Element,
    {
      inheritedRules: CascadeInheritedRuleRef[];
      propertySources: CascadePropertySource[];
    }
  >();

  // 3. 收集目标元素
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

    // 1) 匹配该元素的自身直属规则（使用候选规则桶替代全量 rules）
    const candidateRules = getCandidateRules(el, ruleBucket, false);
    for (let rIdx = 0; rIdx < candidateRules.length; rIdx++) {
      const r = candidateRules[rIdx];
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

    // 2) 向上遍历祖先节点，抓取 Inherited Rules（带 WeakMap 缓存与继承规则桶筛选）
    const inheritedRules: CascadeInheritedRuleRef[] = [];
    let currParent = el.parentElement;
    while (
      currParent &&
      currParent !== document.body &&
      currParent !== document.documentElement
    ) {
      // 命中 WeakMap 缓存
      if (ancestorCache.has(currParent)) {
        const cached = ancestorCache.get(currParent)!;
        for (let i = 0; i < cached.inheritedRules.length; i++) {
          inheritedRules.push(cached.inheritedRules[i]);
        }
        for (let i = 0; i < cached.propertySources.length; i++) {
          const ps = cached.propertySources[i];
          if (!perPropertyMap[ps.property]) {
            perPropertyMap[ps.property] = [];
          }
          perPropertyMap[ps.property].push(ps);
        }
        currParent = currParent.parentElement;
        continue;
      }

      const parentTagName = currParent.tagName
        ? currParent.tagName.toLowerCase()
        : "";
      const parentSelector = currParent.id
        ? `#${currParent.id}`
        : currParent.className && typeof currParent.className === "string"
          ? `.${currParent.className.split(" ").join(".")}`
          : parentTagName;

      const parentInheritedRules: CascadeInheritedRuleRef[] = [];
      const parentPropertySources: CascadePropertySource[] = [];

      const ancestorCandidates = getCandidateRules(
        currParent,
        ruleBucket,
        true
      );
      for (let rIdx = 0; rIdx < ancestorCandidates.length; rIdx++) {
        const r = ancestorCandidates[rIdx];
        try {
          if (currParent.matches && currParent.matches(r.selectorText)) {
            const inheritedProps: Record<string, string> = {};
            for (const [prop, val] of Object.entries(r.styleProps)) {
              if (INHERITABLE_PROPERTIES.has(prop.toLowerCase())) {
                inheritedProps[prop] = val;

                const ps: CascadePropertySource = {
                  property: prop,
                  value: val,
                  sourceRuleId: r.id,
                  inheritedFromSelector: parentSelector,
                };
                parentPropertySources.push(ps);

                if (!perPropertyMap[prop]) {
                  perPropertyMap[prop] = [];
                }
                perPropertyMap[prop].push(ps);
              }
            }
            if (Object.keys(inheritedProps).length > 0) {
              const ruleRef: CascadeInheritedRuleRef = {
                ancestorSelector: parentSelector,
                ancestorTagName: parentTagName,
                ruleId: r.id,
                inheritedProps,
              };
              parentInheritedRules.push(ruleRef);
              inheritedRules.push(ruleRef);
            }
          }
        } catch {
          // 忽略
        }
      }

      // 写入祖先 WeakMap 缓存
      ancestorCache.set(currParent, {
        inheritedRules: parentInheritedRules,
        propertySources: parentPropertySources,
      });

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
