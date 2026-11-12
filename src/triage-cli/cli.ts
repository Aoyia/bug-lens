import { existsSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { SearchScope } from "./query/search.ts";
import type { TimelineEventKind } from "./query/timeline.ts";
import { runExtractPackTool } from "./tools/extract-pack.ts";
import { runGetFrameworkStateTool } from "./tools/get-framework-state.ts";
import { runGetInteractionsTool } from "./tools/get-interactions.ts";
import { runGetRequestTool } from "./tools/get-request.ts";
import { runGetSceneTool } from "./tools/get-scene.ts";
import { runGetScreenshotTool } from "./tools/get-screenshot.ts";
import type { McpContentBlock } from "./tools/image-helper.ts";
import { runOpenPackTool } from "./tools/open-pack.ts";
import { runQueryConsoleTool } from "./tools/query-console.ts";
import { runQueryNetworkTool } from "./tools/query-network.ts";
import { runReadPackFileTool } from "./tools/read-pack-file.ts";
import { runSearchPackTool } from "./tools/search-pack.ts";
import { runTimelineTool } from "./tools/timeline.ts";

interface ParsedCliArgs {
  flags: Record<string, string | boolean>;
  positionals: string[];
}

function parseCliArgs(rawArgs: string[]): ParsedCliArgs {
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];

  for (let i = 0; i < rawArgs.length; i++) {
    const token = rawArgs[i]!;
    if (token === "--") {
      positionals.push(...rawArgs.slice(i + 1));
      break;
    }
    if (token.startsWith("--")) {
      const eqIdx = token.indexOf("=");
      if (eqIdx > 2) {
        const key = token.slice(2, eqIdx);
        const val = token.slice(eqIdx + 1);
        flags[key] = val;
      } else {
        const key = token.slice(2);
        const next = rawArgs[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = true;
        }
      }
      continue;
    }
    // Support key=value syntax when key is a known identifier
    const kvMatch = /^([a-zA-Z][a-zA-Z0-9_]*)=(.+)$/.exec(token);
    if (kvMatch && !existsSync(token)) {
      flags[kvMatch[1]!] = kvMatch[2]!;
      continue;
    }
    positionals.push(token);
  }

  // Support inline JSON argument object: `{...}` or `--json '{...}'`
  const jsonRaw =
    typeof flags.json === "string"
      ? flags.json
      : positionals[0]?.trim().startsWith("{")
        ? positionals.shift()
        : undefined;
  if (jsonRaw) {
    try {
      const parsed = JSON.parse(jsonRaw) as Record<string, unknown>;
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "boolean" || typeof v === "string") {
          flags[k] = v;
        } else if (typeof v === "number") {
          flags[k] = String(v);
        } else if (Array.isArray(v)) {
          flags[k] = v.join(",");
        }
      }
    } catch {
      // ignore invalid json flag
    }
  }

  return { flags, positionals };
}

