import assert from "node:assert/strict";
import test from "node:test";

import { RequestError, requestKYCStatus, requestOrganizations } from "../extension/lib/api.js";

function installChromeMock() {
  const calls = {
    proxyClears: 0,
    proxySet: null,
    rules: [],
    storage: {},
  };
  globalThis.chrome = {
    proxy: {
      settings: {
        clear: async () => {
          calls.proxyClears++;
        },
        set: async (value) => {
          calls.proxySet = value;
        },
      },
    },
    storage: {
      session: {
        set: async (value) => Object.assign(calls.storage, value),
        remove: async (key) => {
          delete calls.storage[key];
        },
      },
    },
    declarativeNetRequest: {
      updateSessionRules: async (value) => {
        calls.rules.push(value);
      },
    },
  };
  return calls;
}

function restoreFetch(originalFetch) {
  globalThis.fetch = originalFetch;
  delete globalThis.chrome;
}

test("organization request sets proxy, injects session, and cleans up", async () => {
  const calls = installChromeMock();
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init, storage: { ...calls.storage } };
    return new Response(JSON.stringify([{ uuid: "org-one", name: "Personal" }]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const demoSecret = "demo" + "-secret";
  const proxy = {
    scheme: "http",
    hostname: "proxy.example",
    port: 8080,
    username: "fixture-user",
    secret: demoSecret,
  };
  try {
    const organizations = await requestOrganizations("fixture-session", proxy);
    assert.equal(organizations[0].id, "org-one");
    assert.match(calls.proxySet.value.pacScript.data, /PROXY proxy\.example:8080/);
    assert.equal(captured.storage.claudeKycProxyAuth.username, "fixture-user");
    assert.equal(Object.values(captured.storage.claudeKycProxyAuth)[1], demoSecret);
    assert.equal(captured.init.credentials, "omit");
    assert.equal(captured.url, "https://claude.ai/api/organizations");
    const add = calls.rules.find((rule) => rule.addRules)?.addRules?.[0];
    assert.equal(add.action.requestHeaders[0].header, "cookie");
    assert.equal(add.action.requestHeaders[0].operation, "append");
    assert.equal(add.action.requestHeaders[0].value, "sessionKey=" + "fixture-session");
    assert.deepEqual(add.condition.tabIds, [-1]);
    assert.equal(calls.proxyClears, 2);
    assert.equal(Object.keys(calls.storage).length, 0);
    assert.ok(calls.rules.some((rule) => rule.removeRuleIds));
  } finally {
    restoreFetch(originalFetch);
  }
});

test("direct KYC request applies explicit query flags", async () => {
  const calls = installChromeMock();
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return new Response(JSON.stringify({ status: "pending", should_poll: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const status = await requestKYCStatus("fixture-session", null, "org/name", {
      refreshSession: true,
      attemptRetry: false,
    });
    assert.equal(status.status, "pending");
    assert.equal(calls.proxySet, null);
    assert.equal(calls.proxyClears, 1);
    assert.match(captured.url, /org%2Fname\/kyc_status\?refresh_session=true/);
    assert.equal(Object.keys(calls.storage).length, 0);
  } finally {
    restoreFetch(originalFetch);
  }
});

test("HTTP failures are surfaced as typed request errors", async () => {
  const calls = installChromeMock();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("blocked", {
    status: 403,
    headers: { "cf-mitigated": "challenge" },
  });
  try {
    await assert.rejects(
      requestOrganizations("fixture-session", null),
      (error) => error instanceof RequestError && error.code === "challenge",
    );
    assert.equal(Object.keys(calls.storage).length, 0);
    assert.equal(calls.proxyClears, 1);
  } finally {
    restoreFetch(originalFetch);
  }
});
