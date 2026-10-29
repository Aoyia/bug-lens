# bug-lens-mcp

[中文文档](./README_zh.md)

Model Context Protocol (MCP) server for inspecting [Bug Lens](https://github.com/Aoyia/bug-lens) offline evidence packages (`web-bug-report-*.zip`) and screenshot bundles (`bug-lens-screenshot-*.zip`).

## Why `bug-lens-mcp`?

- **Zero Ad-hoc Scripting**: Replaces 20+ manual `node -e` / `vm.runInContext` one-liners per debugging session with 4–6 structured tool calls.
- **No Untrusted Code Execution**: Parses `window.__BUG_LENS_DATA__ = {...};` and `window.__BUG_LENS_NETWORK_DETAILS__ = {...};` strictly as JSON without `eval` or `vm`.
- **In-Memory ZIP Inspection (Windows-Safe)**: Reads `.zip` archives directly in memory with an LRU cache. Avoids Windows `Expand-Archive` failures caused by `:` in Chrome request IDs (`network/body-<sessionId>:20535.366.txt`).
- **Built-in JSONPath & Token Budgeting**: Query deeply nested API responses (e.g. `data.definition.form.elements[id=ssd_a]`) and automatically truncate oversized outputs with continuation hints.

---

## Quick Setup

Requires **Node.js >= 20**.

### 1. Claude Code

```bash
claude mcp add bug-lens-evidence -- npx -y bug-lens-mcp@latest
```

### 2. Google Antigravity (`~/.gemini/config/mcp_config.json`)

```json
{
  "mcpServers": {
    "bug-lens-evidence": {
      "command": "npx",
      "args": ["-y", "bug-lens-mcp@latest"]
    }
  }
}
```

### 3. Cursor (`~/.cursor/mcp.json` or `.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "bug-lens-evidence": {
      "command": "npx",
      "args": ["-y", "bug-lens-mcp@latest"]
    }
  }
}
```

### 4. VS Code (`.vscode/mcp.json`)

```json
{
  "servers": {
    "bug-lens-evidence": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "bug-lens-mcp@latest"]
    }
  }
}
```

### 5. Companion Agent Skill (`bug-lens-triage`)

Install the companion `bug-lens-triage` skill so your agent automatically follows the deterministic triage workflow (Branch A for Screenshot Packs, Branch B for Session Packs) across all workspaces:

```bash
# Auto-detects Antigravity (~/.gemini/config/skills), Claude Code (~/.claude/skills), and Cursor (~/.cursor/skills)
npx -y bug-lens-mcp@latest install-skill

# Or install into the current project's .agents/skills/bug-lens-triage/SKILL.md
npx -y bug-lens-mcp@latest install-skill project
```

### Local Development / Monorepo Binary

If running directly from a local clone of the `bug-lens` repository:

```json
{
  "mcpServers": {
    "bug-lens-evidence": {
      "command": "node",
      "args": ["/absolute/path/to/bug-lens/packages/evidence-mcp/dist/index.js"]
    }
  }
}
```

---

## Available Tools (12)

Every tool takes `pack` (absolute path to the `.zip` archive or extracted folder) as its first argument.

| Tool                  | Description                                                                                                                                                                                                                             |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `open_pack`           | Detect pack kind (`session` or `screenshot`), verify SHA-256 manifest integrity, and return session summary, environment, issue scene actual/expected/confidence overview, top console errors, top failed requests, and file inventory. |
| `get_scene`           | Inspect an issue scene: `narrative.actual`, `narrative.expected` (with `confidence` notice), selected DOM targets (`sanitizedHtml`, ancestor chain, computed styles), `sequenceContext`, and the annotated screenshot image.            |
| `timeline`            | Merge user interactions, console warnings/errors, network requests (failures + XHR/Fetch/Document), and issue scene marks into a chronological timeline around a scene or time window.                                                  |
| `query_console`       | Filter and paginate console logs by level (`error`, `warn`, etc.), substring, regex, or relative time range (`fromMs` / `toMs`), including resolved source map locations.                                                               |
| `query_network`       | Filter network requests by status (`failed`, `4xx`, `5xx`, `2xx`, or status array), URL substring, HTTP method, or resource type. Prioritizes failed requests by default.                                                               |
| `get_request`         | Merge `networkEntries[]`, full headers & initiator stack from `data/network-details.js`, and split bodies from `network/body-*.txt`. Supports `jsonPath` extraction (e.g. `data.definition.form.elements[id=ssd_a]`).                   |
| `get_interactions`    | List recorded user interactions (`click`, `input`, `keydown`, `navigation`) with compact element selectors, input values, and optional step screenshots.                                                                                |
| `get_framework_state` | Inspect Vue/React component trees (`props`, `state`), `globalState`, and `webStorage` (`localStorage` / `sessionStorage`) snapshots by index, timestamp (`nearMs`), component name, or `path`.                                          |
| `get_screenshot`      | Return an image from the pack (`issue-annotated`, `issue-original`, `step`, or `screenshot`) as MCP image content.                                                                                                                      |
| `search_pack`         | Search for a keyword across console logs, network URLs, network response bodies, interactions, and framework state snapshots in one call.                                                                                               |
| `read_pack_file`      | Read any file inside the archive (`dom-context.json`, `cascade.json`, `environment.json`, `reproduce.spec.ts`, `AI_PROMPT.md`) with optional `jsonPath` or character pagination.                                                        |
| `extract_pack`        | Safely extract the archive to disk with zip-slip protection and Windows-safe filename sanitization (`:` replaced with `_` and `session-data.js` references updated) to run Playwright reproduction scripts.                             |

### MCP Prompt

- `analyze_bug_report(pack, lang?)`: Provides a structured first-principles debugging prompt guiding the model through `open_pack -> get_scene -> timeline -> get_request / get_framework_state`.

---

## Security & Privacy

- **Read-Only by Default**: Only `extract_pack` writes files to disk (into `os.tmpdir()/bug-lens-workspace` or a user-specified directory).
- **Zero Network Access**: The server makes no outbound HTTP/HTTPS/WebSocket requests.
- **Archive Hardening**: Enforces a 64 MB per-file and 512 MB total uncompressed limit, skips `media/*.mp4` in memory, and rejects zip-slip path traversal entries.

## License

MIT
