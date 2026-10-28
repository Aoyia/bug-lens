import { applyCharBudget } from "../format/budget.ts";
import { formatDuration, formatRelativeTime } from "../format/time.ts";
import { openPack } from "../pack/open.ts";
import type { LoadedScreenshotPack } from "../pack/screenshot-pack.ts";
import type { LoadedSessionPack } from "../pack/session-pack.ts";
import { formatConsoleItem, queryConsole } from "../query/console.ts";
import { formatNetworkRow, queryNetwork } from "../query/network.ts";

function formatSessionPackOverview(
  pack: LoadedSessionPack,
  format: "text" | "json",
  maxChars?: number
): string {
  const summary = pack.data.summary;
  const scenes = pack.getIssueScenes();
  const topErrors = queryConsole(pack, {
    levels: ["error"],
    limit: 5,
  });
  const topFailedNet = queryNetwork(pack, {
    status: "failed",
    limit: 5,
  });
  const files = pack.listFiles();

  if (format === "json") {
    const jsonOut = {
      kind: "session",
      packPath: pack.packPath,
      sessionId: pack.sessionId,
      integrity: pack.integrity,
      summary,
      issueScenes: scenes.map((s) => {
        const exp = s.scene.narrative?.expected;
        const expectedText = typeof exp === "string" ? exp : exp?.text;
        const confidence =
          typeof exp === "object" && exp !== null
            ? (exp.confidence ?? "missing")
            : expectedText
              ? "explicit"
              : "missing";
        return {
          id: s.id,
          index: s.index,
          actual: s.scene.narrative?.actual ?? null,
          expected: expectedText ?? null,
          expectedConfidence: confidence,
          originalSource: s.originalSource,
          annotatedSource: s.annotatedSource,
        };
      }),
      topConsoleErrors: topErrors.items,
      topNetworkFailures: topFailedNet.items,
      filesCount: files.length,
      files,
    };
    return applyCharBudget(JSON.stringify(jsonOut, null, 2), maxChars);
  }

  const lines: string[] = [];
  if (pack.integrity.schemaWarning) {
    lines.push(`⚠️ ${pack.integrity.schemaWarning}\n`);
  }
  if (!pack.integrity.valid) {
    lines.push(
      `⚠️ Integrity check reported mismatches: ${pack.integrity.mismatches.join("; ")}\n`
    );
  }

  lines.push(`# Bug Lens Evidence Pack (kind: session)`);
  lines.push(`- **Session ID**: \`${pack.sessionId}\``);
  lines.push(
    `- **Schema**: v${pack.integrity.schemaVersion ?? pack.data.session?.schemaVersion ?? "?"} (integrity: ${pack.integrity.valid ? "OK" : "MISMATCH"}, checked ${pack.integrity.checkedCount} files)`
  );
  lines.push(
    `- **Page**: ${summary?.title ?? pack.data.session?.target?.initialTitle ?? "—"} (${summary?.url ?? pack.data.session?.target?.initialUrl ?? "—"})`
  );
  lines.push(
    `- **Duration**: ${formatDuration(summary?.durationMs ?? pack.data.session?.timeline?.durationMs)} | Quality: ${summary?.quality ?? "—"} | Privacy: ${summary?.privacyMode ?? "—"}`
  );
  if (summary?.environment) {
    const env = summary.environment;
    lines.push(
      `- **Environment**: ${env.os ?? "?"} · ${env.browser ?? "?"} · ${env.language ?? "?"} · screen ${env.screen ?? "?"} · viewport ${env.viewport ?? "?"}`
    );
  }
  lines.push(
    `- **Counts**: ${pack.getInteractions().length} interactions | ${pack.getConsoleEntries().length} console entries (${topErrors.matchedCount} errors) | ${pack.getNetworkEntries().length} network requests (${topFailedNet.matchedCount} failed) | ${scenes.length} issue scenes | ${pack.getFrameworkStates().length} framework snapshots`
  );

  lines.push(`\n## Issue Scenes (${scenes.length})`);
  if (scenes.length === 0) {
    lines.push(`(No issue scenes marked in this session)`);
  } else {
    for (const s of scenes) {
      const rel = pack.toRelativeMs(
        s.scene.selectionStartedAtEpochMs ?? s.scene.observedAtEpochMs
      );
      const exp = s.scene.narrative?.expected;
      const expectedText = typeof exp === "string" ? exp : exp?.text;
      const confidence =
        typeof exp === "object" && exp !== null
          ? (exp.confidence ?? "missing")
          : expectedText
            ? "explicit"
            : "missing";
      lines.push(
        `- **Scene [${s.index}] \`${s.id}\`** (at ${formatRelativeTime(rel)}):`
      );
      lines.push(`  - **actual**: ${s.scene.narrative?.actual || "(empty)"}`);
      lines.push(
        `  - **expected** [confidence=${confidence}]: ${expectedText || "(not captured — treat any expectation as inferred hypothesis)"}`
      );
      lines.push(
        `  - **screenshots**: annotated=\`${s.annotatedSource ?? "none"}\`, original=\`${s.originalSource ?? "none"}\``
      );
    }
  }

  lines.push(`\n## Top Console Errors (${topErrors.matchedCount} total)`);
  if (topErrors.items.length === 0) {
    lines.push(`(No console errors recorded)`);
  } else {
    for (const item of topErrors.items) {
      lines.push(`- ${formatConsoleItem(item)}`);
    }
  }

  lines.push(
    `\n## Top Failed Network Requests (${topFailedNet.matchedCount} total)`
  );
  if (topFailedNet.items.length === 0) {
    lines.push(`(No failed network requests recorded)`);
  } else {
    for (const row of topFailedNet.items) {
      lines.push(`- ${formatNetworkRow(row)}`);
    }
  }

  lines.push(`\n## Package Files (${files.length})`);
  const keyFiles = files.filter(
    (f) =>
      !f.path.startsWith("screenshots/") && !f.path.startsWith("network/body-")
  );
  const bodyFilesCount = files.filter((f) =>
    f.path.startsWith("network/body-")
  ).length;
  const stepScreenshotsCount = files.filter((f) =>
    f.path.startsWith("screenshots/")
  ).length;
  for (const f of keyFiles) {
    lines.push(
      `- \`${f.path}\` (${f.byteLength} B${f.skippedMedia ? ", skipped in-memory load" : ""})`
    );
  }
  if (bodyFilesCount > 0) {
    lines.push(`- \`network/body-*.txt\` (${bodyFilesCount} split body files)`);
  }
  if (stepScreenshotsCount > 0) {
    lines.push(
      `- \`screenshots/step-*.*\` (${stepScreenshotsCount} step screenshots)`
    );
  }

  lines.push(
    `\n**Next steps**: Call \`get_scene\` to inspect DOM targets & annotated screenshot, \`timeline\` for chronological events around the issue, \`query_network\` / \`get_request\` for API bodies, or \`get_framework_state\` for Vue/React state.`
  );

  return applyCharBudget(lines.join("\n"), maxChars);
}

