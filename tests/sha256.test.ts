import assert from "node:assert/strict";
import test from "node:test";

import { Sha256, sha256, sha256Sync } from "../src/export/sha256.ts";

const encoder = new TextEncoder();

test("SHA-256 supports one-shot and chunked evidence hashing", async () => {
  const expected =
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
  assert.equal(await sha256(encoder.encode("abc")), expected);
  assert.equal(sha256Sync(encoder.encode("abc")), expected);
  assert.equal(
    new Sha256()
      .update(encoder.encode("a"))
      .update(encoder.encode("b"))
      .update(encoder.encode("c"))
      .digestHex(),
    expected
  );
});

test("SHA-256 empty string matches NIST standard vector", async () => {
  const expected =
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  assert.equal(await sha256(new Uint8Array(0)), expected);
  assert.equal(sha256Sync(new Uint8Array(0)), expected);
});

test("SHA-256 handles input crossing 64-byte block boundary", async () => {
  // "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq" — NIST one-block test
  const input = "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq";
  const expected =
    "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1";
  assert.equal(await sha256(encoder.encode(input)), expected);

  // Chunked — feed one byte at a time to stress block boundary logic
  const hasher = new Sha256();
  for (const char of input) hasher.update(encoder.encode(char));
  assert.equal(hasher.digestHex(), expected);
});

test("SHA-256 async and sync produce identical results for arbitrary input", async () => {
  const input = encoder.encode("bug-lens evidence integrity check");
  const asyncResult = await sha256(input);
  const syncResult = sha256Sync(input);
  assert.equal(asyncResult, syncResult);
  assert.match(asyncResult, /^[a-f0-9]{64}$/);
});

test("SHA-256 state copy on init avoids mutated array reference risks", () => {
  const hasher1 = new Sha256();
  const hasher2 = new Sha256();
  hasher1.update(encoder.encode("test payload 1"));
  hasher2.update(encoder.encode("test payload 2"));
  assert.notEqual(hasher1.digestHex(), hasher2.digestHex());
});

test("SHA-256 rejects update after finalization", () => {
  const hasher = new Sha256();
  hasher.update(encoder.encode("data"));
  hasher.digestHex();
  assert.throws(
    () => hasher.update(encoder.encode("more")),
    /SHA256_ALREADY_FINALIZED/
  );
});
