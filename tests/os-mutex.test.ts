import assert from "node:assert/strict";
import test from "node:test";
import { withOsInteractionLock } from "../e2e/fixtures/os-mutex.ts";

test("withOsInteractionLock executes action and returns result", async () => {
  const result = await withOsInteractionLock(async () => {
    return 42;
  });
  assert.equal(result, 42);
});

test("withOsInteractionLock guarantees mutual exclusion between concurrent callers", async () => {
  let inCriticalSection = 0;
  let maxConcurrency = 0;

  const runTask = async (id: number) => {
    return withOsInteractionLock(async () => {
      inCriticalSection++;
      maxConcurrency = Math.max(maxConcurrency, inCriticalSection);
      await new Promise((resolve) => setTimeout(resolve, 50));
      inCriticalSection--;
      return id;
    });
  };

  const results = await Promise.all([runTask(1), runTask(2), runTask(3)]);
  assert.deepEqual(results, [1, 2, 3]);
  assert.equal(
    maxConcurrency,
    1,
    "Concurrency in critical section must be strictly 1"
  );
  assert.equal(inCriticalSection, 0);
});

test("withOsInteractionLock releases lock even when action throws", async () => {
  await assert.rejects(
    async () => {
      await withOsInteractionLock(async () => {
        throw new Error("Intentional failure inside lock");
      });
    },
    { message: "Intentional failure inside lock" }
  );

  // Subsequent call should succeed immediately without being blocked
  const next = await withOsInteractionLock(async () => "recovered");
  assert.equal(next, "recovered");
});
