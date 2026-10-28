import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { buildAnalyzePromptText } from "./prompts/analyze.ts";
import { runExtractPackTool } from "./tools/extract-pack.ts";
import { runGetFrameworkStateTool } from "./tools/get-framework-state.ts";
import { runGetInteractionsTool } from "./tools/get-interactions.ts";
import { runGetRequestTool } from "./tools/get-request.ts";
import { runGetSceneTool } from "./tools/get-scene.ts";
import { runGetScreenshotTool } from "./tools/get-screenshot.ts";
import { runOpenPackTool } from "./tools/open-pack.ts";
import { runQueryConsoleTool } from "./tools/query-console.ts";
import { runQueryNetworkTool } from "./tools/query-network.ts";
import { runReadPackFileTool } from "./tools/read-pack-file.ts";
import { runSearchPackTool } from "./tools/search-pack.ts";
import { runTimelineTool } from "./tools/timeline.ts";

export const SERVER_NAME = "bug-lens-mcp";
export const SERVER_VERSION = "0.1.0";

const packParam = z
  .string()
  .min(1)
  .describe(
    "Absolute path to a Bug Lens evidence .zip archive (web-bug-report-*.zip or bug-lens-screenshot-*.zip) or an extracted workspace directory."
  );

const formatParam = z
  .enum(["text", "json"])
  .optional()
  .describe(
    "Output format: 'text' (default, compact and token-efficient — omit or use 'text' to avoid large output offloading) or 'json' (verbose raw object)."
  );

const maxCharsParam = z
  .number()
  .int()
  .positive()
  .optional()
  .describe("Maximum character budget for the response (default 24000).");

function wrapTextTool<T>(fn: (args: T) => string) {
  return async (args: T) => {
    try {
      const text = fn(args);
      return {
        content: [{ type: "text" as const, text }],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [{ type: "text" as const, text: `Error: ${msg}` }],
      };
    }
  };
}

function wrapBlocksTool<T>(
  fn: (
    args: T
  ) => Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  >
) {
  return async (args: T) => {
    try {
      const content = fn(args);
      return { content };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [{ type: "text" as const, text: `Error: ${msg}` }],
      };
    }
  };
}

