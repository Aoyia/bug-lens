import assert from "node:assert/strict";
import test from "node:test";
import type { TimelineEventNode } from "../src/preview/timeline-stream-view";

test("timeline stream merges interactions, console, and network in strict chronological order", () => {
  const interactions = [
    { id: "i1", createdAt: 1050, element: { tagName: "BUTTON", locators: [] }, page: { url: "http://example.com" } }
  ];
  const consoleEntries = [
    { id: "c1", createdAt: 1100, level: "error", text: "Uncaught Error" },
    { id: "c2", createdAt: 1000, level: "log", text: "App initialized" }
  ];
  const networkEntries = [
    { id: "n1", createdAt: 1020, method: "POST", url: "http://example.com/api", status: 500 }
  ];

  const nodes: TimelineEventNode[] = [];
  for (const item of interactions) nodes.push({ id: `step-${item.id}`, timestamp: item.createdAt, kind: "interaction", data: item as any });
  for (const item of consoleEntries) nodes.push({ id: `console-${item.id}`, timestamp: item.createdAt, kind: "console", data: item as any });
  for (const item of networkEntries) nodes.push({ id: `network-${item.id}`, timestamp: item.createdAt, kind: "network", data: item as any });

  nodes.sort((a, b) => a.timestamp - b.timestamp);

  assert.deepEqual(
    nodes.map((n) => ({ kind: n.kind, id: n.id, timestamp: n.timestamp })),
    [
      { kind: "console", id: "console-c2", timestamp: 1000 },
      { kind: "network", id: "network-n1", timestamp: 1020 },
      { kind: "interaction", id: "step-i1", timestamp: 1050 },
      { kind: "console", id: "console-c1", timestamp: 1100 }
    ]
  );
});