function strFlag(
  flags: Record<string, string | boolean>,
  ...keys: string[]
): string | undefined {
  for (const k of keys) {
    const v = flags[k];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return undefined;
}

function numFlag(
  flags: Record<string, string | boolean>,
  ...keys: string[]
): number | undefined {
  const s = strFlag(flags, ...keys);
  if (s === undefined) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

function boolFlag(
  flags: Record<string, string | boolean>,
  ...keys: string[]
): boolean | undefined {
  for (const k of keys) {
    const v = flags[k];
    if (typeof v === "boolean") return v;
    if (typeof v === "string") {
      const lower = v.trim().toLowerCase();
      if (lower === "true" || lower === "1" || lower === "yes") return true;
      if (lower === "false" || lower === "0" || lower === "no") return false;
    }
  }
  return undefined;
}

function csvFlag(
  flags: Record<string, string | boolean>,
  ...keys: string[]
): string[] | undefined {
  const s = strFlag(flags, ...keys);
  if (!s) return undefined;
  const items = s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function isLikelyPackPath(candidate: string | undefined): boolean {
  if (!candidate) return false;
  if (/\.zip$/i.test(candidate)) return true;
  return existsSync(candidate);
}

function resolvePackAndPositionals(
  flags: Record<string, string | boolean>,
  positionals: string[],
  firstPositionalIsAlwaysPack = false
): { pack?: string; rest: string[] } {
  const explicitPack = strFlag(flags, "pack", "p");
  if (explicitPack) {
    return { pack: explicitPack, rest: positionals };
  }
  if (
    positionals.length > 0 &&
    (firstPositionalIsAlwaysPack || isLikelyPackPath(positionals[0]))
  ) {
    return { pack: positionals[0], rest: positionals.slice(1) };
  }
  return { pack: undefined, rest: positionals };
}

function formatBlocksOutput(blocks: McpContentBlock[]): string {
  return blocks
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("\n\n");
}

function formatHelp(): string {
  return `Bug Lens Evidence Triage CLI
Usage: node bug-lens-cli.mjs <command> [options]

Commands:
  open_pack <zipOrDir>                        Extract pack to workspace (idempotent), generate derived JSON & INDEX.md, cache session path, and print overview
  get_scene [--selector S] [--cssProperty P]  Inspect issue scene (session) or DOM anchor & CSS cascade rules (screenshot)
  get_screenshot [--kind K] [--step N]        Locate screenshot image in workspace and print path
  timeline [--aroundSceneId ID] [--windowMs]  Unified chronological timeline of interactions, console errors, and network requests
  query_console [--levels error,warning]      Filter console logs and source-mapped stack traces
  query_network [--status failed|4xx|5xx]     Filter network requests (prioritizes failures)
  get_request <id> [--jsonPath EXPR]          Inspect request headers, initiator stack, and response body (with JSONPath)
  get_interactions [--fromIndex N] [--limit]  List recorded user interactions
  get_framework_state [--component NAME]      Inspect Vue/React component props, state, and webStorage snapshots
  search_pack <query>                         Cross-search console, network URLs/bodies, interactions, cascade rules, and state
  read_pack_file <path> [--jsonPath EXPR]     Read raw JSON/JS/text file or workspace artifact (INDEX.md, data/*.json)
  extract_pack [--dest DIR]                   Describe active workspace or copy extracted pack to custom directory`;
}

export function runTriageCli(argv: string[]): string {
  const rawCmd = argv[0]?.trim();
  if (
    !rawCmd ||
    rawCmd === "-h" ||
    rawCmd === "--help" ||
    rawCmd === "help" ||
    argv.slice(1).some((arg) => arg === "-h" || arg === "--help")
  ) {
    return formatHelp();
  }

  const cmd = rawCmd.replace(/-/g, "_").toLowerCase();
  const { flags, positionals } = parseCliArgs(argv.slice(1));
  const format =
    strFlag(flags, "format") === "json" ? ("json" as const) : ("text" as const);
  const maxChars = numFlag(flags, "maxChars", "max_chars");

  switch (cmd) {
    case "open_pack": {
      const { pack } = resolvePackAndPositionals(flags, positionals, true);
      if (!pack) {
        throw new Error(
          "Usage: bug-lens-cli.mjs open_pack <zipPath> [--format text|json]"
        );
      }
      return runOpenPackTool({ pack, format, maxChars });
    }

    case "get_scene": {
      const { pack, rest } = resolvePackAndPositionals(flags, positionals);
      const sceneIndex = numFlag(flags, "sceneIndex", "scene_index", "index");
      const sceneId = strFlag(flags, "sceneId", "scene_id");
      const selector = strFlag(flags, "selector", "s") ?? rest[0];
      const cssProperty = strFlag(flags, "cssProperty", "css_property", "prop");
      const includeImage = boolFlag(
        flags,
        "includeImage",
        "include_image",
        "includeScreenshot",
        "include_screenshot"
      );
      const blocks = runGetSceneTool({
        pack,
        sceneId:
          sceneId ??
          (sceneIndex === undefined && rest[0] && /^\d+$/.test(rest[0])
            ? rest[0]
            : undefined),
        sceneIndex,
        selector,
        cssProperty,
        includeImage,
        format,
        maxChars,
      });
      return formatBlocksOutput(blocks);
    }

    case "get_screenshot": {
      const { pack, rest } = resolvePackAndPositionals(flags, positionals);
      const kind = (strFlag(flags, "kind") ?? rest[0]) as
        | "step"
        | "issue-original"
        | "issue-annotated"
        | "screenshot"
        | undefined;
      const step = numFlag(flags, "step");
      const sceneId = strFlag(flags, "sceneId", "scene_id");
      const blocks = runGetScreenshotTool({ pack, kind, step, sceneId });
      return formatBlocksOutput(blocks);
    }

    case "timeline": {
      const { pack, rest } = resolvePackAndPositionals(flags, positionals);
      const rawAround =
        strFlag(flags, "aroundSceneId", "around_scene_id", "around") ?? rest[0];
      const aroundSceneId = rawAround?.startsWith("scene:")
        ? String(Math.max(0, Number(rawAround.slice("scene:".length)) - 1))
        : rawAround;
      return runTimelineTool({
        pack,
        aroundSceneId,
        fromMs: numFlag(flags, "fromMs", "from_ms"),
        toMs: numFlag(flags, "toMs", "to_ms"),
        windowMs: numFlag(flags, "windowMs", "window_ms"),
        kinds: csvFlag(flags, "kinds", "kind") as
          TimelineEventKind[] | undefined,
        includeAllConsole: boolFlag(
          flags,
          "includeAllConsole",
          "include_all_console"
        ),
        includeAllNetwork: boolFlag(
          flags,
          "includeAllNetwork",
          "include_all_network"
        ),
        limit: numFlag(flags, "limit"),
        format,
        maxChars,
      });
    }

    case "query_console": {
      const { pack, rest } = resolvePackAndPositionals(flags, positionals);
      return runQueryConsoleTool({
        pack,
        levels: csvFlag(flags, "levels", "level"),
        search: strFlag(flags, "search", "query", "q") ?? rest[0],
        regex: strFlag(flags, "regex"),
        fromMs: numFlag(flags, "fromMs", "from_ms"),
        toMs: numFlag(flags, "toMs", "to_ms"),
        offset: numFlag(flags, "offset"),
        limit: numFlag(flags, "limit"),
        format,
        maxChars,
      });
    }

    case "query_network": {
      const { pack, rest } = resolvePackAndPositionals(flags, positionals);
      const rawStatus = strFlag(flags, "status");
      const status =
        rawStatus && /^\d+(,\d+)*$/.test(rawStatus)
          ? rawStatus.split(",").map(Number)
          : (rawStatus as "all" | "failed" | "4xx" | "5xx" | "2xx" | undefined);
      return runQueryNetworkTool({
        pack,
        status,
        urlContains:
          strFlag(flags, "urlContains", "url_contains", "url") ?? rest[0],
        method: strFlag(flags, "method"),
        type: strFlag(flags, "type"),
        offset: numFlag(flags, "offset"),
        limit: numFlag(flags, "limit"),
        format,
        maxChars,
      });
    }

    case "get_request": {
      const { pack, rest } = resolvePackAndPositionals(flags, positionals);
      const id = strFlag(flags, "id", "requestId", "request_id") ?? rest[0];
      if (!id) {
        throw new Error(
          "Usage: bug-lens-cli.mjs get_request <id> [--jsonPath EXPR]"
        );
      }
      return runGetRequestTool({
        pack,
        id,
        include: csvFlag(flags, "include") as
          Array<"summary" | "headers" | "initiator" | "body"> | undefined,
        jsonPath: strFlag(flags, "jsonPath", "json_path") ?? rest[1],
        bodyMaxChars: numFlag(flags, "bodyMaxChars", "body_max_chars"),
        format,
        maxChars,
      });
    }

    case "get_interactions": {
      const { pack } = resolvePackAndPositionals(flags, positionals);
      const blocks = runGetInteractionsTool({
        pack,
        fromIndex: numFlag(flags, "fromIndex", "from_index"),
        limit: numFlag(flags, "limit"),
        kinds: csvFlag(flags, "kinds", "kind"),
        includeScreenshot: boolFlag(
          flags,
          "includeScreenshot",
          "include_screenshot"
        ),
        format,
        maxChars,
      });
      return formatBlocksOutput(blocks);
    }

    case "get_framework_state": {
      const { pack, rest } = resolvePackAndPositionals(flags, positionals);
      return runGetFrameworkStateTool({
        pack,
        index: numFlag(flags, "index"),
        nearMs: numFlag(flags, "nearMs", "near_ms"),
        component: strFlag(flags, "component") ?? rest[0],
        path: strFlag(flags, "path", "jsonPath", "json_path"),
        format,
        maxChars,
      });
    }

    case "search_pack": {
      const { pack, rest } = resolvePackAndPositionals(flags, positionals);
      const query = strFlag(flags, "query", "q") ?? rest[0];
      if (!query) {
        throw new Error("Usage: bug-lens-cli.mjs search_pack <query>");
      }
      return runSearchPackTool({
        pack,
        query,
        scopes: csvFlag(flags, "scopes", "scope") as SearchScope[] | undefined,
        limit: numFlag(flags, "limit"),
        contextChars: numFlag(flags, "contextChars", "context_chars"),
        format,
        maxChars,
      });
    }

    case "read_pack_file": {
      const { pack, rest } = resolvePackAndPositionals(flags, positionals);
      const path = strFlag(flags, "path", "file") ?? rest[0];
      if (!path) {
        throw new Error(
          "Usage: bug-lens-cli.mjs read_pack_file <path> [--jsonPath EXPR]"
        );
      }
      return runReadPackFileTool({
        pack,
        path,
        jsonPath: strFlag(flags, "jsonPath", "json_path") ?? rest[1],
        offset: numFlag(flags, "offset"),
        maxChars,
      });
    }

    case "extract_pack": {
      const { pack, rest } = resolvePackAndPositionals(flags, positionals);
      return runExtractPackTool({
        pack,
        dest: strFlag(flags, "dest", "d") ?? rest[0],
        format,
      });
    }

    default:
      throw new Error(
        `UNKNOWN_COMMAND: Unknown command "${rawCmd}". Run with --help to see available commands.`
      );
  }
}

function checkIsMainModule(): boolean {
  if (
    typeof process === "undefined" ||
    !Array.isArray(process.argv) ||
    !process.argv[1]
  ) {
    return false;
  }
  const scriptArg = process.argv[1];
  if (scriptArg.endsWith("bug-lens-cli.mjs") || scriptArg.endsWith("cli.ts")) {
    return true;
  }
  try {
    const currentFilePath = fileURLToPath(import.meta.url);
    const scriptPath = resolve(scriptArg);
    const resolvedScript = existsSync(scriptPath)
      ? realpathSync(scriptPath)
      : scriptPath;
    const resolvedCurrent = existsSync(currentFilePath)
      ? realpathSync(currentFilePath)
      : currentFilePath;
    return resolvedScript === resolvedCurrent;
  } catch {
    return false;
  }
}

const isMainModule = checkIsMainModule();

if (isMainModule) {
  try {
    const out = runTriageCli(process.argv.slice(2));
    process.stdout.write(out + "\n");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: ${msg}\n`);
    process.exit(1);
  }
}
