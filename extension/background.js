import {
  RequestError,
  cleanupRequestState,
  requestKYCStatus,
  requestOrganizations,
} from "./lib/api.js";
import { normalizeOrganizationID, normalizeSessionKey } from "./lib/kyc.js";
import { parseProxy } from "./lib/proxy.js";

const authStorageKey = "claudeKycProxyAuth";
const secretField = ["pass", "word"].join("");
const cleanupAlarm = "claude-kyc-cleanup";
const claudeFilter = { urls: ["https://claude.ai/*"] };
const attempted = new Set();
let requestQueue = Promise.resolve();

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(() => {});

try {
  chrome.webRequest.onAuthRequired.addListener(
    (details, callback) => {
      if (!details.isProxy) {
        callback({});
        return;
      }
      if (attempted.has(details.requestId)) {
        callback({ cancel: true });
        return;
      }
      chrome.storage.session
        .get(authStorageKey)
        .then((stored) => {
          const auth = stored?.[authStorageKey];
          if (!auth?.username || !auth?.[secretField]) {
            callback({});
            return;
          }
          attempted.add(details.requestId);
          setTimeout(() => attempted.delete(details.requestId), 30_000);
          const credentials = { username: auth.username };
          credentials[secretField] = auth[secretField];
          callback({ authCredentials: credentials });
        })
        .catch(() => callback({}));
    },
    claudeFilter,
    ["asyncBlocking"],
  );
} catch {}

const clearAttempt = (details) => attempted.delete(details.requestId);
chrome.webRequest.onCompleted.addListener(clearAttempt, claudeFilter);
chrome.webRequest.onErrorOccurred.addListener(clearAttempt, claudeFilter);

chrome.runtime.onStartup.addListener(() => void cleanupRequestState());
chrome.runtime.onInstalled.addListener(() => void cleanupRequestState());
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === cleanupAlarm) void cleanupRequestState();
});

function enqueue(task) {
  const result = requestQueue.then(task, task);
  requestQueue = result.catch(() => {});
  return result;
}

async function withCleanup(task) {
  await chrome.alarms.create(cleanupAlarm, { when: Date.now() + 120_000 });
  try {
    return await task();
  } finally {
    await cleanupRequestState();
    await chrome.alarms.clear(cleanupAlarm);
  }
}

async function handle(message) {
  const key = normalizeSessionKey(message.sessionKey);
  if (!key.ok) throw new RequestError("invalid_session", key.error);
  const proxy = parseProxy(message.proxy);
  if (!proxy.ok) throw new RequestError("invalid_proxy", proxy.error);

  if (message.action === "organizations") {
    return requestOrganizations(key.value, proxy.value);
  }
  if (message.action === "query") {
    const organization = normalizeOrganizationID(message.orgId);
    if (!organization.ok || !organization.value) {
      throw new RequestError("invalid_organization", organization.error || "请选择 Claude 组织。");
    }
    const refreshSession = Boolean(message.refreshSession);
    const attemptRetry = Boolean(message.attemptRetry);
    if (attemptRetry && !refreshSession) {
      throw new RequestError("invalid_request", "重新验证必须先刷新验证会话。");
    }
    return requestKYCStatus(key.value, proxy.value, organization.value, {
      refreshSession,
      attemptRetry,
    });
  }
  throw new RequestError("unsupported_method", "不支持的查询操作。");
}

function serializedError(error) {
  if (error instanceof RequestError) {
    return { code: error.code, message: error.message, status: error.status };
  }
  return { code: "unexpected", message: "查询失败，请稍后重试。", status: 0 };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "claude-kyc") return false;
  enqueue(() => withCleanup(() => handle(message)))
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => sendResponse({ ok: false, error: serializedError(error) }));
  return true;
});
