import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { createEvidenceMcpServer } from "../src/server.ts";
import {
  buildRealScreenshotZipBytes,
  buildRealSessionZipBytes,
} from "./fixtures/build-fixture.ts";

test("MCP server exposes all 12 tools and 1 prompt over InMemoryTransport", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "bug-lens-mcp-e2e-"));
  try {
    const sessionZipPath = join(tempRoot, "web-bug-report-d6135e69.zip");
    const screenshotZipPath = join(
      tempRoot,
      "bug-lens-screenshot-2026-10-27.zip"
    );
    writeFileSync(sessionZipPath, buildRealSessionZipBytes());
    writeFileSync(screenshotZipPath, await buildRealScreenshotZipBytes());

    const server = createEvidenceMcpServer();
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const toolsList = await client.listTools();
    const toolNames = toolsList.tools.map((t) => t.name).sort();
    assert.deepEqual(toolNames, [
      "extract_pack",
      "get_framework_state",
      "get_interactions",
      "get_request",
      "get_scene",
      "get_screenshot",
      "open_pack",
      "query_console",
      "query_network",
      "read_pack_file",
      "search_pack",
      "timeline",
    ]);

    const promptsList = await client.listPrompts();
    assert.deepEqual(
      promptsList.prompts.map((p) => p.name),
      ["analyze_bug_report"]
    );

    const promptRes = await client.getPrompt({
      name: "analyze_bug_report",
      arguments: { pack: sessionZipPath, lang: "zh" },
    });
    assert.equal(promptRes.messages.length, 1);
    assert.match((promptRes.messages[0].content as any).text, /open_pack/);

    // Calling prompts/get without arguments (or with empty strings) must not throw -32602
    const emptyPromptRes = await client.getPrompt({
      name: "analyze_bug_report",
    });
    assert.equal(emptyPromptRes.messages.length, 1);
    assert.match(
      (emptyPromptRes.messages[0].content as any).text,
      /open_pack\(pack="<pack_path>"\)/
    );

    const blankArgsPromptRes = await client.getPrompt({
      name: "analyze_bug_report",
      arguments: { pack: "", lang: "" },
    });
    assert.equal(blankArgsPromptRes.messages.length, 1);

    // 1. open_pack (session)
    const openRes = await client.callTool({
      name: "open_pack",
      arguments: { pack: sessionZipPath },
    });
    const openText = (openRes.content as any[])[0].text;
    assert.match(openText, /Assignment Portal/);
    assert.match(openText, /勾选 Form A 的 standby 后取消勾选/);

    // 2. get_scene (with image)
    const sceneRes = await client.callTool({
      name: "get_scene",
      arguments: { pack: sessionZipPath },
    });
    const sceneBlocks = sceneRes.content as any[];
    assert.equal(sceneBlocks.length, 3);
    assert.equal(sceneBlocks[0].type, "text");
    assert.match(sceneBlocks[0].text, /ssd_a_container/);
    assert.equal(sceneBlocks[2].type, "image");
    assert.equal(sceneBlocks[2].mimeType, "image/jpeg");

    // 3. timeline
    const tlRes = await client.callTool({
      name: "timeline",
      arguments: { pack: sessionZipPath, windowMs: 15000 },
    });
    assert.match((tlRes.content as any[])[0].text, /Form A Standby/);

    // 4. query_console
    const conRes = await client.callTool({
      name: "query_console",
      arguments: { pack: sessionZipPath, levels: ["error"] },
    });
    assert.match((conRes.content as any[])[0].text, /editor\.vue:341/);

    // 5. query_network
    const netRes = await client.callTool({
      name: "query_network",
      arguments: { pack: sessionZipPath, status: "failed" },
    });
    assert.match((netRes.content as any[])[0].text, /500/);

    // 6. get_request with jsonPath
    const reqRes = await client.callTool({
      name: "get_request",
      arguments: {
        pack: sessionZipPath,
        id: "20535.366",
        jsonPath: "data.definition.form.elements[id=ssd_a]",
      },
    });
    assert.match((reqRes.content as any[])[0].text, /standby_window/);

    // 7. get_interactions
    const intRes = await client.callTool({
      name: "get_interactions",
      arguments: { pack: sessionZipPath, includeScreenshot: true },
    });
    const intBlocks = intRes.content as any[];
    assert.match(intBlocks[0].text, /AP-T4001/);
    assert.ok(intBlocks.some((b) => b.type === "image"));

    // 8. get_framework_state
    const fwRes = await client.callTool({
      name: "get_framework_state",
      arguments: { pack: sessionZipPath, component: "BpmSelectFromField" },
    });
    assert.match((fwRes.content as any[])[0].text, /BpmSelectFromFieldEditor/);

    // 9. open_pack + get_screenshot + get_scene + search_pack on screenshot pack (including omitted pack fallback)
    const openSsRes = await client.callTool({
      name: "open_pack",
      arguments: { pack: screenshotZipPath },
    });
    const openSsText = (openSsRes.content as any[])[0].text;
    assert.match(openSsText, /Layout & Overflow Diagnostics/);
    assert.match(openSsText, /CSS Cascade Index/);
    assert.match(openSsText, /word-break: keep-all/);

    // Omit `pack` argument -> should fallback to the most recently opened pack (screenshotZipPath) without -32602 error
    const ssImgRes = await client.callTool({
      name: "get_screenshot",
      arguments: { kind: "screenshot" },
    });
    assert.ok((ssImgRes.content as any[]).some((b) => b.type === "image"));
    assert.match((ssImgRes.content as any[])[0].text, /call read_file/);

    const ssSceneRes = await client.callTool({
      name: "get_scene",
      arguments: {
        selector: "submit-btn",
        cssProperty: "word-break",
        includeImage: false,
      },
    });
    assert.match((ssSceneRes.content as any[])[0].text, /common\.css/);
    assert.match((ssSceneRes.content as any[])[0].text, /word-break: keep-all/);

    const ssSearchRes = await client.callTool({
      name: "search_pack",
      arguments: { query: "keep-all" },
    });
    assert.match((ssSearchRes.content as any[])[0].text, /\[cascade-rule\]/);

    // 10. search_pack (session pack)
    const searchRes = await client.callTool({
      name: "search_pack",
      arguments: { pack: sessionZipPath, query: "STANDBY_CONFIG_MISSING" },
    });
    assert.match((searchRes.content as any[])[0].text, /network-body/);

    // 11. read_pack_file (screenshot pack dom-context.json with jsonPath)
    const readRes = await client.callTool({
      name: "read_pack_file",
      arguments: {
        pack: screenshotZipPath,
        path: "dom-context.json",
        jsonPath: "anchors[0].intentFlags.textComment",
      },
    });
    assert.match((readRes.content as any[])[0].text, /按钮点击后无反应/);

    // 12. extract_pack
    const extDir = join(tempRoot, "extracted");
    const extRes = await client.callTool({
      name: "extract_pack",
      arguments: { pack: sessionZipPath, dest: extDir },
    });
    assert.match((extRes.content as any[])[0].text, /reproduce\.spec\.ts/);

    await client.close();
    await server.close();
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("security invariant: source files do not import or invoke outbound network clients", () => {
  const srcRoot = resolve(import.meta.dirname, "../src");
  const forbidden = /\b(?:node:http|node:https|node:net|fetch\s*\()/;

  function scanDir(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(full);
      } else if (entry.name.endsWith(".ts")) {
        const content = readFileSync(full, "utf8");
        assert.equal(
          forbidden.test(content),
          false,
          `Forbidden network reference found in ${full}`
        );
      }
    }
  }

  scanDir(srcRoot);
});
