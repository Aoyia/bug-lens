import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { TraceMappingEngine } from "../src/sourcemap/internal/trace-mapping-engine.js";

describe("TraceMappingEngine", () => {
  // A minimal valid source map v3
  const sampleMap = {
    version: 3,
    file: "bundle.js",
    sources: ["webpack://app/src/components/MyButton.tsx"],
    sourcesContent: [
      "export function MyButton() {\n  const click = () => {\n    throw new Error('fail');\n  };\n  return <button onClick={click}>Press</button>;\n}",
    ],
    names: ["MyButton", "click", "Error"],
    // mappings mapping compiled line 1 to original line 3
    mappings:
      "AAAA,SAASA,QAAT,GAAmB;EACjB,MAAMC,KAAK,GAAG,MAAM;IAClB,MAAM,IAAIC,KAAJ,CAAU,MAAV,CAAN;EACD,CAFD;EAGA,OAAO,mCAAP;AACD",
  };

  test("resolves compiled line and column to original typescript source", () => {
    const engine = new TraceMappingEngine(sampleMap);
    const result = engine.resolve(3, 11);

    assert.equal(result.resolved, true);
    assert.equal(result.originalFile, "src/components/MyButton.tsx");
    assert.equal(result.originalLine, 3);
    assert.ok(result.sourceSnippet);
    assert.equal(result.sourceSnippet.errorLine, 3);
    assert.equal(result.sourceSnippet.lines[2], "    throw new Error('fail');");
  });

  test("handles out of bounds gracefully with failureReason", () => {
    const engine = new TraceMappingEngine(sampleMap);
    const result = engine.resolve(999, 1);
    assert.equal(result.resolved, false);
    assert.equal(result.failureReason, "NO_MAPPING");
  });

  test("accepts JSON string input", () => {
    const engine = new TraceMappingEngine(JSON.stringify(sampleMap));
    const result = engine.resolve(3, 11);
    assert.equal(result.resolved, true);
    assert.equal(result.originalFile, "src/components/MyButton.tsx");
  });
});