export function createEvidenceMcpServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  // 1. open_pack
  server.tool(
    "open_pack",
    "Open a Bug Lens evidence ZIP (or extracted folder) in memory without executing untrusted code. Returns pack kind ('session' or 'screenshot'), schema/integrity status, summary, environment, issue scene actual/expected/confidence overview, top console errors, top failed network requests, and file inventory.",
    {
      pack: packParam,
      format: formatParam,
      maxChars: maxCharsParam,
    },
    wrapTextTool(runOpenPackTool)
  );

  // 2. get_scene
  server.tool(
    "get_scene",
    "Inspect an issue scene from a session evidence pack: user narrative (actual vs. expected and confidence level), selected DOM targets (HTML, ancestor chain, styles), same-time sequenceContext, and annotated screenshot image.",
    {
      pack: packParam,
      sceneId: z
        .string()
        .optional()
        .describe(
          "Scene ID or 0-based index (e.g. '0'). Defaults to the first issue scene."
        ),
      includeImage: z
        .boolean()
        .optional()
        .describe(
          "Include the annotated screenshot image content (default true)."
        ),
      format: formatParam,
      maxChars: maxCharsParam,
    },
    wrapBlocksTool(runGetSceneTool)
  );

  // 3. timeline
  server.tool(
    "timeline",
    "Build a unified chronological timeline merging user interactions, console warnings/errors, network requests (failed + XHR/Fetch/Document), and issue scene marks.",
    {
      pack: packParam,
      aroundSceneId: z
        .string()
        .optional()
        .describe(
          "Center the time window around this scene ID or 0-based index."
        ),
      fromMs: z
        .number()
        .optional()
        .describe(
          "Start time in relative milliseconds from session start (t0)."
        ),
      toMs: z
        .number()
        .optional()
        .describe("End time in relative milliseconds from session start (t0)."),
      windowMs: z
        .number()
        .positive()
        .optional()
        .describe(
          "Milliseconds before the issue scene mark to include when centering around a scene (default 15000)."
        ),
      kinds: z
        .array(z.enum(["interaction", "console", "network", "scene"]))
        .optional()
        .describe("Filter event kinds included in the timeline."),
      includeAllConsole: z
        .boolean()
        .optional()
        .describe(
          "Include info/log/debug console entries in addition to warn/error."
        ),
      includeAllNetwork: z
        .boolean()
        .optional()
        .describe(
          "Include static asset requests in addition to XHR/Fetch/Document and failures."
        ),
      limit: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Max events to return (default 80)."),
      format: formatParam,
      maxChars: maxCharsParam,
    },
    wrapTextTool(runTimelineTool)
  );

  // 4. query_console
  server.tool(
    "query_console",
    "Filter and paginate recorded browser console entries by level, substring, regex, or relative time range.",
    {
      pack: packParam,
      levels: z
        .array(z.string())
        .optional()
        .describe("Filter by log levels, e.g. ['error', 'warn']."),
      search: z
        .string()
        .optional()
        .describe(
          "Case-insensitive substring filter on message text, URL, or stack."
        ),
      regex: z
        .string()
        .optional()
        .describe("Case-insensitive regular expression pattern."),
      fromMs: z
        .number()
        .optional()
        .describe("Minimum relative timestamp (ms from t0)."),
      toMs: z
        .number()
        .optional()
        .describe("Maximum relative timestamp (ms from t0)."),
      offset: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Pagination offset (default 0)."),
      limit: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Max entries to return (default 50)."),
      format: formatParam,
      maxChars: maxCharsParam,
    },
    wrapTextTool(runQueryConsoleTool)
  );

  // 5. query_network
  server.tool(
    "query_network",
    "Filter and list captured network requests. Defaults to prioritizing failed requests first.",
    {
      pack: packParam,
      status: z
        .union([
          z.enum(["failed", "4xx", "5xx", "2xx", "3xx", "all"]),
          z.array(z.number().int()),
        ])
        .optional()
        .describe("Filter by status category or specific HTTP status codes."),
      urlContains: z
        .string()
        .optional()
        .describe("Case-insensitive URL substring filter."),
      method: z
        .string()
        .optional()
        .describe("HTTP method filter (e.g. 'GET', 'POST')."),
      type: z
        .string()
        .optional()
        .describe("Resource type filter (e.g. 'XHR', 'Fetch', 'Document')."),
      offset: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Pagination offset (default 0)."),
      limit: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Max entries to return (default 50)."),
      format: formatParam,
      maxChars: maxCharsParam,
    },
    wrapTextTool(runQueryNetworkTool)
  );

  // 6. get_request
  server.tool(
    "get_request",
    "Inspect a single network request in depth by merging summary metadata, full request/response headers & initiator stack from network-details.js, and split response body from network/body-*.txt. Supports jsonPath extraction on JSON bodies.",
    {
      pack: packParam,
      id: z
        .string()
        .min(1)
        .describe(
          "Network entry ID (full ID, suffix, or unique URL substring)."
        ),
      include: z
        .array(z.enum(["summary", "headers", "initiator", "body"]))
        .optional()
        .describe("Sections to include (defaults to all)."),
      jsonPath: z
        .string()
        .optional()
        .describe(
          "Optional JSONPath expression to extract specific fields from a JSON response body (e.g. 'data.definition.form.elements[id=ssd_a]' or 'data.items[*].id')."
        ),
      bodyMaxChars: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          "Max chars of raw response body before truncation (default 8000)."
        ),
      format: formatParam,
      maxChars: maxCharsParam,
    },
    wrapTextTool(runGetRequestTool)
  );

  // 7. get_interactions
  server.tool(
    "get_interactions",
    "List recorded user interactions (clicks, inputs, keydowns, navigations) with normalized target element descriptions, input values, and optional step screenshots.",
    {
      pack: packParam,
      fromIndex: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("0-based starting interaction index."),
      limit: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Max interactions to return (default 60)."),
      kinds: z
        .array(z.string())
        .optional()
        .describe("Filter by interaction kinds (e.g. ['click', 'input'])."),
      includeScreenshot: z
        .boolean()
        .optional()
        .describe(
          "Attach step screenshots for up to the first 3 matched interactions."
        ),
      format: formatParam,
      maxChars: maxCharsParam,
    },
    wrapBlocksTool(runGetInteractionsTool)
  );

  // 8. get_framework_state
  server.tool(
    "get_framework_state",
    "Inspect captured Vue/React component trees, props/state, globalState, and webStorage (localStorage/sessionStorage) snapshots.",
    {
      pack: packParam,
      index: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("0-based snapshot index in frameworkStates[]."),
      nearMs: z
        .number()
        .optional()
        .describe(
          "Select the snapshot closest to this relative timestamp (ms from t0)."
        ),
      component: z
        .string()
        .optional()
        .describe("Case-insensitive component name filter."),
      path: z
        .string()
        .optional()
        .describe(
          "Optional JSONPath expression evaluated against the selected FrameworkStateEntry (e.g. 'webStorage.localStorage.USER_INFO')."
        ),
      format: formatParam,
      maxChars: maxCharsParam,
    },
    wrapTextTool(runGetFrameworkStateTool)
  );

  // 9. get_screenshot
  server.tool(
    "get_screenshot",
    "Retrieve an image from the pack as MCP image content: issue scene annotated/original screenshot, interaction step screenshot, or screenshot pack main image.",
    {
      pack: packParam,
      kind: z
        .enum(["step", "issue-original", "issue-annotated", "screenshot"])
        .optional()
        .describe("Image type to retrieve."),
      step: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          "1-based step number when kind='step' (for screenshots/step-N.jpg)."
        ),
      sceneId: z
        .string()
        .optional()
        .describe(
          "Scene ID or 0-based index when kind is 'issue-annotated' or 'issue-original'."
        ),
    },
    wrapBlocksTool(runGetScreenshotTool)
  );

  // 10. search_pack
  server.tool(
    "search_pack",
    "Search for a keyword across console logs, network URLs, network response bodies, user interactions, and framework state snapshots in a single call.",
    {
      pack: packParam,
      query: z
        .string()
        .min(1)
        .describe("Case-insensitive keyword to search for."),
      scopes: z
        .array(
          z.enum([
            "console",
            "network-url",
            "network-body",
            "interactions",
            "framework",
          ])
        )
        .optional()
        .describe("Scopes to search (defaults to all)."),
      limit: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Max hits to return (default 30)."),
      contextChars: z
        .number()
        .int()
        .min(40)
        .max(2000)
        .optional()
        .describe(
          "Characters of surrounding context before and after each match (default 180)."
        ),
      format: formatParam,
      maxChars: maxCharsParam,
    },
    wrapTextTool(runSearchPackTool)
  );

  // 11. read_pack_file
  server.tool(
    "read_pack_file",
    "Read any raw text or JSON file inside the evidence pack (e.g. 'dom-context.json', 'cascade.json', 'environment.json', 'reproduce.spec.ts', 'AI_PROMPT.md') with optional JSONPath or character offset.",
    {
      pack: packParam,
      path: z
        .string()
        .min(1)
        .describe(
          "Relative file path inside the archive (e.g. 'dom-context.json' or 'reproduce.spec.ts')."
        ),
      jsonPath: z
        .string()
        .optional()
        .describe(
          "Optional JSONPath expression when reading a .json or window.__BUG_LENS_*__ .js file."
        ),
      offset: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Character offset for paginated text reading (default 0)."),
      maxChars: maxCharsParam,
    },
    wrapTextTool(runReadPackFileTool)
  );

  // 12. extract_pack
  server.tool(
    "extract_pack",
    "Safely extract the evidence pack to disk (with zip-slip protection and Windows-safe filename sanitization for ':' in network body files) so you can run Playwright on reproduce.spec.ts or open report.html.",
    {
      pack: packParam,
      dest: z
        .string()
        .optional()
        .describe(
          "Optional destination directory. Defaults to <os.tmpdir()>/bug-lens-workspace/<sessionId8>."
        ),
      format: formatParam,
    },
    wrapTextTool(runExtractPackTool)
  );

  // MCP Prompt: analyze_bug_report
  server.prompt(
    "analyze_bug_report",
    "First-principles debugging workflow for analyzing a Bug Lens evidence pack using bug-lens-mcp tools.",
    {
      pack: z
        .string()
        .optional()
        .describe(
          "Optional absolute path to the Bug Lens .zip evidence package."
        ),
      lang: z
        .string()
        .optional()
        .describe(
          "Language for the debugging instructions ('zh' default or 'en')."
        ),
    },
    async ({ pack, lang }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: buildAnalyzePromptText(
              pack,
              lang?.trim().toLowerCase() === "en" ? "en" : "zh"
            ),
          },
        },
      ],
    })
  );

  return server;
}
