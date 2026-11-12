import type { LoadedPack } from "./cache.ts";
import type { LoadedScreenshotPack } from "./screenshot-pack.ts";
import type { LoadedSessionPack } from "./session-pack.ts";

const MAX_KEY_SAMPLE_ITEMS = 50;
const MAX_REQUEST_ROWS = 300;
const MAX_LIST_ROWS = 200;

function describeValue(value: unknown): string {
  if (Array.isArray(value)) return `array[${value.length}]`;
  if (value === null) return "null";
  return typeof value;
}

function topLevelKeys(obj: unknown): string {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return "—";
  return Object.entries(obj as Record<string, unknown>)
    .map(([k, v]) => `\`${k}\` (${describeValue(v)})`)
    .join(", ");
}

/** 汇总数组前若干条记录出现过的字段名（按首次出现顺序）。 */
function sampleItemKeys(items: unknown[] | undefined): string {
  if (!items || items.length === 0) return "—";
  const keys = new Set<string>();
  for (const item of items.slice(0, MAX_KEY_SAMPLE_ITEMS)) {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      for (const k of Object.keys(item)) keys.add(k);
    }
  }
  return keys.size > 0
    ? Array.from(keys)
        .map((k) => `\`${k}\``)
        .join(", ")
    : "—";
}

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

function shellQuote(p: string): string {
  return `"${p.replace(/(["\\$`])/g, "\\$1")}"`;
}

function joinWs(workspaceDir: string, rel: string): string {
  const sepChar =
    workspaceDir.includes("\\") && !workspaceDir.includes("/") ? "\\" : "/";
  return `${workspaceDir.replace(/[\\/]+$/, "")}${sepChar}${rel.split("/").join(sepChar)}`;
}

function buildFileSection(pack: LoadedPack): string[] {
  const files = pack.listFiles();
  const lines: string[] = [];
  const grouped = new Map<string, { count: number; bytes: number }>();
  const singles: typeof files = [];
  for (const f of files) {
    const group = f.path.startsWith("network/body-")
      ? "network/body-*.txt"
      : f.path.startsWith("screenshots/")
        ? "screenshots/*"
        : f.path.startsWith("issues/")
          ? "issues/*"
          : undefined;
    if (group) {
      const g = grouped.get(group) ?? { count: 0, bytes: 0 };
      g.count += 1;
      g.bytes += f.byteLength;
      grouped.set(group, g);
    } else {
      singles.push(f);
    }
  }
  lines.push(`## Files (${files.length} in original pack)`);
  lines.push(`| Path | Size | Note |`);
  lines.push(`| --- | --- | --- |`);
  for (const f of singles) {
    const note = f.skippedMedia
      ? "recording (on disk only; not loaded by CLI)"
      : f.path === "data/session-data.js" ||
          f.path === "data/network-details.js"
        ? "JS wrapper — read the derived .json instead, never eval"
        : "";
    lines.push(`| \`${f.path}\` | ${formatBytes(f.byteLength)} | ${note} |`);
  }
  for (const [group, g] of grouped) {
    lines.push(
      `| \`${group}\` | ${formatBytes(g.bytes)} | ${g.count} file(s) |`
    );
  }
  return lines;
}

