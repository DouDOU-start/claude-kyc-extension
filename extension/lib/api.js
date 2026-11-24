import { MAX_RESPONSE_BYTES, parseKYCStatus, parseOrganizations } from "./kyc.js";
import { proxyAuthRecord, proxyPAC } from "./proxy.js";

const AUTH_STORAGE_KEY = "claudeKycProxyAuth";
const COOKIE_RULE_ID = 9001;
const ORIGIN = "https://claude.ai";

export class RequestError extends Error {
  constructor(code, message, status = 0) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function setProxyAuth(config) {
  const auth = proxyAuthRecord(config);
  if (auth) {
    await chrome.storage.session.set({ [AUTH_STORAGE_KEY]: auth });
  } else {
    await chrome.storage.session.remove(AUTH_STORAGE_KEY);
  }
}

async function installCookieRule(sessionKey) {
  const rule = {
    id: COOKIE_RULE_ID,
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: [
        {
          header: "cookie",
          operation: "append",
          value: `sessionKey=${sessionKey}`,
        },
      ],
    },
    condition: {
      urlFilter: "||claude.ai/api/",
      resourceTypes: ["xmlhttprequest", "other"],
      tabIds: [-1],
    },
  };

  await chrome.declarativeNetRequest
    .updateSessionRules({ removeRuleIds: [COOKIE_RULE_ID] })
    .catch(() => {});
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [COOKIE_RULE_ID],
      addRules: [rule],
    });
  } catch {
    throw new RequestError(
      "browser_api",
      "浏览器无法注入 KYC 会话，请更新 Chrome 或重新加载扩展后再试。",
    );
  }
}

async function withRequestContext(sessionKey, proxyConfig, callback) {
  let proxyActive = false;
  let ruleActive = false;
  try {
    try {
      await setProxyAuth(proxyConfig);
    } catch {
      throw new RequestError("browser_api", "浏览器无法保存本次代理认证信息。");
    }
    await chrome.proxy.settings.clear({ scope: "regular" }).catch(() => {});
    if (proxyConfig) {
      try {
        await chrome.proxy.settings.set({
          value: {
            mode: "pac_script",
            pacScript: { data: proxyPAC(proxyConfig) },
          },
          scope: "regular",
        });
      } catch {
        throw new RequestError("proxy_settings", "浏览器代理设置失败，请检查代理策略。");
      }
      proxyActive = true;
    }
    await installCookieRule(sessionKey);
    ruleActive = true;
    return await callback();
  } finally {
    if (ruleActive) {
      await chrome.declarativeNetRequest
        .updateSessionRules({ removeRuleIds: [COOKIE_RULE_ID] })
        .catch(() => {});
    }
    if (proxyActive) {
      await chrome.proxy.settings.clear({ scope: "regular" }).catch(() => {});
    }
    await chrome.storage.session.remove(AUTH_STORAGE_KEY).catch(() => {});
  }
}

async function readLimitedText(response) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new RequestError("invalid_response", "Claude 返回的数据过大。");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

async function claudeRequest(sessionKey, proxyConfig, endpoint) {
  return withRequestContext(sessionKey, proxyConfig, async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 50_000);
    let response;
    try {
      response = await fetch(endpoint, {
        method: "GET",
        credentials: "omit",
        cache: "no-store",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          "accept": "application/json, text/event-stream",
          "anthropic-client-platform": "web_claude_ai",
        },
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new RequestError("timeout", "查询超时，请检查代理后重试。");
      }
      throw new RequestError(
        "network",
        proxyConfig
          ? "代理或网络连接失败，请检查代理地址和认证信息。"
          : "网络连接失败，请检查浏览器网络。",
      );
    } finally {
      clearTimeout(timeout);
    }
    if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
      throw new RequestError("auth", "Claude 会话已失效或被重定向，请重新获取 SK。", response.status);
    }
    if (response.status < 200 || response.status >= 300) {
      const challenge = response.headers.get("cf-mitigated") === "challenge";
      if (challenge) {
        throw new RequestError("challenge", "Claude 要求浏览器验证，请更换代理后重试。", response.status);
      }
      if (response.status === 401 || response.status === 403) {
        throw new RequestError("auth", "Claude 拒绝了这个 SK，请检查它是否有效或已过期。", response.status);
      }
      if (response.status === 404) {
        throw new RequestError("not_found", "Claude 未提供该组织的 KYC 状态。", response.status);
      }
      if (response.status === 429) {
        throw new RequestError("rate_limited", "查询过于频繁，请稍后重试。", response.status);
      }
      throw new RequestError("upstream", `Claude 返回 HTTP ${response.status}，暂时无法查询。`, response.status);
    }
    return readLimitedText(response);
  });
}

export async function requestOrganizations(sessionKey, proxyConfig) {
  const text = await claudeRequest(sessionKey, proxyConfig, `${ORIGIN}/api/organizations`);
  const parsed = parseOrganizations(text);
  if (!parsed.ok) throw new RequestError("invalid_response", parsed.error);
  if (parsed.value.length === 0) {
    throw new RequestError("no_organizations", "此 SK 没有可访问的 Claude 组织。");
  }
  return parsed.value;
}

export async function requestKYCStatus(sessionKey, proxyConfig, orgId, options) {
  const endpoint = new URL(`${ORIGIN}/api/organizations/${encodeURIComponent(orgId)}/kyc_status`);
  if (options.refreshSession) endpoint.searchParams.set("refresh_session", "true");
  if (options.attemptRetry) endpoint.searchParams.set("attempt_retry", "true");
  const text = await claudeRequest(sessionKey, proxyConfig, endpoint.href);
  const parsed = parseKYCStatus(text);
  if (!parsed.ok) throw new RequestError("invalid_response", parsed.error);
  return parsed.value;
}

export async function cleanupRequestState() {
  await chrome.proxy.settings.clear({ scope: "regular" }).catch(() => {});
  await chrome.declarativeNetRequest
    .updateSessionRules({ removeRuleIds: [COOKIE_RULE_ID] })
    .catch(() => {});
  await chrome.storage.session.remove(AUTH_STORAGE_KEY).catch(() => {});
}
