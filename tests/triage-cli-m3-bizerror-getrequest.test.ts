import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { zipSync, strToU8 } from "fflate";
import { runTriageCli } from "../src/triage-cli/cli.ts";
import { clearPackCache } from "../src/triage-cli/pack/open.ts";
import {
  detectBusinessError,
  formatNetworkRow,
  queryNetwork,
} from "../src/triage-cli/query/network.ts";
import {
  formatRequestBodySnippet,
  resolveNetworkRequestBody,
  runGetRequestTool,
} from "../src/triage-cli/tools/get-request.ts";
import { runQueryNetworkTool } from "../src/triage-cli/tools/query-network.ts";

test("resolveNetworkRequestBody: respects fallback priority chain", () => {
  // 1. details.requestBody takes top priority
  assert.equal(
    resolveNetworkRequestBody(
      { requestBody: "entry_body" },
      { requestBody: "details_body", postData: "details_post" }
    ),
    "details_body"
  );

  // 2. details.postData takes next priority
  assert.equal(
    resolveNetworkRequestBody(
      { requestBody: "entry_body" },
      { postData: "details_post" }
    ),
    "details_post"
  );

  // 3. entry.requestBody (top-level) takes next priority
  assert.equal(
    resolveNetworkRequestBody(
      {
        requestBody: "entry_req_body",
        postData: "entry_post",
        request: { postData: "req_post" },
      },
      {}
    ),
    "entry_req_body"
  );

  // 4. entry.postData takes next priority
  assert.equal(
    resolveNetworkRequestBody(
      { postData: "entry_post", request: { postData: "req_post" } },
      {}
    ),
    "entry_post"
  );

  // 5. entry.request.postData
  assert.equal(
    resolveNetworkRequestBody(
      { request: { postData: "req_post", body: "req_body" } },
      undefined
    ),
    "req_post"
  );

  // 6. entry.request.body
  assert.equal(
    resolveNetworkRequestBody({ request: { body: "req_body" } }, undefined),
    "req_body"
  );

  // 7. Object with text property (HAR / CDP shape)
  assert.equal(
    resolveNetworkRequestBody(
      { request: { postData: { text: "har_text" } } },
      undefined
    ),
    "har_text"
  );

  // 8. Empty HAR text object { text: "" } returns undefined rather than stringified object
  assert.equal(
    resolveNetworkRequestBody(
      { request: { postData: { text: "" } } },
      undefined
    ),
    undefined
  );
  assert.equal(
    resolveNetworkRequestBody(
      { request: { postData: { text: "", mimeType: "application/json" } } },
      undefined
    ),
    undefined
  );

  // 9. Empty / missing returns undefined
  assert.equal(resolveNetworkRequestBody({}, {}), undefined);
});

test("formatRequestBodySnippet: pretty-prints JSON up to 4000 characters and safely truncates", () => {
  // Normal JSON formatting
  const rawJson = JSON.stringify({ action: "approve", ids: [1, 2, 3] });
  const formatted = formatRequestBodySnippet(rawJson, 4000);
  assert.equal(
    formatted,
    JSON.stringify({ action: "approve", ids: [1, 2, 3] }, null, 2)
  );

  // Non-JSON string
  const plainText = "param1=val1&param2=val2";
  assert.equal(formatRequestBodySnippet(plainText, 4000), plainText);

  // Truncation when exceeding maxChars
  const largeObj: Record<string, string> = {};
  for (let i = 0; i < 300; i++) {
    largeObj[`field_${i}`] = "some long string value to exceed 4000 chars";
  }
  const largeJson = JSON.stringify(largeObj);
  const truncated = formatRequestBodySnippet(largeJson, 100);
  assert.ok(truncated.length <= 160);
  assert.match(truncated, /JSON request body truncated at 100 chars/);

  // Non-JSON string truncation
  const longText = "x".repeat(500);
  const truncatedText = formatRequestBodySnippet(longText, 50);
  assert.match(truncatedText, /Request body truncated at 50 chars/);
});