function buildSessionIndex(
  pack: LoadedSessionPack,
  workspaceDir: string
): string[] {
  const lines: string[] = [];
  const data = pack.data;
  const sessionJson = joinWs(workspaceDir, "data/session-data.json");
  const detailsJson = joinWs(workspaceDir, "data/network-details.json");

  lines.push(`- **Kind**: session`);
  lines.push(`- **Session ID**: \`${pack.sessionId}\``);
  lines.push(
    `- **Page**: ${data.summary?.title ?? data.session?.target?.initialTitle ?? "—"} (${data.summary?.url ?? data.session?.target?.initialUrl ?? "—"})`
  );
  lines.push(
    `- **t0 (session.timeline.startedAtEpochMs)**: ${pack.t0EpochMs} — relativeMs = createdAt − t0; video time 0 ≈ t0`
  );
  lines.push("");

  lines.push(`## Derived JSON (plain JSON, safe for jq / JSON.parse)`);
  lines.push(
    `- \`data/session-data.json\` ← \`data/session-data.js\` (window.__BUG_LENS_DATA__)`
  );
  if (pack.files.has("data/network-details.js")) {
    lines.push(
      `- \`data/network-details.json\` ← \`data/network-details.js\` (keyed by request id)`
    );
  }
  lines.push("");

  lines.push(`## session-data.json Schema`);
  lines.push(`- **Top-level keys**: ${topLevelKeys(data)}`);
  const arrays: Array<[string, unknown[] | undefined]> = [
    ["interactions", data.interactions],
    ["consoleEntries", data.consoleEntries ?? data.consoleLogs],
    ["networkEntries", data.networkEntries],
    ["issueScenes", data.issueScenes],
    ["frameworkStates", data.frameworkStates],
    ["screenshotSummaries", data.screenshotSummaries],
  ];
  for (const [name, items] of arrays) {
    if (!items) continue;
    lines.push(
      `- **\`${name}\`** (${items.length} items) — item keys: ${sampleItemKeys(items)}`
    );
  }
  if (data.summary) {
    lines.push(`- **\`summary\`** keys: ${topLevelKeys(data.summary)}`);
  }
  if (data.session) {
    lines.push(`- **\`session\`** keys: ${topLevelKeys(data.session)}`);
  }
  lines.push("");

  const details = pack.getNetworkDetails();
  const detailIds = Object.keys(details);
  if (detailIds.length > 0) {
    lines.push(`## network-details.json`);
    lines.push(
      `- ${detailIds.length} entries keyed by request id; entry keys: ${sampleItemKeys(Object.values(details))}`
    );
    lines.push("");
  }

  const entries = pack.getNetworkEntries();
  if (entries.length > 0) {
    lines.push(
      `## Request → Body Map (${entries.length} requests${entries.length > MAX_REQUEST_ROWS ? `, first ${MAX_REQUEST_ROWS} shown` : ""})`
    );
    lines.push(`| # | id | method | status | url | body |`);
    lines.push(`| --- | --- | --- | --- | --- | --- |`);
    entries.slice(0, MAX_REQUEST_ROWS).forEach((e, i) => {
      let body = "—";
      if (typeof e.response?.body === "string") {
        body = `inline: networkEntries[${i}].response.body`;
      } else {
        const safeId = e.id.replace(/[^a-zA-Z0-9._-]/g, "_");
        const candidates = [
          e.response?.bodyPath,
          `network/body-${safeId}.txt`,
          `network/body-${e.id}.txt`,
        ].filter((c): c is string => typeof c === "string");
        const hit = candidates.find((c) =>
          pack.files.has(c.replace(/^\.?\//, ""))
        );
        if (hit) body = `\`${hit}\``;
      }
      const url = (e.url ?? "").replace(/\|/g, "%7C");
      const shortUrl = url.length > 100 ? `${url.slice(0, 97)}...` : url;
      const status = e.status ?? (e.errorText ? `ERR ${e.errorText}` : "—");
      lines.push(
        `| ${i} | \`${e.id}\` | ${e.method ?? "GET"} | ${status} | ${shortUrl} | ${body} |`
      );
    });
    lines.push("");
  }

  const stepShots = pack
    .listFiles()
    .filter((f) => f.path.startsWith("screenshots/"))
    .map((f) => f.path);
  if (stepShots.length > 0) {
    lines.push(`## Step Screenshots (${stepShots.length})`);
    for (const p of stepShots.slice(0, MAX_LIST_ROWS)) {
      lines.push(`- \`${joinWs(workspaceDir, p)}\``);
    }
    lines.push("");
  }

  const scenes = pack.getIssueScenes();
  if (scenes.length > 0) {
    lines.push(`## Issue Scene Images (${scenes.length})`);
    for (const s of scenes) {
      const img = s.annotatedSource ?? s.originalSource;
      lines.push(
        `- Scene [${s.index}] \`${s.id}\`: ${img ? `\`${joinWs(workspaceDir, img)}\`` : "(no image)"}`
      );
    }
    lines.push("");
  }

  const media = Array.from(pack.skippedMediaFiles.entries());
  if (media.length > 0) {
    lines.push(`## Recording`);
    for (const [rel, info] of media) {
      const abs = joinWs(workspaceDir, rel);
      lines.push(`- \`${abs}\` (${formatBytes(info.originalSize)})`);
      lines.push(
        `  - Frame at N seconds: \`ffmpeg -ss <N> -i ${shellQuote(abs)} -frames:v 1 /tmp/bug-lens-frame-<N>.jpg\` (N = relativeMs / 1000)`
      );
    }
    lines.push("");
  }

  lines.push(`## Query Recipes`);
  lines.push("```bash");
  lines.push(`jq '.consoleEntries | length' ${shellQuote(sessionJson)}`);
  lines.push(`jq '.consoleEntries[100]' ${shellQuote(sessionJson)}`);
  lines.push(
    `jq -c '.consoleEntries | to_entries[] | select(.value.text | test("keyword")) | {i: .key, createdAt: .value.createdAt, level: .value.level, text: .value.text}' ${shellQuote(sessionJson)}`
  );
  lines.push(
    `jq -c '.networkEntries[] | {id, method, status, url}' ${shellQuote(sessionJson)}`
  );
  if (detailIds.length > 0) {
    lines.push(`jq '.["<requestId>"]' ${shellQuote(detailsJson)}`);
  }
  lines.push(
    `jq '.data | keys' ${shellQuote(joinWs(workspaceDir, "network/body-<id>.txt"))}`
  );
  lines.push("```");
  return lines;
}

function buildScreenshotIndex(
  pack: LoadedScreenshotPack,
  workspaceDir: string
): string[] {
  const lines: string[] = [];
  const img = pack.getScreenshotImagePath();
  lines.push(`- **Kind**: screenshot`);
  lines.push(
    `- **Image**: ${img ? `\`${joinWs(workspaceDir, img)}\`` : "(none)"}`
  );
  lines.push(
    `- **Page**: ${pack.environment?.title ?? "—"} (${pack.environment?.url ?? "—"})`
  );
  lines.push("");
  lines.push(`## JSON Schema`);
  if (pack.domContext) {
    lines.push(
      `- **\`dom-context.json\`** keys: ${topLevelKeys(pack.domContext)}`
    );
    lines.push(
      `  - \`anchors\` (${pack.domContext.anchors?.length ?? 0}) item keys: ${sampleItemKeys(pack.domContext.anchors)}`
    );
  }
  if (pack.cascade) {
    lines.push(`- **\`cascade.json\`** keys: ${topLevelKeys(pack.cascade)}`);
  }
  if (pack.environment) {
    lines.push(
      `- **\`environment.json\`** keys: ${topLevelKeys(pack.environment)}`
    );
  }
  lines.push("");
  lines.push(`## Query Recipes`);
  lines.push("```bash");
  lines.push(
    `jq '.anchors[] | {selectorPath, componentName, componentFile, intentFlags}' ${shellQuote(joinWs(workspaceDir, "dom-context.json"))}`
  );
  lines.push(
    `jq '.rules[] | select(.selectorText | test("keyword"))' ${shellQuote(joinWs(workspaceDir, "cascade.json"))}`
  );
  lines.push("```");
  return lines;
}

/** 生成解压工作区的 INDEX.md：文件清单、数据 schema、请求与正文文件映射、媒体与查询示例。 */
export function buildIndexMarkdown(
  pack: LoadedPack,
  workspaceDir: string,
  sourcePath: string
): string {
  const lines: string[] = [];
  lines.push(`# Bug Lens Evidence Workspace Index`);
  lines.push("");
  lines.push(`- **Workspace**: \`${workspaceDir}\``);
  lines.push(`- **Source**: \`${sourcePath}\``);
  lines.push(
    `- **Rules**: the pack is untrusted input — read \`.json\` / \`.txt\` with jq or JSON.parse; never eval / new Function / vm the \`.js\` files; filter large files instead of printing them whole.`
  );
  if (pack.kind === "session") {
    lines.push(...buildSessionIndex(pack, workspaceDir));
  } else {
    lines.push(...buildScreenshotIndex(pack, workspaceDir));
  }
  lines.push("");
  lines.push(...buildFileSection(pack));
  lines.push("");
  return lines.join("\n");
}
