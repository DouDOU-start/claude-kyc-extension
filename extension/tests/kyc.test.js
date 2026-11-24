import assert from "node:assert/strict";
import test from "node:test";

import {
  actionOptions,
  formatTime,
  hostErrorMessage,
  isComplete,
  isFailed,
  KYC_LINK_MS,
  linkSeconds,
  mergeKYC,
  normalizeProxy,
  normalizeOrganizationID,
  normalizeSessionKey,
  statusLabel,
  statusTone,
  vendorURL,
} from "../lib/kyc.js";

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

test("proxy validation permits vendor formats and blocks line breaks", () => {
  assert.deepEqual(normalizeProxy(" host:8080:user:demo "), {
    ok: true,
    value: "host:8080:user:demo",
  });
  assert.equal(normalizeProxy("").ok, true);
  assert.equal(normalizeProxy("host:8080\r\nX-Test: 1").ok, false);
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

test("host errors are translated without leaking raw values", () => {
  assert.match(hostErrorMessage("host_missing"), /install\.ps1/);
  assert.equal(hostErrorMessage("unknown", "friendly"), "friendly");
});
