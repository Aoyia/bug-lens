import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeSourcePath,
  extractSnippetWindow,
} from "../src/sourcemap/internal/source-snippet-slicer.js";

describe("SourceSnippetSlicer", () => {
  describe("normalizeSourcePath", () => {
    test("strips webpack protocol prefixes", () => {
      assert.equal(
        normalizeSourcePath("webpack://_N_E/./src/components/Button.tsx"),
        "src/components/Button.tsx"
      );
    });

    test("strips vite protocol prefixes and @fs paths", () => {
      assert.equal(
        normalizeSourcePath("vite://app/src/App.vue"),
        "src/App.vue"
      );
      assert.equal(
        normalizeSourcePath("/@fs/Users/name/proj/src/main.ts"),
        "Users/name/proj/src/main.ts"
      );
    });

    test("handles null or undefined cleanly", () => {
      assert.equal(normalizeSourcePath(null), "unknown");
      assert.equal(normalizeSourcePath(undefined), "unknown");
      assert.equal(normalizeSourcePath(""), "unknown");
    });
  });

  describe("extractSnippetWindow", () => {
    const sampleCode = [
      "import { useState } from 'react';",
      "export function Counter() {",
      "  const [count, setCount] = useState(0);",
      "  const onClick = () => {",
      "    // target error line (line 5)",
      "    throw new Error('Boom');",
      "  };",
      "  return <button onClick={onClick}>{count}</button>;",
      "}",
    ].join("\n");

    test("extracts snippet correctly around target line", () => {
      const snippet = extractSnippetWindow(
        sampleCode,
        6, // line 6: throw new Error
        "src/Counter.tsx",
        11,
        2, // 2 lines before
        2 // 2 lines after
      );

      assert.ok(snippet);
      assert.equal(snippet.sourceFile, "src/Counter.tsx");
      assert.equal(snippet.startLine, 4);
      assert.equal(snippet.errorLine, 6);
      assert.equal(snippet.highlightColumn, 11);
      assert.equal(snippet.lines.length, 5);
      assert.equal(snippet.lines[0], "  const onClick = () => {");
      assert.equal(snippet.lines[2], "    throw new Error('Boom');");
    });

    test("clamps safely at top boundary", () => {
      const snippet = extractSnippetWindow(
        sampleCode,
        1,
        "src/Counter.tsx",
        1,
        5,
        2
      );
      assert.ok(snippet);
      assert.equal(snippet.startLine, 1);
      assert.equal(snippet.errorLine, 1);
      assert.equal(snippet.lines[0], "import { useState } from 'react';");
    });

    test("returns undefined on empty input or out-of-range line", () => {
      assert.equal(extractSnippetWindow(null, 1, "src/Counter.tsx"), undefined);
      assert.equal(extractSnippetWindow("", 1, "src/Counter.tsx"), undefined);
      assert.equal(
        extractSnippetWindow(sampleCode, 999, "src/Counter.tsx"),
        undefined
      );
    });
  });
});