test("detectBusinessError: identifies business failure markers in HTTP 200 responses", () => {
  // 1. success === false
  const r1 = detectBusinessError(
    JSON.stringify({ success: false, code: 500, message: "RPC timeout" })
  );
  assert.equal(r1.isBizError, true);
  assert.equal(r1.code, 500);
  assert.equal(r1.message, "RPC timeout");

  // 2. isSuccess === false
  const r2 = detectBusinessError(
    JSON.stringify({ isSuccess: false, errCode: "PARAM_INVALID" })
  );
  assert.equal(r2.isBizError, true);
  assert.equal(r2.code, "PARAM_INVALID");

  // 3. result === false
  const r3 = detectBusinessError(
    JSON.stringify({ result: false, msg: "Operation failed" })
  );
  assert.equal(r3.isBizError, true);
  assert.equal(r3.message, "Operation failed");

  // 4. Abnormal non-zero code
  const r4 = detectBusinessError(
    JSON.stringify({ code: 40001, errorMsg: "Token expired" })
  );
  assert.equal(r4.isBizError, true);
  assert.equal(r4.code, 40001);
  assert.equal(r4.message, "Token expired");

  // 5. String error codes (including errorCode / errCode / code)
  const r5 = detectBusinessError(
    JSON.stringify({ code: "AUTH_DENIED", msg: "Access denied" })
  );
  assert.equal(r5.isBizError, true);
  assert.equal(r5.code, "AUTH_DENIED");

  const r5b = detectBusinessError(
    JSON.stringify({ errorCode: "USER_NOT_FOUND" })
  );
  assert.equal(r5b.isBizError, true);
  assert.equal(r5b.code, "USER_NOT_FOUND");

  const r5c = detectBusinessError(JSON.stringify({ errCode: "NO_PERMISSION" }));
  assert.equal(r5c.isBizError, true);
  assert.equal(r5c.code, "NO_PERMISSION");

  const r5d = detectBusinessError(JSON.stringify({ code: "TIMEOUT" }));
  assert.equal(r5d.isBizError, true);
  assert.equal(r5d.code, "TIMEOUT");

  const r5e = detectBusinessError(JSON.stringify({ code: "NOT_FOUND" }));
  assert.equal(r5e.isBizError, true);
  assert.equal(r5e.code, "NOT_FOUND");

  const r5f = detectBusinessError(JSON.stringify({ retCode: -1 }));
  assert.equal(r5f.isBizError, true);
  assert.equal(r5f.code, -1);

  // 6. Exception or error presence
  const r6 = detectBusinessError(
    JSON.stringify({ error: "STANDBY_CONFIG_MISSING", field: "ssd_a" })
  );
  assert.equal(r6.isBizError, true);
  assert.equal(r6.message, "STANDBY_CONFIG_MISSING");

  // 7. Common success codes should NOT be marked as error
  const s1 = detectBusinessError(JSON.stringify({ code: 200, data: {} }));
  assert.equal(s1.isBizError, false);

  const s2 = detectBusinessError(
    JSON.stringify({ code: 0, message: "ok", result: { list: [] } })
  );
  assert.equal(s2.isBizError, false);

  const s3 = detectBusinessError(
    JSON.stringify({ status: "ok", success: true })
  );
  assert.equal(s3.isBizError, false);

  const s4 = detectBusinessError(JSON.stringify({ retCode: "0000" }));
  assert.equal(s4.isBizError, false);

  const s5 = detectBusinessError(JSON.stringify({ retCode: "000000" }));
  assert.equal(s5.isBizError, false);

  // 8. Non-JSON input
  const nonJson = detectBusinessError("<html><body>OK</body></html>");
  assert.equal(nonJson.isBizError, false);

  // 9. Heuristic regex fallback for broken JSON
  const brokenJson = '{"success": false, "code": 503, "data": ';
  const rHeuristic = detectBusinessError(brokenJson);
  assert.equal(rHeuristic.isBizError, true);
  assert.equal(rHeuristic.code, "503");

  const brokenJsonErrCode = '{"errorCode": "USER_NOT_FOUND", "data": ';
  const rHeuristicErrCode = detectBusinessError(brokenJsonErrCode);
  assert.equal(rHeuristicErrCode.isBizError, true);
  assert.equal(rHeuristicErrCode.code, "USER_NOT_FOUND");

  const brokenJsonSuccess = '{"code": 200, "data": [{"id": 1';
  const rHeuristicSuccess = detectBusinessError(brokenJsonSuccess);
  assert.equal(rHeuristicSuccess.isBizError, false);
});

