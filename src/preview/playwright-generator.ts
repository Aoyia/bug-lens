import type {
  RecordingSession,
  InteractionRecord,
  ConsoleEntry,
  NetworkEntry,
} from "../shared/protocol";

type GeneratorInput = {
  session: RecordingSession;
  interactions: InteractionRecord[];
  consoleEntries: ConsoleEntry[];
  networkEntries: NetworkEntry[];
};

function escapeStr(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$/g, "\\$")
    .replace(/\r?\n/g, "\\n");
}

function pickLocator(
  element: InteractionRecord["element"]
): { kind: string; expression: string } | undefined {
  const locators = element.locators;
  if (!locators || locators.length === 0) return undefined;

  const sorted = [...locators].sort(
    (a, b) => b.stabilityScore - a.stabilityScore
  );
  const best = sorted[0];

  if (best.kind === "testId" && best.matchCount === 1) {
    return { kind: "testId", expression: best.expression };
  }
  if (best.kind === "role" && best.matchCount === 1) {
    return { kind: "role", expression: best.expression };
  }
  if (best.kind === "id" && best.matchCount === 1) {
    return { kind: "id", expression: best.expression };
  }
  if (best.kind === "text" && best.matchCount === 1) {
    return { kind: "text", expression: best.expression };
  }
  if (best.kind === "css" && best.matchCount === 1) {
    return { kind: "css", expression: best.expression };
  }

  return best.kind === "css"
    ? { kind: "css", expression: best.expression }
    : undefined;
}

function formatPlaywrightLocator(
  locator: { kind: string; expression: string }
): string {
  switch (locator.kind) {
    case "testId":
      return `page.getByTestId(${JSON.stringify(locator.expression)})`;
    case "role": {
      const match = locator.expression.match(/^role=(\S+)/);
      if (match) {
        return `page.getByRole(${JSON.stringify(match[1])})`;
      }
      return `page.locator(${JSON.stringify(locator.expression)})`;
    }
    case "text":
      return `page.getByText(${JSON.stringify(locator.expression)})`;
    case "id":
      return `page.locator(${JSON.stringify(`#${CSS.escape(locator.expression)}`)})`;
    case "css":
      return `page.locator(${JSON.stringify(locator.expression)})`;
    default:
      return `page.locator(${JSON.stringify(locator.expression)})`;
  }
}

function formatViewport(interaction: InteractionRecord): string {
  const vp = interaction.coordinates.viewport;
  return `page.setViewportSize({ width: ${vp.width}, height: ${vp.height} })`;
}

function formatScroll(interaction: InteractionRecord): string {
  const sx = interaction.coordinates.scrollX;
  const sy = interaction.coordinates.scrollY;
  if (sx === 0 && sy === 0) return "";
  return `await page.evaluate(() => { window.scrollTo(${sx}, ${sy}); });`;
}

function formatValue(metadata: InteractionRecord["metadata"]): string | undefined {
  if (!metadata) return undefined;
  if (metadata.valueRedacted) {
    return undefined;
  }
  return metadata.value;
}

function formatComment(interaction: InteractionRecord): string {
  const parts: string[] = [];
  const el = interaction.element;
  if (el.tagName) parts.push(`<${el.tagName}>`);
  if (el.text) {
    const text = el.text.slice(0, 60);
    parts.push(`"${text}"`);
  }
  if (el.role) parts.push(`role=${el.role}`);
  const tag = parts.join(" ") || "unknown element";
  return `// Step: ${interaction.kind} — ${tag}`;
}

function formatStep(
  interaction: InteractionRecord,
  originEpochMs: number
): string[] {
  const lines: string[] = [];

  lines.push("");
  lines.push(formatComment(interaction));

  const elapsedMs = interaction.createdAt - originEpochMs;
  if (elapsedMs >= 0) {
    lines.push(`// @${(elapsedMs / 1000).toFixed(1)}s`);
  }

  if (interaction.kind === "navigation") {
    const toUrl = interaction.metadata?.toUrl;
    if (toUrl) {
      lines.push(`await page.goto(${JSON.stringify(escapeStr(toUrl))}, { waitUntil: 'domcontentloaded' });`);
    } else {
      lines.push(`// Navigation without URL recorded`);
    }
    return lines;
  }

  const loc = pickLocator(interaction.element);
  if (!loc) {
    lines.push(`// AI: no stable locator found for this interaction`);
    return lines;
  }

  const pwLocator = formatPlaywrightLocator(loc);

  if (interaction.kind === "click") {
    const scroll = formatScroll(interaction);
    if (scroll) lines.push(scroll);
    lines.push(`await ${pwLocator}.click();`);
    return lines;
  }

  if (interaction.kind === "input") {
    const value = formatValue(interaction.metadata);
    if (value !== undefined) {
      lines.push(`await ${pwLocator}.fill(${JSON.stringify(escapeStr(value))});`);
    } else {
      lines.push(`await ${pwLocator}.click();`);
      lines.push(`// AI: input value was redacted — replace with actual test data`);
      lines.push(`// await ${pwLocator}.fill('');`);
    }
    return lines;
  }

  if (interaction.kind === "change") {
    const value = formatValue(interaction.metadata);
    if (value !== undefined) {
      lines.push(`await ${pwLocator}.selectOption(${JSON.stringify(escapeStr(value))});`);
    } else {
      lines.push(`await ${pwLocator}.click();`);
    }
    return lines;
  }

  if (interaction.kind === "submit") {
    lines.push(`await ${pwLocator}.click();`);
    lines.push(`// AI: form submission — may need to wait for navigation`);
    return lines;
  }

  if (interaction.kind === "keydown") {
    const key = interaction.metadata?.key;
    if (key) {
      lines.push(`await page.keyboard.press(${JSON.stringify(key)});`);
    } else {
      lines.push(`await ${pwLocator}.click();`);
    }
    return lines;
  }

  lines.push(`await ${pwLocator}.click();`);
  return lines;
}

