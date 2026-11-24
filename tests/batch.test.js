import assert from "node:assert/strict";
import test from "node:test";

import { batchPriority, maskSK, parseBatchInput } from "../extension/lib/batch.js";

test("batch input accepts newline/comma separators and removes duplicates", () => {
  const parsed = parseBatchInput("first-session\nsecond-session, first-session");
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.value, ["first-session", "second-session"]);
});

test("batch input rejects empty and invalid values", () => {
  assert.equal(parseBatchInput("  ").ok, false);
  assert.equal(parseBatchInput("valid\nbad key").ok, false);
  assert.equal(parseBatchInput("a,b,c", 2).ok, false);
});

test("KYC status priority prefers completed results", () => {
  assert.ok(batchPriority("verified") > batchPriority("not_required"));
  assert.ok(batchPriority("pending") > batchPriority("failed"));
  assert.ok(batchPriority("failed") > batchPriority("unknown"));
});

test("SK masking keeps only short prefixes and suffixes", () => {
  assert.equal(maskSK("abcdefghijklmnop"), "abcdef…mnop");
  assert.equal(maskSK("short"), "sho…rt");
});
