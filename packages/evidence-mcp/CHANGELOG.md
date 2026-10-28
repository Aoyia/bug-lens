# Changelog

## 0.1.0 (2026-10-27)

- Initial release of `bug-lens-mcp`.
- Added 12 tools (`open_pack`, `get_scene`, `timeline`, `query_console`, `query_network`, `get_request`, `get_interactions`, `get_framework_state`, `get_screenshot`, `search_pack`, `read_pack_file`, `extract_pack`) and `analyze_bug_report` MCP prompt.
- Implemented safe in-memory ZIP inspection without `eval`/`vm`, SHA-256 manifest verification, JSONPath extraction, and Windows-safe filename sanitization.
