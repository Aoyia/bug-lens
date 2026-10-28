import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createEvidenceMcpServer } from "./server.ts";

async function main(): Promise<void> {
  const server = createEvidenceMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  const message =
    err instanceof Error ? (err.stack ?? err.message) : String(err);
  process.stderr.write(`[bug-lens-mcp] Fatal error: ${message}\n`);
  process.exit(1);
});
