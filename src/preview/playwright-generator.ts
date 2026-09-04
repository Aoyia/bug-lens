import {
  getSessionTitle,
  type RecordingSession,
  type InteractionRecord,
  type ConsoleEntry,
  type NetworkEntry,
} from "../shared/protocol";
import { MAX_IDLE_GAP_THRESHOLD_MS } from "../recording/idle-monitor.ts";

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

export function parsePiercingSelector(expression: string): {
  frameSelectors: string[];
  targetSelector: string;
} {
  const parts = expression.split(/\s*>>>\s*/).filter(Boolean);
  if (parts.length <= 1) {
    return {
      frameSelectors: [],
      targetSelector: parts[0] || expression,
    };
  }
  return {
    frameSelectors: parts.slice(0, -1),
    targetSelector: parts[parts.length - 1],
  };
}

export function formatPlaywrightLocator(locator: {
  kind: string;
  expression: string;
}): string {
  const { frameSelectors, targetSelector } = parsePiercingSelector(
    locator.expression
  );
  let base = "page";
  for (const frameSel of frameSelectors) {
    base += `.frameLocator(${JSON.stringify(frameSel)})`;
  }

  switch (locator.kind) {
    case "testId": {
      const match = targetSelector.match(
        /\[(?:data-testid|data-test|data-cy)=(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^\]\s]+))\]/
      );
      const rawVal = match
        ? (match[1] ?? match[2] ?? match[3] ?? "")
        : targetSelector;
      const testIdValue = rawVal.replace(/\\(.)/gs, "$1");
      return `${base}.getByTestId(${JSON.stringify(testIdValue)})`;
    }
    case "role": {
      const match = targetSelector.match(/^role=(\S+)/);
      if (match) {
        return `${base}.getByRole(${JSON.stringify(match[1])}).first()`;
      }
      return `${base}.locator(${JSON.stringify(targetSelector)}).first()`;
    }
    case "text":
      return `${base}.getByText(${JSON.stringify(targetSelector)}).first()`;
    case "id": {
      const idSelector = targetSelector.startsWith("#")
        ? targetSelector
        : `#${targetSelector}`;
      return `${base}.locator(${JSON.stringify(idSelector)})`;
    }
    case "css":
      return `${base}.locator(${JSON.stringify(targetSelector)}).first()`;
    default:
      return `${base}.locator(${JSON.stringify(targetSelector)}).first()`;
  }
}

function formatViewport(interaction: InteractionRecord): string {
  const vp = interaction.coordinates.viewport;
  return `page.setViewportSize({ width: ${vp.width}, height: ${vp.height} })`;
}

function formatScrollPosition(interaction: InteractionRecord): string {
  const sx = interaction.coordinates.scrollX;
  const sy = interaction.coordinates.scrollY;
  if (sx === 0 && sy === 0) return "";
  return `await page.evaluate(() => { window.scrollTo(${sx}, ${sy}); });`;
}

function formatValue(
  metadata: InteractionRecord["metadata"]
): string | undefined {
  if (!metadata) return undefined;
  if (metadata.valueRedacted) return undefined;
  return metadata.value;
}