test("formatNetworkRow: formats business error with status [BIZ_ERR: code=...]", () => {
  const rowNormal = {
    id: "req-1",
    relativeMs: 1200,
    method: "POST",
    status: 200,
    durationMs: 45,
    type: "xhr",
    url: "https://example.com/api/test",
    hasBody: true,
    isFailure: false,
  };
  assert.match(formatNetworkRow(rowNormal), /POST 200 \(45ms\)/);

  const rowBizErr = {
    id: "req-2",
    relativeMs: 1500,
    method: "POST",
    status: 200,
    durationMs: 80,
    type: "xhr",
    url: "https://example.com/api/approval",
    hasBody: true,
    isFailure: true,
    isBizError: true,
    bizErrorCode: 500,
    bizErrorMessage: "Internal RPC error",
  };
  const rowStr = formatNetworkRow(rowBizErr);
  assert.match(rowStr, /POST 200 \[BIZ_ERR: code=500\] \(80ms\)/);
  assert.match(rowStr, /\(bizError: Internal RPC error\)/);
});

function createMockSessionZip(): Uint8Array {
  const sessionData = {
    id: "m3-test-session",
    schemaVersion: 5,
    extensionVersion: "0.7.41",
    target: {
      initialUrl: "https://example.com/app",
      environment: {},
    },
    timeline: { startedAtEpochMs: 1700000000000, durationMs: 10000 },
    interactions: [],
    consoleEntries: [],
    networkEntries: [
      {
        id: "req-post-body-only",
        method: "POST",
        url: "https://example.com/api/save",
        status: 200,
        createdAt: 1700000001000,
        durationMs: 65,
        type: "fetch",
        // Top-level entry.requestBody (no details map entry)
        requestBody: JSON.stringify({ user: "alice", role: "admin" }),
        response: {
          mimeType: "application/json",
          body: JSON.stringify({ code: 0, msg: "ok" }),
          bodyStatus: "captured",
        },
      },
      {
        id: "req-biz-err-500",
        method: "POST",
        url: "https://example.com/api/submit-order",
        status: 200,
        createdAt: 1700000002000,
        durationMs: 120,
        type: "xhr",
        response: {
          mimeType: "application/json",
          body: JSON.stringify({
            success: false,
            code: 500,
            message: "Insufficient inventory",
          }),
          bodyStatus: "captured",
        },
      },
      {
        id: "req-normal-200",
        method: "GET",
        url: "https://example.com/api/user-info",
        status: 200,
        createdAt: 1700000003000,
        durationMs: 30,
        type: "xhr",
        response: {
          mimeType: "application/json",
          body: JSON.stringify({ code: 200, data: { name: "alice" } }),
          bodyStatus: "captured",
        },
      },
    ],
    issueScenes: [],
  };

  const manifest = {
    format: "bug-lens-evidence-pack",
    schemaVersion: 5,
    packMode: "ai-minimal",
    createdAt: new Date().toISOString(),
    session: {
      id: "m3-test-session",
      startedAtEpochMs: 1700000000000,
      durationMs: 10000,
    },
    files: {},
  };

  const sessionJs = `window.__BUG_LENS_SESSION__ = ${JSON.stringify(sessionData)};`;

  return zipSync({
    "manifest.json": strToU8(JSON.stringify(manifest)),
    "data/session-data.js": strToU8(sessionJs),
  });
}

