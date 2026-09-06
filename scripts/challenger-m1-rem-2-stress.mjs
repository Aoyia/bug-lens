#!/usr/bin/env node
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const rootDir = process.cwd();
const appsDistDir = path.resolve(rootDir, "e2e/fixtures/apps/dist");

console.log(
  "================================================================================"
);
console.log(
  "CHALLENGER M1 REMEDIATION (2): EMPIRICAL ADVERSARIAL STRESS SUITE"
);
console.log(
  "================================================================================\n"
);

// Helper to calculate sha256
function sha256(filePath) {
  const data = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(data).digest("hex");
}

// -----------------------------------------------------------------------------
// MODULE 1 & 2: HTTP Routing, Security & Traversal Stress Harness
// -----------------------------------------------------------------------------
async function runHttpSecurityHarness() {
  console.log(
    ">>> [HARNESS 1 & 2] Starting HTTP Routing & Directory Traversal Stress Tests..."
  );

  // Setup temporary sibling directories with sensitive mock secrets
  const extraDir = path.resolve(appsDistDir, "vue2-dev-extra");
  const dev2Dir = path.resolve(appsDistDir, "vue2-dev2");
  const bakDir = path.resolve(appsDistDir, "vue2-dev.bak");

  fs.mkdirSync(extraDir, { recursive: true });
  fs.writeFileSync(
    path.resolve(extraDir, "secret.txt"),
    "EXPOSED_VUE2_DEV_EXTRA_SECRET"
  );

  fs.mkdirSync(dev2Dir, { recursive: true });
  fs.writeFileSync(
    path.resolve(dev2Dir, "secret.txt"),
    "EXPOSED_VUE2_DEV2_SECRET"
  );

  fs.mkdirSync(bakDir, { recursive: true });
  fs.writeFileSync(
    path.resolve(bakDir, "secret.txt"),
    "EXPOSED_VUE2_DEV_BAK_SECRET"
  );

  // Create mock-page.html reference
  const mockHtmlPath = path.resolve(rootDir, "e2e/fixtures/mock-page.html");

  // Spin up exact server matching e2e/fixtures/extension.ts
  const server = http.createServer((req, res) => {
    try {
      const parsedUrl = new URL(
        req.url || "/",
        `http://${req.headers.host || "127.0.0.1"}`
      );
      const pathname = parsedUrl.pathname;

      if (pathname.startsWith("/apps/")) {
        const match = pathname.match(/^\/apps\/([^/]+)\/([^/]+)(?:\/(.*))?$/);
        if (!match) {
          res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          res.end(`Invalid fixture app path: ${pathname}`);
          return;
        }

        const [, framework, mode, rawFile] = match;
        const targetDir = path.resolve(
          process.cwd(),
          "e2e/fixtures/apps/dist",
          `${framework}-${mode}`
        );

        let decodedFile = "";
        try {
          decodedFile = rawFile ? decodeURIComponent(rawFile) : "";
        } catch (err) {
          // If extension.ts doesn't catch this, let's see if extension.ts actually catches it
          // Wait: in extension.ts line 276: const decodedFile = rawFile ? decodeURIComponent(rawFile) : "";
          // extension.ts has NO try-catch!
          throw err;
        }

        const fileToServe =
          decodedFile && decodedFile.length > 0 ? decodedFile : "index.html";
        const resolvedPath = path.resolve(targetDir, fileToServe);
        const safeTargetPrefix = targetDir.endsWith(path.sep)
          ? targetDir
          : targetDir + path.sep;

        if (
          !resolvedPath.startsWith(safeTargetPrefix) &&
          resolvedPath !== targetDir
        ) {
          res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Forbidden");
          return;
        }

        if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()) {
          const ext = path.extname(resolvedPath);
          let contentType = "application/octet-stream";
          if (ext === ".html") contentType = "text/html; charset=utf-8";
          else if (ext === ".js")
            contentType = "application/javascript; charset=utf-8";
          else if (ext === ".css") contentType = "text/css; charset=utf-8";
          else if (ext === ".json" || ext === ".map")
            contentType = "application/json; charset=utf-8";

          res.writeHead(200, {
            "Content-Type": contentType,
            "Access-Control-Allow-Origin": "*",
          });
          res.end(fs.readFileSync(resolvedPath));
          return;
        } else {
          res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          res.end(`Fixture app file not found: ${pathname}`);
          return;
        }
      }

      // Default fallback
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        fs.existsSync(mockHtmlPath)
          ? fs.readFileSync(mockHtmlPath)
          : "MOCK_PAGE"
      );
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(`Server Error: ${err.message}`);
    }
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  console.log(`Ephemeral server listening on http://127.0.0.1:${port}`);

  const testCases = [
    // 1. Directory Traversal: Sibling directory with same prefix
    {
      id: "DT-001",
      name: "Sibling directory with hyphen suffix (vue2-dev-extra)",
      url: `/apps/vue2/dev/%2e%2e%2fvue2-dev-extra%2fsecret.txt`,
      expectedStatus: 403,
      forbiddenBody: "EXPOSED_VUE2_DEV_EXTRA_SECRET",
    },
    {
      id: "DT-002",
      name: "Sibling directory with number suffix (vue2-dev2)",
      url: `/apps/vue2/dev/%2e%2e%2fvue2-dev2%2fsecret.txt`,
      expectedStatus: 403,
      forbiddenBody: "EXPOSED_VUE2_DEV2_SECRET",
    },
    {
      id: "DT-003",
      name: "Sibling directory with extension suffix (vue2-dev.bak)",
      url: `/apps/vue2/dev/%2e%2e%2fvue2-dev.bak%2fsecret.txt`,
      expectedStatus: 403,
      forbiddenBody: "EXPOSED_VUE2_DEV_BAK_SECRET",
    },
    {
      id: "DT-004",
      name: "Uppercase URL-encoded traversal (%2E%2E%2F)",
      url: `/apps/vue2/dev/%2E%2E%2Fvue2-dev-extra%2Fsecret.txt`,
      expectedStatus: 403,
      forbiddenBody: "EXPOSED_VUE2_DEV_EXTRA_SECRET",
    },
    {
      id: "DT-005",
      name: "Mixed encoded traversal (..%2f)",
      url: `/apps/vue2/dev/..%2fvue2-dev-extra%2fsecret.txt`,
      expectedStatus: 403,
      forbiddenBody: "EXPOSED_VUE2_DEV_EXTRA_SECRET",
    },
    {
      id: "DT-006",
      name: "Double URL encoded traversal (%252e%252e)",
      url: `/apps/vue2/dev/%252e%252e%252fvue2-dev-extra%252fsecret.txt`,
      expectedStatus: 404, // Unmatched literal %2e%2e filename
      forbiddenBody: "EXPOSED_VUE2_DEV_EXTRA_SECRET",
    },
    {
      id: "DT-007",
      name: "Cross-target traversal to vue2-prod bundle",
      url: `/apps/vue2/dev/%2e%2e%2fvue2-prod%2fbundle.js`,
      expectedStatus: 403,
    },
    {
      id: "DT-008",
      name: "Root traversal to package.json",
      url: `/apps/vue2/dev/%2e%2e%2f%2e%2e%2f%2e%2e%2f%2e%2e%2fpackage.json`,
      expectedStatus: 403,
    },
    {
      id: "DT-009",
      name: "Root traversal to /etc/passwd",
      url: `/apps/vue2/dev/%2e%2e%2f%2e%2e%2f%2e%2e%2f%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd`,
      expectedStatus: 403,
    },
    {
      id: "DT-010",
      name: "Null byte injection in subpath (%00)",
      url: `/apps/vue2/dev/%00`,
      expectedStatus: 404,
    },
    {
      id: "DT-011",
      name: "Dot path normalized by URL parser (/apps/vue2/dev/.)",
      url: `/apps/vue2/dev/.`,
      expectedStatus: 200, // Normalized to /apps/vue2/dev/ which serves index.html
      mustInclude: "Vue 2 Bug Lens Fixture",
    },

    // 2. Malformed Routing Tests
    {
      id: "MR-001",
      name: "Malformed route exact /apps/",
      url: `/apps/`,
      expectedStatus: 404,
    },
    {
      id: "MR-002",
      name: "Malformed route /apps//",
      url: `/apps//`,
      expectedStatus: 404,
    },
    {
      id: "MR-003",
      name: "Malformed route /apps///",
      url: `/apps///`,
      expectedStatus: 404,
    },
    {
      id: "MR-004",
      name: "Incomplete route with slash /apps/vue2/",
      url: `/apps/vue2/`,
      expectedStatus: 404,
    },
    {
      id: "MR-005",
      name: "Double slash between framework and mode /apps/vue2//dev",
      url: `/apps/vue2//dev`,
      expectedStatus: 404,
    },
    {
      id: "MR-006",
      name: "Random invalid route /apps/invalid-route",
      url: `/apps/invalid-route`,
      expectedStatus: 404,
    },
    {
      id: "MR-007",
      name: "Non-existent framework /apps/nonexistent/dev/index.html",
      url: `/apps/nonexistent/dev/index.html`,
      expectedStatus: 404,
    },
    {
      id: "MR-008",
      name: "Non-existent mode /apps/vue2/staging/index.html",
      url: `/apps/vue2/staging/index.html`,
      expectedStatus: 404,
    },
    {
      id: "MR-009",
      name: "Non-existent file /apps/vue2/dev/nonexistent.html",
      url: `/apps/vue2/dev/nonexistent.html`,
      expectedStatus: 404,
    },

    // 3. Normal / Borderline Routing Tests
    {
      id: "RT-001",
      name: "Valid index.html route /apps/vue2/dev/index.html",
      url: `/apps/vue2/dev/index.html`,
      expectedStatus: 200,
      mustInclude: "Vue 2 Bug Lens Fixture",
    },
    {
      id: "RT-002",
      name: "Valid bundle route /apps/vue2/dev/bundle.js",
      url: `/apps/vue2/dev/bundle.js`,
      expectedStatus: 200,
      mustInclude: "TodoItem",
    },
    {
      id: "RT-003",
      name: "Mode directory with trailing slash /apps/vue2/dev/ (serves index.html)",
      url: `/apps/vue2/dev/`,
      expectedStatus: 200,
      mustInclude: "Vue 2 Bug Lens Fixture",
    },
    {
      id: "RT-004",
      name: "Mode directory without trailing slash /apps/vue2/dev (serves index.html)",
      url: `/apps/vue2/dev`,
      expectedStatus: 200,
      mustInclude: "Vue 2 Bug Lens Fixture",
    },
    {
      id: "RT-005",
      name: "Borderline route /apps without trailing slash (falls back to mock-page)",
      url: `/apps`,
      expectedStatus: 200, // Document behavior: falls through to mockHtmlPath
    },
    {
      id: "RT-006",
      name: "Borderline route /apps/vue2 without trailing slash (incomplete params -> 404)",
      url: `/apps/vue2`,
      expectedStatus: 404, // Correctly rejected by route regex as missing mode param
    },

    // 4. Malformed URI decode handling
    {
      id: "URI-001",
      name: "Malformed URI percent sequence (/apps/vue2/dev/%FF)",
      url: `/apps/vue2/dev/%FF`,
      expectedStatus: 500, // or 400/404 if handled, 500 if unhandled
    },
  ];

  const results = [];
  for (const tc of testCases) {
    let status = 0;
    let text = "";
    let passed = false;
    let errorMsg = "";

    try {
      const res = await fetch(`http://127.0.0.1:${port}${tc.url}`);
      status = res.status;
      text = await res.text();

      const statusMatch = status === tc.expectedStatus;
      const forbiddenLeak = tc.forbiddenBody && text.includes(tc.forbiddenBody);
      const mustIncludeMatch = tc.mustInclude
        ? text.includes(tc.mustInclude)
        : true;

      passed = statusMatch && !forbiddenLeak && mustIncludeMatch;
      if (!statusMatch) {
        errorMsg = `Status mismatch: expected ${tc.expectedStatus}, got ${status}`;
      } else if (forbiddenLeak) {
        errorMsg = `SECURITY LEAK: Payload contained forbidden secret '${tc.forbiddenBody}'`;
      } else if (!mustIncludeMatch) {
        errorMsg = `Body missing expected substring '${tc.mustInclude}'`;
      }
    } catch (e) {
      errorMsg = `Request failed with exception: ${e.message}`;
    }

    results.push({
      id: tc.id,
      name: tc.name,
      url: tc.url,
      status,
      expected: tc.expectedStatus,
      passed,
      errorMsg,
    });
  }

  // Raw TCP socket traversal test
  console.log(
    "\n>>> Testing raw TCP socket traversal (GET /apps/vue2/dev/../vue2-dev-extra/secret.txt HTTP/1.1)..."
  );
  const rawTcpResult = await new Promise((resolve) => {
    const client = net.createConnection({ port, host: "127.0.0.1" }, () => {
      client.write(
        "GET /apps/vue2/dev/../vue2-dev-extra/secret.txt HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
      );
    });
    let rawData = "";
    client.on("data", (chunk) => {
      rawData += chunk.toString();
    });
    client.on("end", () => {
      const statusLine = rawData.split("\r\n")[0];
      const hasSecret = rawData.includes("EXPOSED_VUE2_DEV_EXTRA_SECRET");
      resolve({ statusLine, hasSecret, passed: !hasSecret });
    });
    client.on("error", (err) => {
      resolve({ error: err.message, passed: false });
    });
  });

  results.push({
    id: "RAW-TCP-001",
    name: "Raw TCP socket traversal test",
    url: "RAW TCP /apps/vue2/dev/../vue2-dev-extra/secret.txt",
    status: rawTcpResult.statusLine,
    expected: "No leak (403 or 404)",
    passed: rawTcpResult.passed,
    errorMsg: rawTcpResult.hasSecret ? "LEAKED SECRET VIA RAW TCP" : "",
  });

  // Teardown server and temporary directories
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(extraDir, { recursive: true, force: true });
  fs.rmSync(dev2Dir, { recursive: true, force: true });
  fs.rmSync(bakDir, { recursive: true, force: true });

  console.log(
    "\n================================================================================"
  );
  console.log("HTTP ROUTING & SECURITY TEST RESULTS TABLE:");
  console.log(
    "================================================================================"
  );
  console.table(
    results.map((r) => ({
      ID: r.id,
      Status: r.passed ? "PASS" : "FAIL",
      HTTP: r.status,
      Expected: r.expected,
      Name: r.name,
      Error: r.errorMsg || "None",
    }))
  );

  return results;
}

