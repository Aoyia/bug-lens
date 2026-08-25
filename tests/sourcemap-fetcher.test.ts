import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { SourceMapFetcher } from "../src/sourcemap/internal/sourcemap-fetcher.js";

describe("SourceMapFetcher", () => {
  test("extracts sourceMappingURL correctly from code comments", () => {
    const code = "console.log('hi');\n//# sourceMappingURL=app.js.map";
    assert.equal(SourceMapFetcher.extractSourceMappingUrl(code), "app.js.map");

    const deprecatedSyntax =
      "console.log('hi');\n//@ sourceMappingURL=app.js.map";
    assert.equal(
      SourceMapFetcher.extractSourceMappingUrl(deprecatedSyntax),
      "app.js.map"
    );
  });

  test("resolves relative and absolute map URLs correctly", () => {
    const resolved = SourceMapFetcher.resolveMapUrl(
      "https://example.com/assets/app.js",
      "app.js.map"
    );
    assert.equal(resolved, "https://example.com/assets/app.js.map");
  });

  test("parses inline base64 data URIs correctly", async () => {
    const rawMap = JSON.stringify({
      version: 3,
      sources: ["test.ts"],
      mappings: "",
    });
    const b64 = Buffer.from(rawMap).toString("base64");
    const dataUri = `data:application/json;base64,${b64}`;

    const res = await SourceMapFetcher.fetchMap(dataUri);
    assert.equal(res.success, true);
    if (res.success) {
      assert.equal(res.mapData.version, 3);
      assert.deepEqual(res.mapData.sources, ["test.ts"]);
    }
  });
});
