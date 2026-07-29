import assert from "node:assert/strict";
import test from "node:test";

import { Sha256, sha256 } from "../src/export/sha256.ts";

test("SHA-256 supports one-shot and chunked evidence hashing", () => {
  const encoder = new TextEncoder();
  const expected = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
  assert.equal(sha256(encoder.encode("abc")), expected);
  assert.equal(new Sha256().update(encoder.encode("a")).update(encoder.encode("b")).update(encoder.encode("c")).digestHex(), expected);
});
