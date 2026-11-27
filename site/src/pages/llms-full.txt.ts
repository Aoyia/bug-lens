import type { APIRoute } from "astro";
import {
  PERF_BAR_METRICS,
  PERF_KPIS,
  PERF_STEP_SLICES,
} from "../data/benchmark";
import { getSiteCopy } from "../data/i18n";
import { LATEST_RELEASE, RELEASES } from "../data/releases";
import {
  CHROME_STORE_URL,
  EDGE_STORE_URL,
  GITHUB_LICENSE_URL,
  GITHUB_PRIVACY_URL,
  GITHUB_RELEASES_LATEST_URL,
  GITHUB_REPO_URL,
  SITE_NAME,
  SKILL_INSTALL_CMD,
  getLocaleUrl,
} from "../data/site";

export const prerender = true;

export const GET: APIRoute = () => {
  const en = getSiteCopy("en");
  const zh = getSiteCopy("zh");

  const lines = [
    `# ${SITE_NAME} — Full Documentation for LLMs & Search Agents`,
    "",
    `> ${en.metaDescription}`,
    "",
    "## Official Links",
    `- English Homepage: ${getLocaleUrl("en")}`,
    `- Simplified Chinese Homepage: ${getLocaleUrl("zh")}`,
    `- Chrome Web Store: ${CHROME_STORE_URL}`,
    `- Microsoft Edge Add-ons: ${EDGE_STORE_URL}`,
    `- Latest Offline ZIP Release: ${GITHUB_RELEASES_LATEST_URL}`,
    `- GitHub Repository: ${GITHUB_REPO_URL}`,
    `- Privacy Policy: ${GITHUB_PRIVACY_URL}`,
    `- License (AGPL-3.0): ${GITHUB_LICENSE_URL}`,
    "",
    "## Chinese Summary (中文摘要)",
    `- Title: ${zh.pageTitle}`,
    `- Description: ${zh.metaDescription}`,
    "",
    "## 4-Step End-to-End Debugging Workflow",
    `1. **${en.t1Title}** — ${en.t1Desc}`,
    `2. **${en.t2Title}** — ${en.t2Desc}`,
    `   Exported ZIP Archive Layout (\`${en.archiveSampleName}\`):`,
    ...en.fileTree.map((f) => `   - \`${f.name}\`: ${f.desc}`),
    `3. **${en.t3Title}** — ${en.t3Desc}`,
    `4. **${en.t4Title}** — ${en.t4Desc}`,
    "",
    "## Core Capabilities",
    ...en.capabilities.map((c) => `- **${c.title}** [${c.tag}]: ${c.desc}`),
    "",
    "## Native Rust Triage CLI & Benchmarks",
    en.skillDesc,
    ...en.skillPoints.map((p) => `- ${p}`),
    "",
    "### Installation Command",
    `- One-Step Setup: \`${SKILL_INSTALL_CMD}\` (automatically downloads and SHA-256 verifies the native binary for macOS / Linux / Windows on first run)`,
    "",
    `### Benchmark Metrics (${en.perfFootnote})`,
    ...PERF_KPIS.map(
      (k) => `- ${en.perfKpiTitles[k.id]}: ${k.initialText} (${k.sub})`
    ),
    ...PERF_BAR_METRICS.map(
      (m) =>
        `- ${en.perfMetrics[m.id].name}: Rust CLI ${m.rustVal} vs Legacy JS ${m.jsVal} (${en.perfMetrics[m.id].gain})`
    ),
    ...PERF_STEP_SLICES.map(
      (s) => `- \`${s.cmd}\` (${en.perfStepLabels[s.id]}): ${s.size}`
    ),
    `- Context Reduction: ${en.perfCtxBefore} -> ${en.perfCtxAfter}`,
    "",
    "## Frequently Asked Questions (EN)",
    ...en.faqs.flatMap((f) => [`### ${f.question}`, f.answer, ""]),
    "## 常见问题 (ZH)",
    ...zh.faqs.flatMap((f) => [`### ${f.question}`, f.answer, ""]),
    `## Release History (v${LATEST_RELEASE.version} ~ v${RELEASES[RELEASES.length - 1].version})`,
    ...RELEASES.flatMap((rel) => [
      `### v${rel.version} (${rel.date})`,
      ...rel.highlights.en.map((h) => `- **${h.title}** ${h.desc}`),
      "",
    ]),
  ];

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
};
