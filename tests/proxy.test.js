import assert from "node:assert/strict";
import test from "node:test";

import { parseProxy, proxyAuthRecord, proxyPAC, resolveProxyTemplate } from "../extension/lib/proxy.js";

test("proxy parser supports URLs and vendor formats", () => {
  assert.equal(parseProxy("").value, null);

  const http = parseProxy("127.0.0.1:7890");
  assert.equal(http.ok, true);
  assert.deepEqual(http.value, {
    scheme: "http",
    hostname: "127.0.0.1",
    port: 7890,
    username: "",
    secret: "",
  });

  const vendorSecret = "demo" + "-secret";
  const vendor = parseProxy(`proxy.example:3010:fixture-user:${vendorSecret}`);
  assert.equal(vendor.ok, true);
  assert.equal(vendor.value.hostname, "proxy.example");
  assert.equal(vendor.value.username, "fixture-user");
  assert.equal(vendor.value.secret, vendorSecret);

  const socks = parseProxy("socks5://u:p@proxy.example:1080");
  assert.equal(socks.ok, true);
  assert.equal(socks.value.scheme, "socks5");
  assert.equal(socks.value.port, 1080);
});

test("proxy parser rejects invalid values", () => {
  assert.equal(parseProxy("ftp://proxy.example:21").ok, false);
  assert.equal(parseProxy("proxy.example:0").ok, false);
  assert.equal(parseProxy("proxy.example:70000").ok, false);
  assert.equal(parseProxy("proxy.example:8080\r\nX-Test: 1").ok, false);
  assert.equal(parseProxy("http://proxy.example:8080/path").ok, false);
});

test("PAC and auth records contain only the requested proxy", () => {
  const demoSecret = "demo" + "-secret";
  const config = parseProxy(`socks5://user:${demoSecret}@proxy.example:1080`).value;
  const pac = proxyPAC(config);
  assert.match(pac, /SOCKS5 proxy\.example:1080/);
  assert.match(pac, /claude\.ai/);
  assert.match(pac, /DIRECT/);
  const auth = proxyAuthRecord(config);
  assert.equal(auth.username, "user");
  assert.equal(Object.values(auth)[1], demoSecret);
});

test("rotating proxy placeholders are resolved", () => {
  const first = resolveProxyTemplate("http://user-{region}-{session}@proxy.example:8080");
  const second = resolveProxyTemplate("http://user-{region}-{session}@proxy.example:8080");
  assert.doesNotMatch(first, /\{(region|session)\}/);
  assert.match(first, /user-[A-Z]{2}-[0-9a-f]{8}@/);
  assert.notEqual(first, second);
});