function formatScreenshotPackOverview(
  pack: LoadedScreenshotPack,
  format: "text" | "json",
  maxChars?: number
): string {
  const dc = pack.domContext;
  const anchors = dc?.anchors ?? [];
  const files = pack.listFiles();

  if (format === "json") {
    return applyCharBudget(
      JSON.stringify(
        {
          kind: "screenshot",
          packPath: pack.packPath,
          screenshotPath: pack.getScreenshotImagePath(),
          environment: pack.environment,
          smallestCommonAncestorSelector: dc?.smallestCommonAncestorSelector,
          meta: dc?.meta,
          anchors: anchors.map((a) => ({
            selector: a.selector,
            selectorPath: a.selectorPath,
            tagName: a.tagName,
            componentName: a.componentName,
            componentFile: a.componentFile,
            intentFlags: a.intentFlags,
            innerText: a.innerText?.slice(0, 120),
          })),
          hasCascade: Boolean(pack.cascade),
          files,
        },
        null,
        2
      ),
      maxChars
    );
  }

  const lines: string[] = [];
  const env = pack.environment;
  const recentErrors = env?.recentConsoleErrors ?? [];
  const recentFailed = env?.recentFailedRequests ?? [];
  const fwStates =
    env?.frameworkComponentStates ?? env?.vueComponentStates ?? [];

  lines.push(`# Bug Lens Screenshot Pack (kind: screenshot)`);
  lines.push(`- **Image**: \`${pack.getScreenshotImagePath() ?? "none"}\``);
  if (env) {
    lines.push(`- **Page**: ${env.title ?? "—"} (${env.url ?? "—"})`);
    lines.push(
      `- **Viewport**: ${env.viewport?.width ?? "?"}x${env.viewport?.height ?? "?"} (${env.mediaBreakpoint ?? "?"}) | UA: ${env.userAgent ?? "—"}`
    );
    lines.push(
      `- **Anomalies & State**: ${recentErrors.length} recent console error(s) | ${recentFailed.length} failed request(s) | ${fwStates.length} component state snapshot(s)`
    );
  }
  if (dc) {
    lines.push(
      `- **DOM Context**: SCA=\`${dc.smallestCommonAncestorSelector ?? "?"}\` | anchors=${dc.meta?.anchorCount ?? anchors.length}, leaves=${dc.meta?.leafCount ?? dc.leaves?.length ?? 0}, ancestors=${dc.meta?.ancestorCount ?? dc.ancestors?.length ?? 0}`
    );
    lines.push(`\n## Annotated DOM Anchors (${anchors.length})`);
    for (const [idx, a] of anchors.entries()) {
      const flags = a.intentFlags ? JSON.stringify(a.intentFlags) : "{}";
      const comp = a.componentName
        ? ` [${a.componentName}${a.componentFile ? ` @ ${a.componentFile}:${a.componentLine ?? ""}` : ""}]`
        : "";
      lines.push(
        `- [${idx}] \`${a.selectorPath ?? a.selector ?? "?"}\`${comp} flags=${flags} text="${(a.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 80)}"`
      );
    }
  }
  if (recentErrors.length > 0) {
    lines.push(`\n## Recent Console Errors (${recentErrors.length})`);
    for (const [i, err] of recentErrors.slice(0, 5).entries()) {
      lines.push(`- [#${i}] ${err.message ?? ""}`);
    }
  }
  if (recentFailed.length > 0) {
    lines.push(`\n## Recent Failed Network Requests (${recentFailed.length})`);
    for (const req of recentFailed.slice(0, 5)) {
      lines.push(
        `- ${req.method ?? "GET"} ${req.status ?? 0} ${req.url ?? ""}`
      );
    }
  }
  lines.push(`\n## Files (${files.length})`);
  for (const f of files) {
    lines.push(`- \`${f.path}\` (${f.byteLength} B)`);
  }
  lines.push(
    `\n**Next steps**: Call \`get_scene\` or \`get_screenshot(kind="screenshot")\` to view \`screenshot.jpg\` & anchor details, \`get_framework_state\` for component props/data, and \`read_pack_file(path="dom-context.json")\` or \`read_pack_file(path="cascade.json")\` for full DOM/CSS trees.`
  );
  return applyCharBudget(lines.join("\n"), maxChars);
}

export function runOpenPackTool(args: {
  pack: string;
  format?: "text" | "json";
  maxChars?: number;
}): string {
  const loaded = openPack(args.pack);
  const fmt = args.format ?? "text";
  if (loaded.kind === "session") {
    return formatSessionPackOverview(loaded, fmt, args.maxChars);
  }
  return formatScreenshotPackOverview(loaded, fmt, args.maxChars);
}
