import assert from "node:assert/strict";
import test from "node:test";

import {
  actionOptions,
  formatTime,
  isComplete,
  isFailed,
  KYC_LINK_MS,
  linkSeconds,
  mergeKYC,
  normalizeOrganizationID,
  normalizeSessionKey,
  parseKYCStatus,
  parseOrganizations,
  statusLabel,
  statusTone,
  vendorURL,
} from "../extension/lib/kyc.js";

test("status labels and tones keep unknown values incomplete", () => {
  assert.equal(statusLabel("verified"), "已验证");
  assert.equal(statusLabel("not_required"), "无需验证");
  assert.equal(statusLabel("surprise"), "尚未完成");
  assert.equal(isComplete("verified"), true);
  assert.equal(isComplete("pending"), false);
  assert.equal(isFailed("expired"), true);
  assert.equal(statusTone("denied"), "danger");
  assert.equal(statusTone("pending"), "pending");
});

test("session key accepts Claude web values and rejects header injection", () => {
  assert.deepEqual(normalizeSessionKey("  sk-ant-sid01.example-value \n"), {
    ok: true,
    value: "sk-ant-sid01.example-value",
  });
  assert.equal(normalizeSessionKey("").ok, false);
  assert.equal(normalizeSessionKey("value\nnext").ok, false);
  assert.equal(normalizeSessionKey("value;other").ok, false);
  assert.equal(normalizeSessionKey("value\\other").ok, false);
});

test("organization IDs are optional and reject whitespace", () => {
  assert.deepEqual(normalizeOrganizationID("  "), { ok: true, value: "" });
  assert.deepEqual(normalizeOrganizationID(" org-123 "), { ok: true, value: "org-123" });
  assert.equal(normalizeOrganizationID("has spaces").ok, false);
  assert.equal(normalizeOrganizationID("x".repeat(129)).ok, false);
});

test("verification URLs must be HTTPS without embedded credentials", () => {
  const url = new URL(vendorURL("https://inquiry.withpersona.com/verify?inquiry-id=one"));
  assert.equal(url.protocol, "https:");
  assert.equal(url.hostname, "inquiry.withpersona.com");
  assert.equal(url.searchParams.get("inquiry-id"), "one");
  assert.equal(url.searchParams.get("language"), "zh");
  assert.equal(vendorURL("http://inquiry.withpersona.com/verify"), "");
  assert.equal(vendorURL("https://user@inquiry.withpersona.com/verify"), "");
  assert.equal(vendorURL("javascript:alert(1)"), "");
});

test("newer completed status wins, older completion is retained", () => {
  const verified = {
    status: "verified",
    updated_at: "2026-11-20T10:00:00Z",
  };
  const olderPending = {
    status: "pending",
    updated_at: "2026-11-19T10:00:00Z",
  };
  assert.equal(mergeKYC(verified, olderPending).result.status, "verified");
  assert.equal(mergeKYC(verified, olderPending).ignored, true);
  const newerPending = {
    status: "pending",
    updated_at: "2026-11-21T10:00:00Z",
  };
  assert.equal(mergeKYC(verified, newerPending).result.status, "pending");
});

test("actions request verification links only when explicit", () => {
  assert.deepEqual(actionOptions("status"), { refreshSession: false, attemptRetry: false });
  assert.deepEqual(actionOptions("refresh"), { refreshSession: true, attemptRetry: false });
  assert.deepEqual(actionOptions("retry"), { refreshSession: true, attemptRetry: true });
});

test("link countdown and local formatting are stable", () => {
  assert.equal(linkSeconds(1000 + KYC_LINK_MS, 1000), 60);
  assert.equal(linkSeconds(1000, 2000), 0);
  assert.match(formatTime("2026-11-20T10:00:00Z"), /2026/);
});

test("organization responses are validated and deduplicated", () => {
  const parsed = parseOrganizations(`[
    {"uuid":"org-one","name":"Personal"},
    {"uuid":"org-two","name":"Team"},
    {"uuid":"org-one","name":"Duplicate"}
  ]`);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.length, 2);
  assert.equal(parsed.value[1].name, "Team");
  assert.equal(parseOrganizations(`{"uuid":"org"}`).ok, false);
  assert.equal(parseOrganizations(`[{"uuid":"has spaces"}]`).ok, false);
});

test("KYC responses reject unknown malformed payloads", () => {
  const pending = parseKYCStatus(`{
    "status":"pending",
    "should_poll":true,
    "vendor_inquiry_url":"https://inquiry.withpersona.com/verify?inquiry-id=one"
  }`);
  assert.equal(pending.ok, true);
  assert.equal(pending.value.should_poll, true);

  const complete = parseKYCStatus(`{
    "status":"verified",
    "should_poll":true,
    "vendor_inquiry_url":"https://inquiry.withpersona.com/verify?inquiry-id=one"
  }`);
  assert.equal(complete.value.should_poll, false);
  assert.equal(complete.value.vendor_inquiry_url, "");
  assert.equal(parseKYCStatus(`{"status":""}`).ok, false);
  assert.equal(parseKYCStatus(`{"status":"pending","should_poll":"true"}`).ok, false);
  assert.equal(parseKYCStatus(`<html></html>`).ok, false);
});