function formatStep(
  interaction: InteractionRecord,
  originEpochMs: number
): string[] {
  const lines: string[] = [];

  const elapsedMs = interaction.createdAt - originEpochMs;
  const timeTag = elapsedMs >= 0 ? `/@${(elapsedMs / 1000).toFixed(1)}s` : "";
  const el = interaction.element;
  const tag = el.tagName || "unknown";
  const textHint = el.text ? ` "${el.text.slice(0, 40)}"` : "";
  const roleHint = el.role ? ` role=${el.role}` : "";

  lines.push(`// ${interaction.kind} <${tag}>${textHint}${roleHint}${timeTag}`);

  if (interaction.kind === "navigation") {
    const toUrl = interaction.metadata?.toUrl;
    if (toUrl) {
      lines.push(
        `await page.goto(${JSON.stringify(escapeStr(toUrl))}, { waitUntil: 'domcontentloaded' });`
      );
    }
    return lines;
  }

  if (interaction.kind === "scroll") {
    const sx = interaction.metadata?.scrollX ?? 0;
    const sy = interaction.metadata?.scrollY ?? 0;
    lines.push(
      `await page.evaluate(() => { window.scrollTo(${sx}, ${sy}); });`
    );
    return lines;
  }

  const loc = pickLocator(interaction.element);
  if (!loc) {
    lines.push(`// No stable locator — element may need manual targeting`);
    return lines;
  }

  const pwLocator = formatPlaywrightLocator(loc);

  if (interaction.kind === "contextmenu") {
    lines.push(`await ${pwLocator}.click({ button: 'right' });`);
    return lines;
  }

  if (interaction.kind === "dblclick") {
    lines.push(`await ${pwLocator}.dblclick();`);
    return lines;
  }

  if (interaction.kind === "click") {
    const scroll = formatScrollPosition(interaction);
    if (scroll) lines.push(scroll);
    lines.push(`await ${pwLocator}.click();`);
    return lines;
  }

  if (interaction.kind === "input") {
    const value = formatValue(interaction.metadata);
    if (value !== undefined) {
      lines.push(
        `await ${pwLocator}.fill(${JSON.stringify(escapeStr(value))});`
      );
    } else {
      lines.push(`await ${pwLocator}.click();`);
      lines.push(`// Value was redacted — fill with test data to proceed`);
    }
    return lines;
  }

  if (interaction.kind === "change") {
    const value = formatValue(interaction.metadata);
    if (value !== undefined) {
      lines.push(
        `await ${pwLocator}.selectOption(${JSON.stringify(escapeStr(value))});`
      );
    } else {
      lines.push(`await ${pwLocator}.click();`);
    }
    return lines;
  }

  if (interaction.kind === "file") {
    const meta = interaction.metadata;
    if (meta?.fileNames && meta.fileNames.length > 0) {
      const files = meta.fileNames.map((name, i) => {
        const type = meta.fileTypes?.[i] || "application/octet-stream";
        return `{ name: ${JSON.stringify(name)}, mimeType: ${JSON.stringify(type)}, buffer: Buffer.from('...') }`;
      });
      lines.push(`// File upload: ${meta.fileCount ?? 1} file(s)`);
      lines.push(
        `await page.getByLabel('...').setInputFiles([${files.join(", ")}]);`
      );
    } else {
      lines.push(
        `// File upload: ${meta?.fileCount ?? 1} file(s) (type: ${meta?.fileTypes?.[0] || "unknown"})`
      );
      lines.push(`// AI: provide the file path to use as test data`);
      lines.push(
        `// await page.getByLabel('...').setInputFiles('path/to/file.pdf');`
      );
    }
    return lines;
  }
  if (interaction.kind === "submit") {
    lines.push(`await ${pwLocator}.click();`);
    lines.push(`// Form submitted — may trigger navigation`);
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

export function generatePlaywrightScript(input: GeneratorInput): string {
  const { session, interactions, consoleEntries, networkEntries } = input;
  const originEpochMs =
    session.timeline.startedAtEpochMs ?? session.timeline.createdAtEpochMs;

  const recordedErrors = consoleEntries.filter(
    (e) => e.level === "error"
  ).length;
  const recordedWarnings = consoleEntries.filter(
    (e) => e.level === "warning"
  ).length;
  const recordedNetworkFailures = networkEntries.filter(
    (e) => e.status && e.status >= 400
  ).length;

  const lines: string[] = [];
  const l = (s: string) => lines.push(s);

  const sessionTitle = getSessionTitle(session, "recorded bug");

  l(`// Bug Lens — Playwright reproduction script`);
  l(`// URL: ${session.target.initialUrl || "unknown"}`);
  l(`// Title: ${sessionTitle}`);
  l(`// Privacy: ${session.options.privacyMode}`);
  l(
    `// Recorded evidence: ${interactions.length} interactions, ${recordedErrors} console errors, ${recordedNetworkFailures} network failures`
  );
  l(`//`);
  l(`// Workflow:`);
  l(`//   1. Run: npx playwright test --headed this-file.spec.ts`);
  l(`//      → Should fail (bug is present)`);
  l(`//   2. Fix the bug in the source code`);
  l(`//   3. Run again: npx playwright test this-file.spec.ts`);
  l(`//      → Should pass (bug is fixed)`);
  l(`//`);
  l(``);
  l(`import { test, expect } from '@playwright/test';`);
  l(``);
  l(`test('reproduce: ${escapeStr(sessionTitle)}', async ({ page }) => {`);

  const firstInteraction = interactions[0];

  if (firstInteraction) {
    l(`  await ${formatViewport(firstInteraction)};`);
  }

  const hasNavigatedAtStart =
    firstInteraction && firstInteraction.kind === "navigation";

  if (!hasNavigatedAtStart && session.target.initialUrl) {
    l(
      `  await page.goto(${JSON.stringify(escapeStr(session.target.initialUrl))}, { waitUntil: 'domcontentloaded' });`
    );
  }
  l(``);

  if (recordedErrors > 0 || recordedWarnings > 0) {
    l(`  const consoleErrors: string[] = [];`);
    l(`  const consoleWarnings: string[] = [];`);
    l(`  page.on('console', (msg) => {`);
    l(`    if (msg.type() === 'error') consoleErrors.push(msg.text());`);
    l(`    if (msg.type() === 'warning') consoleWarnings.push(msg.text());`);
    l(`  });`);
    l(``);
  }

  if (recordedNetworkFailures > 0) {
    l(`  const networkFailures: Array<{url: string; status: number}> = [];`);
    l(`  page.on('response', (res) => {`);
    l(`    if (res.status() >= 400) {`);
    l(`      networkFailures.push({ url: res.url(), status: res.status() });`);
    l(`    }`);
    l(`  });`);
    l(``);
  }

  let lastTimestamp = originEpochMs;

  for (const interaction of interactions) {
    const stepDelay = interaction.createdAt - lastTimestamp;
    if (stepDelay >= MAX_IDLE_GAP_THRESHOLD_MS) {
      l(
        `  // [Idle Gap Compressed: ${(stepDelay / 60000).toFixed(1)} min idle/sleep gap detected before this step]`
      );
    }
    if (stepDelay > 400) {
      const pacedDelay = Math.min(Math.max(Math.round(stepDelay), 300), 2500);
      l(`  await page.waitForTimeout(${pacedDelay});`);
    }
    lastTimestamp = interaction.createdAt;

    const step = formatStep(interaction, originEpochMs);
    for (const line of step) {
      l(`  ${line}`);
    }
  }

  l(``);
  l(`  // Assertions`);

  if (recordedErrors > 0) {
    l(
      `  // During recording: ${recordedErrors} console error(s) were observed`
    );
    l(`  // If the bug is fixed, replay should have fewer errors`);
    l(`  expect(consoleErrors.length).toBeLessThan(${recordedErrors});`);
  }

  if (recordedWarnings > 0) {
    l(
      `  // During recording: ${recordedWarnings} console warning(s) were observed`
    );
    l(`  expect(consoleWarnings.length).toBeLessThan(${recordedWarnings});`);
  }

  if (recordedNetworkFailures > 0) {
    l(
      `  // During recording: ${recordedNetworkFailures} network failure(s) were observed`
    );
    l(`  // If the bug is fixed, replay should have fewer failures`);
    l(
      `  expect(networkFailures.length).toBeLessThan(${recordedNetworkFailures});`
    );
  }

  if (
    recordedErrors === 0 &&
    recordedWarnings === 0 &&
    recordedNetworkFailures === 0
  ) {
    l(`  // No console errors or network failures were recorded`);
    l(`  // Add assertions here to verify the expected page state`);
    l(`  // await expect(page.locator('...')).toBeVisible();`);
  }

  l(``);
  l(`  // Capture screenshot for visual comparison`);
  l(
    `  await page.screenshot({ path: 'bug-replay-${escapeStr(sessionTitle)}.png', fullPage: true });`
  );
  l(`});`);

  return lines.join("\n");
}