test("E2E CLI: get_request with --include body decouples from headers and extracts top-level requestBody", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "bug-lens-m3-req-"));
  try {
    clearPackCache();
    const zipPath = join(tempRoot, "pack.zip");
    writeFileSync(zipPath, createMockSessionZip());

    // 1. open_pack
    runTriageCli(["open_pack", zipPath]);

    // 2. get_request with --include body ONLY (headers NOT included)
    const bodyOnlyOutput = runTriageCli([
      "get_request",
      "req-post-body-only",
      "--include",
      "body",
    ]);

    // Request body MUST be displayed even though headers was not requested
    assert.match(bodyOnlyOutput, /## Request Body/);
    assert.match(bodyOnlyOutput, /"user": "alice"/);
    assert.match(bodyOnlyOutput, /"role": "admin"/);

    // Headers MUST NOT be present
    assert.doesNotMatch(bodyOnlyOutput, /## Request Headers/);

    // 3. get_request in JSON mode includes resolvedRequestBody
    const jsonOutput = JSON.parse(
      runTriageCli(["get_request", "req-post-body-only", "--format", "json"])
    );
    assert.ok(jsonOutput.resolvedRequestBody);
    assert.match(jsonOutput.resolvedRequestBody, /"user":\s*"alice"/);
  } finally {
    clearPackCache();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("E2E CLI: query_network with --bizError and --status biz_error filters HTTP 200 business failures", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "bug-lens-m3-biz-"));
  try {
    clearPackCache();
    const zipPath = join(tempRoot, "pack.zip");
    writeFileSync(zipPath, createMockSessionZip());

    runTriageCli(["open_pack", zipPath]);

    // 1. Filter by --bizError
    const bizOut = runTriageCli(["query_network", "--bizError"]);
    assert.match(bizOut, /req-biz-err-500/);
    assert.match(bizOut, /200 \[BIZ_ERR: code=500\]/);
    assert.match(bizOut, /bizError: Insufficient inventory/);
    // Normal 200 should NOT be matched
    assert.doesNotMatch(bizOut, /req-normal-200/);

    // 2. Filter by --status biz_error
    const statusBizOut = runTriageCli([
      "query_network",
      "--status",
      "biz_error",
    ]);
    assert.match(statusBizOut, /req-biz-err-500/);
    assert.match(statusBizOut, /200 \[BIZ_ERR: code=500\]/);
    assert.doesNotMatch(statusBizOut, /req-normal-200/);

    // 3. Timeline should format network status column with [BIZ_ERR: code=500]
    const tlOut = runTriageCli(["timeline", "--includeAllNetwork", "true"]);
    assert.match(tlOut, /200 \[BIZ_ERR: code=500\]/);

    // 4. JSON format output includes isBizError, bizErrorCode, bizErrorMessage
    const jsonOut = JSON.parse(
      runTriageCli(["query_network", "--bizError", "--format", "json"])
    );
    assert.equal(jsonOut.matchedCount, 1);
    const item = jsonOut.items[0];
    assert.equal(item.id, "req-biz-err-500");
    assert.equal(item.isBizError, true);
    assert.equal(item.bizErrorCode, 500);
    assert.equal(item.bizErrorMessage, "Insufficient inventory");

    // 5. Filter by --bizCode 500 alone (without --bizError) MUST NOT leak normal requests
    const bizCodeOnlyOut = runTriageCli(["query_network", "--bizCode", "500"]);
    assert.match(bizCodeOnlyOut, /# Network Requests \(matched 1 of 3 total/);
    assert.match(bizCodeOnlyOut, /req-biz-err-500/);
    assert.doesNotMatch(bizCodeOnlyOut, /req-normal-200/);
    assert.doesNotMatch(bizCodeOnlyOut, /req-post-body-only/);
  } finally {
    clearPackCache();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("queryNetwork: --bizCode alone filters out normal 200 and HTTP failures without matching bizCode", () => {
  const pack = {
    getNetworkEntries: () => [
      {
        id: "req-err-500",
        status: 200,
        url: "http://test/err500",
        createdAt: 1000,
      },
      {
        id: "req-err-user",
        status: 200,
        url: "http://test/errUser",
        createdAt: 2000,
      },
      { id: "req-ok", status: 200, url: "http://test/ok", createdAt: 3000 },
      {
        id: "req-404",
        status: 404,
        url: "http://test/notfound",
        createdAt: 4000,
      },
    ],
    getNetworkBody: (e: any) => {
      if (e.id === "req-err-500")
        return JSON.stringify({ success: false, code: 500 });
      if (e.id === "req-err-user")
        return JSON.stringify({ errorCode: "USER_NOT_FOUND" });
      if (e.id === "req-ok") return JSON.stringify({ code: 0, data: {} });
      return "";
    },
    toRelativeMs: () => 0,
    toEpochMs: () => 0,
    getNetworkDetails: () => ({}),
  };

  const res500 = queryNetwork(pack as any, { bizCode: "500" });
  assert.equal(res500.matchedCount, 1);
  assert.deepEqual(
    res500.items.map((i) => i.id),
    ["req-err-500"]
  );

  const resUserNotFound = queryNetwork(pack as any, {
    bizCode: "user_not_found",
  });
  assert.equal(resUserNotFound.matchedCount, 1);
  assert.deepEqual(
    resUserNotFound.items.map((i) => i.id),
    ["req-err-user"]
  );
});