function formatConsoleAssertions(entries: ConsoleEntry[]): string[] {
  const errors = entries.filter(
    (e) => e.level === "error" || e.level === "warning"
  );
  if (errors.length === 0) return [];

  return [
    "",
    "// Console assertions (AI: verify thresholds)",
    `const errors = [];`,
    `page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });`,
    "",
    `// Recorded errors: ${errors.length}`,
    `// AI: uncomment after verifying expected vs actual errors`,
    `// expect(errors.length).toBe(0);`,
  ];
}

function formatNetworkAnnotations(
  entries: NetworkEntry[]
): string[] {
  const failures = entries.filter(
    (e) => e.response?.status && e.response.status >= 400
  );
  if (failures.length === 0) return [];

  return [
    "",
    "// Network annotations (AI: verify expected failures)",
    ...failures.slice(0, 5).map((e) => {
      const status = e.response?.status ?? "?";
      return `// ${e.method} ${e.url} → ${status}`;
    }),
  ];
}

function formatFrameworkInfo(
  firstInteraction: InteractionRecord | undefined
): string[] {
  if (!firstInteraction?.element.framework?.targetComponent) return [];
  const fw = firstInteraction.element.framework.targetComponent;
  return [
    "",
    `// Detected framework: ${fw.framework === "vue" ? "Vue" : "React"} ${fw.version}`,
    `// Root component: <${fw.componentName}>`,
  ];
}

export function generatePlaywrightScript(input: GeneratorInput): string {
  const { session, interactions, consoleEntries, networkEntries } = input;
  const originEpochMs =
    session.timeline.startedAtEpochMs ?? session.timeline.createdAtEpochMs;

  const lines: string[] = [];

  lines.push(`// ============================================================`);
  lines.push(`// Generated by Bug Lens Playwright Generator`);
  lines.push(`// This is an AI-friendly draft — review and refine before running`);
  lines.push(`// Session: ${session.target.initialTitle || "Untitled"}`);
  lines.push(`// URL: ${session.target.initialUrl || "Unknown"}`);
  lines.push(`// Privacy: ${session.options.privacyMode}`);
  lines.push(`// ============================================================`);
  lines.push(`//`);
  lines.push(`// This script reproduces recorded user interactions.`);
  lines.push(`// It may not run as-is — an AI agent can refine locators,`);
  lines.push(`// add waits, handle edge cases, and insert assertions.`);
  lines.push(`//`);
  lines.push(``);
  lines.push(`import { test, expect } from '@playwright/test';`);
  lines.push(``);
  lines.push(`test('reproduce ${escapeStr(session.target.initialTitle || "recorded bug")}', async ({ page }) => {`);

  const firstInteraction = interactions[0];
  const fwInfo = formatFrameworkInfo(firstInteraction);
  if (fwInfo.length > 0) {
    for (const line of fwInfo) {
      lines.push(`  ${line}`);
    }
    lines.push(``);
  }

  lines.push(`  // AI: set viewport if needed`);
  if (firstInteraction) {
    lines.push(`  await ${formatViewport(firstInteraction)};`);
  }
  lines.push(``);

  for (const interaction of interactions) {
    const step = formatStep(interaction, originEpochMs);
    for (const line of step) {
      lines.push(`  ${line}`);
    }
  }

  const consoleLines = formatConsoleAssertions(consoleEntries);
  for (const line of consoleLines) {
    lines.push(`  ${line}`);
  }

  const networkLines = formatNetworkAnnotations(networkEntries);
  for (const line of networkLines) {
    lines.push(`  ${line}`);
  }

  lines.push(``);
  lines.push(`  // AI: add assertions to verify expected state`);
  lines.push(`  // await expect(page.locator('...')).toBeVisible();`);
  lines.push(`});`);

  return lines.join("\n");
}