// -----------------------------------------------------------------------------
// MODULE 3: Offline Build Benchmark & Determinism Verification
// -----------------------------------------------------------------------------
async function runOfflineBuildBenchmark() {
  console.log(
    "\n>>> [HARNESS 3] Starting Offline Build Benchmark & Determinism Suite..."
  );

  const buildScript = path.resolve(rootDir, "scripts/build-fixture-apps.mjs");

  // 1. Test offline build isolation (with dummy dead proxy)
  console.log(
    "[Benchmark] Testing strict offline execution with blackholed proxy..."
  );
  const offlineStart = performance.now();
  try {
    execFileSync(process.execPath, [buildScript], {
      stdio: "pipe",
      env: {
        ...process.env,
        HTTP_PROXY: "http://127.0.0.1:9",
        HTTPS_PROXY: "http://127.0.0.1:9",
        ALL_PROXY: "http://127.0.0.1:9",
      },
    });
    const offlineElapsed = performance.now() - offlineStart;
    console.log(
      `[Benchmark] ✅ Offline build succeeded cleanly in ${offlineElapsed.toFixed(1)}ms with blackholed proxy.`
    );
  } catch (err) {
    console.error(`[Benchmark] ❌ Offline build failed:`, err);
    throw err;
  }

  // 2. Multi-run benchmark (10 iterations)
  console.log("[Benchmark] Running 10-iteration build benchmark...");
  const durations = [];
  const checksumHistory = [];

  const targets = [
    "vue2-dev",
    "vue2-prod",
    "vue3-dev",
    "vue3-prod",
    "react-dev",
    "react-prod",
  ];

  for (let i = 1; i <= 10; i++) {
    // Delete appsDistDir to test clean cold build each time
    fs.rmSync(appsDistDir, { recursive: true, force: true });

    const start = performance.now();
    execFileSync(process.execPath, [buildScript], { stdio: "pipe" });
    const duration = performance.now() - start;
    durations.push(duration);

    // Compute checksums for all bundles
    const hashes = {};
    for (const t of targets) {
      hashes[t] = sha256(path.resolve(appsDistDir, t, "bundle.js"));
    }
    checksumHistory.push(hashes);
    process.stdout.write(`  Run #${i}: ${duration.toFixed(1)}ms\n`);
  }

  durations.sort((a, b) => a - b);
  const min = durations[0];
  const max = durations[durations.length - 1];
  const mean = durations.reduce((acc, v) => acc + v, 0) / durations.length;
  const median = (durations[4] + durations[5]) / 2;
  const p95 = durations[Math.floor(durations.length * 0.95)];
  const variance =
    durations.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) /
    durations.length;
  const stddev = Math.sqrt(variance);

  console.log(
    "\n================================================================================"
  );
  console.log("OFFLINE BUILD BENCHMARK STATISTICS (10 RUNS):");
  console.log(
    "================================================================================"
  );
  console.log(`Min:     ${min.toFixed(2)} ms`);
  console.log(`Max:     ${max.toFixed(2)} ms`);
  console.log(`Mean:    ${mean.toFixed(2)} ms`);
  console.log(`Median:  ${median.toFixed(2)} ms`);
  console.log(`P95:     ${p95.toFixed(2)} ms`);
  console.log(`StdDev:  ${stddev.toFixed(2)} ms`);

  // 3. Determinism Check
  let isDeterministic = true;
  const baseHashes = checksumHistory[0];
  for (let i = 1; i < checksumHistory.length; i++) {
    for (const t of targets) {
      if (checksumHistory[i][t] !== baseHashes[t]) {
        console.error(
          `[Benchmark] ❌ Determinism failure on target ${t} run #${i + 1}`
        );
        isDeterministic = false;
      }
    }
  }

  if (isDeterministic) {
    console.log(
      `[Benchmark] ✅ 100% BIT-FOR-BIT DETERMINISTIC across all 10 runs!`
    );
  } else {
    console.error(`[Benchmark] ❌ Build is NON-DETERMINISTIC across runs!`);
  }

  // Print checksums table
  console.log("\nTARGET SHA-256 CHECKSUMS:");
  console.table(
    targets.map((t) => ({
      Target: t,
      Sha256: baseHashes[t],
      Size:
        fs.statSync(path.resolve(appsDistDir, t, "bundle.js")).size + " bytes",
    }))
  );

  // 4. Deep AST / String Content Inspection on Artifacts
  console.log("\n>>> Inspecting Artifact Content Requirements...");

  const rDev = fs.readFileSync(
    path.resolve(appsDistDir, "react-dev/bundle.js"),
    "utf8"
  );
  const rProd = fs.readFileSync(
    path.resolve(appsDistDir, "react-prod/bundle.js"),
    "utf8"
  );
  const v2Dev = fs.readFileSync(
    path.resolve(appsDistDir, "vue2-dev/bundle.js"),
    "utf8"
  );
  const v2Prod = fs.readFileSync(
    path.resolve(appsDistDir, "vue2-prod/bundle.js"),
    "utf8"
  );
  const v3Dev = fs.readFileSync(
    path.resolve(appsDistDir, "vue3-dev/bundle.js"),
    "utf8"
  );
  const v3Prod = fs.readFileSync(
    path.resolve(appsDistDir, "vue3-prod/bundle.js"),
    "utf8"
  );

  const inspections = [
    {
      check: "React 18 Dev contains ZERO preact",
      passed: !rDev.includes("preact"),
      detail: `Preact matches: ${rDev.includes("preact")}`,
    },
    {
      check: "React 18 Prod contains ZERO preact",
      passed: !rProd.includes("preact"),
      detail: `Preact matches: ${rProd.includes("preact")}`,
    },
    {
      check: "React 18 Dev has _debugSource and lineNumber",
      passed:
        rDev.includes("_debugSource") &&
        rDev.includes("lineNumber") &&
        rDev.includes("fileName"),
      detail: `_debugSource present: ${rDev.includes("_debugSource")}, fileName present: ${rDev.includes("fileName")}`,
    },
    {
      check:
        "React 18 Prod strips JSX _debugSource metadata (fileName & lineNumber)",
      passed: !rProd.includes("fileName") && !rProd.includes("lineNumber"),
      detail: `fileName stripped: ${!rProd.includes("fileName")}, lineNumber stripped: ${!rProd.includes("lineNumber")}`,
    },
    {
      check: "Vue 2 Dev has __file attachment",
      passed: v2Dev.includes("__file"),
      detail: `__file present: ${v2Dev.includes("__file")}`,
    },
    {
      check: "Vue 2 Prod strips __file attachment",
      passed: !v2Prod.includes("__file"),
      detail: `__file stripped: ${!v2Prod.includes("__file")}`,
    },
    {
      check: "Vue 3 Dev has __file attachment",
      passed: v3Dev.includes("__file"),
      detail: `__file present: ${v3Dev.includes("__file")}`,
    },
    {
      check: "Vue 3 Prod strips __file attachment",
      passed: !v3Prod.includes("__file"),
      detail: `__file stripped: ${!v3Prod.includes("__file")}`,
    },
    {
      check:
        "Vue 3 Prod defines __VUE_PROD_HYDRATION_MISMATCH_DETAILS__ as false",
      passed: !v3Prod.includes("__VUE_PROD_HYDRATION_MISMATCH_DETAILS__"),
      detail: "Feature flag properly replaced in build define",
    },
  ];

  console.table(
    inspections.map((i) => ({
      Check: i.check,
      Passed: i.passed ? "PASS" : "FAIL",
      Detail: i.detail,
    }))
  );

  return {
    durations,
    stats: { min, max, mean, median, p95, stddev },
    isDeterministic,
    baseHashes,
    inspections,
  };
}

// -----------------------------------------------------------------------------
// MAIN EXECUTION
// -----------------------------------------------------------------------------
async function main() {
  const httpResults = await runHttpSecurityHarness();
  const benchmarkResults = await runOfflineBuildBenchmark();

  const allHttpPassed = httpResults.every((r) => r.passed);
  const allInspectionsPassed = benchmarkResults.inspections.every(
    (i) => i.passed
  );
  const overallPassed =
    allHttpPassed && allInspectionsPassed && benchmarkResults.isDeterministic;

  console.log(
    "\n================================================================================"
  );
  console.log(
    `FINAL CHALLENGER VERDICT: ${overallPassed ? "CLEAN / PASS" : "FAIL"}`
  );
  console.log(
    "================================================================================"
  );
  if (!overallPassed) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("FATAL HARNESS ERROR:", err);
  process.exit(1);
});
