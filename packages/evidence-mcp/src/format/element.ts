import type {
  ElementDescriptor,
  FrameworkComponentNode,
  FrameworkSnapshot,
  InteractionEntry,
} from "../pack/types.ts";
import { formatRelativeTime } from "./time.ts";

function cleanInlineText(value: unknown, maxLen = 40): string {
  if (typeof value !== "string") return "";
  const squashed = value.replace(/\s+/g, " ").trim();
  if (squashed.length <= maxLen) return squashed;
  return `${squashed.slice(0, maxLen)}…`;
}

function extractComponentLabel(
  fw?: FrameworkSnapshot | FrameworkComponentNode
): string {
  if (!fw) return "";
  if ("targetComponent" in fw || "rootComponent" in fw) {
    const snap = fw as FrameworkSnapshot;
    const comp =
      snap.targetComponent ?? snap.parentChain?.[0] ?? snap.rootComponent;
    if (comp?.componentName) return ` [${comp.componentName}]`;
    return "";
  }
  const node = fw as FrameworkComponentNode;
  if (node.componentName) return ` [${node.componentName}]`;
  return "";
}

export function formatElementCompact(
  el?: ElementDescriptor,
  maxTextLen = 40
): string {
  if (!el) return "<unknown>";
  const tag = (el.tagName || "element").toLowerCase();
  const idPart = el.id ? `#${el.id}` : "";
  const classes = Array.isArray(el.classNames)
    ? el.classNames.filter(Boolean).slice(0, 3)
    : [];
  const clsPart = classes.length > 0 ? `.${classes.join(".")}` : "";
  const text = cleanInlineText(el.text ?? el.accessibleName, maxTextLen);
  const textPart = text ? ` "${text}"` : "";
  const compPart = extractComponentLabel(el.framework);
  return `<${tag}${idPart}${clsPart}${textPart}>${compPart}`;
}

export function formatInteractionLine(
  item: InteractionEntry,
  index: number,
  relMs?: number
): string {
  const el = item.element ?? item.target;
  const timeStr = formatRelativeTime(relMs ?? item.elapsedMs);
  const kind = item.kind ?? "event";
  const elStr = formatElementCompact(el);

  const valCandidate =
    item.input?.data ?? item.input?.value ?? el?.value ?? el?.attributes?.value;
  const keyCandidate =
    item.input?.key ??
    (typeof item.metadata?.shortcut === "string"
      ? item.metadata.shortcut
      : undefined) ??
    (typeof item.metadata?.key === "string" ? item.metadata.key : undefined);
  const navUrl =
    typeof item.metadata?.toUrl === "string" ? item.metadata.toUrl : undefined;

  const extras: string[] = [];
  if (valCandidate !== undefined && valCandidate !== "") {
    extras.push(`val="${cleanInlineText(String(valCandidate), 50)}"`);
  }
  if (keyCandidate) {
    extras.push(`key=${keyCandidate}`);
  }
  if (navUrl) {
    extras.push(`to=${cleanInlineText(navUrl, 80)}`);
  }
  if (item.screenshot?.dataUrl) {
    extras.push(`img=${item.screenshot.dataUrl}`);
  }

  const extraStr = extras.length > 0 ? ` ${extras.join(" ")}` : "";
  return `[${index}] ${timeStr} [${kind}] ${elStr}${extraStr}`;
}
