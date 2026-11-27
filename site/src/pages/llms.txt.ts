import type { APIRoute } from "astro";
import { getSiteCopy } from "../data/i18n";
import { LATEST_RELEASE } from "../data/releases";
import {
  CHROME_STORE_URL,
  EDGE_STORE_URL,
  GITHUB_PRIVACY_URL,
  GITHUB_REPO_URL,
  SITE_NAME,
  SKILL_INSTALL_CMD,
  UNIX_CLI_INSTALL_CMD,
  absoluteUrl,
  getLocaleUrl,
} from "../data/site";

export const prerender = true;

export const GET: APIRoute = () => {
  const en = getSiteCopy("en");
  const latestEn = LATEST_RELEASE.highlights.en;

  const lines = [
    `# ${SITE_NAME}`,
    "",
    `> 100% local Chrome/Edge Manifest V3 extension (v${LATEST_RELEASE.version}, AGPL-3.0) that captures browser click trails, DOM/styles, Vue 2/3 & React component source/state, console stacks, network payloads, and video — exporting structured AI prompts and offline evidence ZIP packs in 3 seconds.`,
    "",
    `- Canonical Website (English): ${getLocaleUrl("en")}`,
    `- Simplified Chinese Website: ${getLocaleUrl("zh")}`,
    `- Full Machine-Readable Docs: ${absoluteUrl("/llms-full.txt")}`,
    `- Chrome Web Store: ${CHROME_STORE_URL}`,
    `- Microsoft Edge Add-ons: ${EDGE_STORE_URL}`,
    `- Source Repository: ${GITHUB_REPO_URL}`,
    `- Privacy Policy: ${GITHUB_PRIVACY_URL}`,
    "",
    "## Core Capabilities",
    ...en.capabilities.map((c) => `- **${c.title}** (${c.tag}): ${c.desc}`),
    "",
    "## 4-Step Workflow",
    `1. ${en.t1Title}: ${en.t1Desc}`,
    `2. ${en.t2Title}: ${en.t2Desc}`,
    `3. ${en.t3Title}: ${en.t3Desc}`,
    `4. ${en.t4Title}: ${en.t4Desc}`,
    "",
    "## Optional Native Rust Triage CLI (`bug-lens-triage`)",
    `- Install Skill: \`${SKILL_INSTALL_CMD}\``,
    `- Install Native Binary (macOS / Linux): \`${UNIX_CLI_INSTALL_CMD}\``,
    `- Benchmark (${en.perfFootnote}): open_pack RSS 56.3 MB vs 186.8 MB (-70% RAM); query_network 13.5 ms vs 57.2 ms (4.2x faster); timeline 15.8 ms vs 54.2 ms (3.4x faster); query_network RSS 20.6 MB vs 79.3 MB (-74% RAM); context filtered from 6.20 MB JSON down to 24.5 KB (-99.6%).`,
    "",
    `## Latest Release (v${LATEST_RELEASE.version} · ${LATEST_RELEASE.date})`,
    ...latestEn.map((h) => `- **${h.title}** ${h.desc}`),
    "",
  ];

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
};
