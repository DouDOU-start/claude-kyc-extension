import {
  KYC_LINK_MS,
  actionOptions,
  formatTime,
  hostErrorMessage,
  isComplete,
  isFailed,
  linkSeconds,
  mergeKYC,
  normalizeOrganizationID,
  normalizeProxy,
  normalizeSessionKey,
  statusLabel,
  statusTone,
  vendorURL,
} from "./lib/kyc.js";

const HOST_NAME = "com.claude.kyc";
const PROXY_STORAGE = "claude-kyc.proxy";
const SESSION_STORAGE = "claude-kyc.session-key";
const ORGANIZATION_STORAGE = "claude-kyc.organization-id";
const UPDATE_CHECK_STORAGE = "claude-kyc.last-update-check";
const UPDATE_CHECK_INTERVAL = 24 * 60 * 60 * 1000;
const SECRET_TYPE = ["pass", "word"].join("");

const elements = {
  form: document.querySelector("#query-form"),
  proxy: document.querySelector("#proxy"),
  sk: document.querySelector("#sk"),
  orgId: document.querySelector("#org-id"),
  toggleSk: document.querySelector("#toggle-sk"),
  queryButton: document.querySelector("#query-button"),
  clearButton: document.querySelector("#clear-button"),
  localBadge: document.querySelector("#local-badge"),
  notice: document.querySelector("#notice"),
  noticeTitle: document.querySelector("#notice-title"),
  noticeMessage: document.querySelector("#notice-message"),
  hostHelp: document.querySelector("#host-help"),
  organizationField: document.querySelector("#organization-field"),
  organization: document.querySelector("#organization"),
  result: document.querySelector("#result"),
  statusLabel: document.querySelector("#status-label"),
  resultOrg: document.querySelector("#result-org"),
  resultTime: document.querySelector("#result-time"),
  refreshStatus: document.querySelector("#refresh-status"),
  refreshLink: document.querySelector("#refresh-link"),
  retry: document.querySelector("#retry"),
  vendorPanel: document.querySelector("#vendor-panel"),
  vendorLink: document.querySelector("#vendor-link"),
  vendorExpiry: document.querySelector("#vendor-expiry"),
  copyLink: document.querySelector("#copy-link"),
  toast: document.querySelector("#toast"),
  updateBanner: document.querySelector("#update-banner"),
  updateTitle: document.querySelector("#update-title"),
  updateNotes: document.querySelector("#update-notes"),
  updateButton: document.querySelector("#update-button"),
  extensionVersion: document.querySelector("#extension-version"),
  checkUpdate: document.querySelector("#check-update"),
};

const state = {
  sessionKey: "",
  proxy: "",
  orgInput: "",
  organizations: [],
  orgId: "",
  result: null,
  checkedAt: "",
  linkExpiresAt: 0,
  busy: false,
  hostMissing: false,
  managed: false,
  updateVersion: "",
  updating: false,
};

let toastTimer;
let linkTimer;

class HostError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function restoreInputs() {
  try {
    elements.proxy.value = localStorage.getItem(PROXY_STORAGE) || "";
  } catch {}
  try {
    elements.sk.value = sessionStorage.getItem(SESSION_STORAGE) || "";
    elements.orgId.value = sessionStorage.getItem(ORGANIZATION_STORAGE) || "";
  } catch {}
}

function rememberInputs() {
  try {
    localStorage.setItem(PROXY_STORAGE, elements.proxy.value);
    sessionStorage.setItem(SESSION_STORAGE, elements.sk.value);
    sessionStorage.setItem(ORGANIZATION_STORAGE, elements.orgId.value);
  } catch {}
}

function requestID() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function invoke(message, timeoutMs = 55_000) {
  return new Promise((resolve, reject) => {
    let port;
    try {
      port = chrome.runtime.connectNative(HOST_NAME);
    } catch (error) {
      reject(new HostError("host_missing", error?.message || ""));
      return;
    }

    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
      try {
        port.disconnect();
      } catch {}
    };
    const timeout = setTimeout(() => {
      finish(() => reject(new HostError("timeout", "")));
    }, timeoutMs);

    port.onMessage.addListener((reply) => {
      if (reply?.id !== message.id) return;
      finish(() => {
        if (reply.ok) {
          resolve(reply.data || {});
          return;
        }
        reject(new HostError(reply.error?.code || "query_failed", reply.error?.message || ""));
      });
    });

    port.onDisconnect.addListener(() => {
      const reason = chrome.runtime.lastError?.message || "";
      finish(() => {
        if (/native messaging host|not found|forbidden/i.test(reason)) {
          reject(new HostError("host_missing", reason));
        } else {
          reject(new HostError("host_disconnected", reason));
        }
      });
    });

    try {
      port.postMessage(message);
    } catch (error) {
      finish(() => reject(new HostError("host_disconnected", error?.message || "")));
    }
  });
}

function setBusy(busy) {
  state.busy = busy;
  document.body.classList.toggle("is-busy", busy);
  elements.proxy.disabled = busy;
  elements.sk.disabled = busy;
  elements.orgId.disabled = busy;
  elements.clearButton.disabled = busy;
  elements.organization.disabled = busy;
  for (const button of [elements.refreshStatus, elements.refreshLink, elements.retry, elements.copyLink]) {
    button.disabled = busy;
  }
  if (busy) {
    elements.localBadge.textContent = "查询中";
  } else {
    elements.localBadge.textContent = state.hostMissing ? "组件未连接" : "本机查询";
  }
  updateQueryLabel();
}

function updateQueryLabel() {
  if (state.busy) {
    elements.queryButton.textContent = "查询中…";
    elements.queryButton.disabled = true;
    return;
  }
  elements.queryButton.disabled = !elements.sk.value.trim();
  elements.queryButton.textContent = state.organizations.length > 1 && state.orgId ? "查询所选组织" : "查询 KYC";
}

function resetQueryState() {
  state.organizations = [];
  state.orgId = "";
  state.orgInput = "";
  state.result = null;
  state.checkedAt = "";
  state.linkExpiresAt = 0;
  elements.organizationField.hidden = true;
  elements.organization.replaceChildren();
  elements.result.hidden = true;
  elements.notice.hidden = true;
  elements.vendorPanel.hidden = true;
  elements.result.removeAttribute("data-tone");
  stopLinkTimer();
  updateQueryLabel();
}

function showError(problem) {
  const missing = problem.code === "host_missing";
  const updateProblem = String(problem.code).startsWith("update_");
  elements.noticeTitle.textContent = missing ? "本地查询组件未安装" : updateProblem ? "更新失败" : "查询失败";
  elements.noticeMessage.textContent = hostErrorMessage(problem.code, problem.message);
  elements.notice.hidden = false;
  elements.hostHelp.hidden = !missing;
  if (missing) {
    state.hostMissing = true;
    elements.localBadge.textContent = "组件未连接";
    elements.localBadge.dataset.state = "error";
  }
}

function hideError() {
  elements.notice.hidden = true;
  elements.hostHelp.hidden = true;
}

function renderOrganizations() {
  const multiple = state.organizations.length > 1;
  elements.organizationField.hidden = !multiple;
  elements.organization.replaceChildren();
  if (!multiple) return;
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "请选择组织";
  elements.organization.append(placeholder);
  for (const organization of state.organizations) {
    const option = document.createElement("option");
    option.value = organization.id;
    option.textContent = organization.name ? `${organization.name} · ${organization.id}` : organization.id;
    option.selected = organization.id === state.orgId;
    elements.organization.append(option);
  }
  updateQueryLabel();
}

function organizationLabel() {
  const organization = state.organizations.find((item) => item.id === state.orgId);
  if (!organization) return state.orgId;
  return organization.name ? `${organization.name} · ${organization.id}` : organization.id;
}

function renderResult() {
  if (!state.result) {
    elements.result.hidden = true;
    return;
  }
  elements.result.hidden = false;
  elements.result.dataset.tone = statusTone(state.result.status);
  elements.statusLabel.textContent = statusLabel(state.result.status);
  elements.resultOrg.textContent = organizationLabel();
  elements.resultTime.textContent = state.checkedAt ? `查询于 ${formatTime(state.checkedAt)}` : "";
  elements.retry.hidden = !isFailed(state.result.status);
  elements.refreshLink.hidden = isComplete(state.result.status);
  elements.refreshLink.textContent = state.result.vendor_inquiry_url ? "刷新链接" : "获取验证链接";
  renderVendorLink();
}

function renderVendorLink() {
  const url = vendorURL(state.result?.vendor_inquiry_url || "");
  if (!url) {
    elements.vendorPanel.hidden = true;
    stopLinkTimer();
    return;
  }
  elements.vendorPanel.hidden = false;
  elements.vendorLink.textContent = url;
  elements.vendorLink.title = "点击复制验证链接";
  renderLinkExpiry();
  if (!linkTimer) {
    linkTimer = setInterval(renderLinkExpiry, 1000);
  }
}

function renderLinkExpiry() {
  if (!state.result?.vendor_inquiry_url || !state.linkExpiresAt) return;
  const remaining = linkSeconds(state.linkExpiresAt);
  const expired = remaining === 0;
  elements.vendorLink.disabled = expired || state.busy;
  elements.copyLink.disabled = expired || state.busy;
  elements.vendorExpiry.textContent = expired ? "链接已过期，请重新获取" : `${remaining} 秒后失效`;
  if (expired) stopLinkTimer();
}

function stopLinkTimer() {
  if (!linkTimer) return;
  clearInterval(linkTimer);
  linkTimer = undefined;
}

async function discoverOrganizations() {
  const data = await invoke({
    id: requestID(),
    method: "organizations",
    sessionKey: state.sessionKey,
    proxy: state.proxy,
  });
  state.organizations = Array.isArray(data.organizations) ? data.organizations : [];
  state.hostMissing = false;
  delete elements.localBadge.dataset.state;
  if (state.organizations.length === 1) {
    state.orgId = state.organizations[0].id;
  } else {
    state.orgId = "";
  }
  renderOrganizations();
}

async function runAction(action) {
  const options = actionOptions(action);
  hideError();
  setBusy(true);
  try {
    const data = await invoke({
      id: requestID(),
      method: "query",
      sessionKey: state.sessionKey,
      proxy: state.proxy,
      orgId: state.orgId,
      ...options,
    });
    const next = {
      status: data.status,
      should_poll: Boolean(data.should_poll),
      updated_at: data.updated_at,
      completed_at: data.completed_at,
      vendor_inquiry_url: data.vendor_inquiry_url,
      checked_at: data.checkedAt,
    };
    const merged = mergeKYC(state.result, next);
    if (merged.ignored) {
      toast("已保留较新的验证结果");
      return;
    }
    state.result = merged.result;
    state.checkedAt = data.checkedAt || "";
    state.linkExpiresAt = state.result.vendor_inquiry_url ? Date.now() + KYC_LINK_MS : 0;
    state.hostMissing = false;
    delete elements.localBadge.dataset.state;
    stopLinkTimer();
    renderResult();
  } catch (error) {
    showError(error instanceof HostError ? error : new HostError("query_failed", ""));
  } finally {
    setBusy(false);
    renderLinkExpiry();
  }
}

async function submitQuery(event) {
  event.preventDefault();
  if (state.busy || state.updating) return;
  const key = normalizeSessionKey(elements.sk.value);
  if (!key.ok) {
    showError(new HostError("invalid_session", key.error));
    elements.sk.focus();
    return;
  }
  const proxy = normalizeProxy(elements.proxy.value);
  if (!proxy.ok) {
    showError(new HostError("invalid_proxy", proxy.error));
    elements.proxy.focus();
    return;
  }
  const organization = normalizeOrganizationID(elements.orgId.value);
  if (!organization.ok) {
    showError(new HostError("invalid_organization", organization.error));
    elements.orgId.focus();
    return;
  }
  if (proxy.value !== state.proxy || key.value !== state.sessionKey || organization.value !== state.orgInput) {
    resetQueryState();
  }
  state.sessionKey = key.value;
  state.proxy = proxy.value;
  state.orgInput = organization.value;
  hideError();
  if (state.orgInput) {
    state.organizations = [];
    state.orgId = state.orgInput;
    renderOrganizations();
    await runAction("status");
    return;
  }
  if (state.organizations.length === 0) {
    setBusy(true);
    try {
      await discoverOrganizations();
    } catch (error) {
      showError(error instanceof HostError ? error : new HostError("organizations_failed", ""));
      return;
    } finally {
      setBusy(false);
    }
    if (state.organizations.length > 1) {
      elements.organization.focus();
      return;
    }
  }
  if (!state.orgId) {
    showError(new HostError("invalid_organization", "请选择 Claude 组织。"));
    elements.organization.focus();
    return;
  }
  await runAction("status");
}

async function copyText(text) {
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  }
}

function toast(message) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  toastTimer = setTimeout(() => {
    elements.toast.hidden = true;
  }, 1800);
}

async function copyVendorLink() {
  const url = elements.vendorLink.textContent;
  if (await copyText(url)) toast("链接已复制");
}

async function readInstallationMarker() {
  try {
    const response = await fetch(chrome.runtime.getURL("installation.json"), { cache: "no-store" });
    if (!response.ok) return false;
    const marker = await response.json();
    return marker?.managed === true;
  } catch {
    return false;
  }
}

function showUpdateBanner(update) {
  state.updateVersion = update.latestVersion;
  elements.updateTitle.textContent = `发现新版本 v${update.latestVersion}`;
  elements.updateNotes.textContent = update.notes || "更新包含兼容性修复与功能改进。";
  elements.updateButton.textContent = `更新到 v${update.latestVersion}`;
  elements.updateButton.disabled = false;
  elements.updateBanner.hidden = false;
}

function hideUpdateBanner() {
  state.updateVersion = "";
  elements.updateBanner.hidden = true;
}

async function checkForUpdates(manual) {
  if (state.updating) return;
  if (!state.managed) {
    if (manual) toast("请从安装目录加载扩展后再使用自动更新");
    return;
  }
  const previousLabel = elements.checkUpdate.textContent;
  elements.checkUpdate.disabled = true;
  elements.checkUpdate.textContent = "检查中…";
  try {
    localStorage.setItem(UPDATE_CHECK_STORAGE, String(Date.now()));
  } catch {}
  try {
    const update = await invoke({ id: requestID(), method: "checkUpdate" }, 30_000);
    if (!update.managed) {
      if (manual) toast(update.reason || "当前版本不支持自动更新");
      return;
    }
    if (update.available) {
      showUpdateBanner(update);
    } else {
      hideUpdateBanner();
      if (manual) toast("当前已是最新版本");
    }
  } catch (error) {
    if (manual) {
      showError(error instanceof HostError ? error : new HostError("update_check_failed", ""));
    }
  } finally {
    elements.checkUpdate.disabled = false;
    elements.checkUpdate.textContent = previousLabel;
  }
}

async function installUpdate() {
  if (!state.updateVersion || state.updating) return;
  const version = state.updateVersion;
  state.updating = true;
  elements.updateButton.disabled = true;
  elements.updateButton.textContent = "下载中…";
  elements.queryButton.disabled = true;
  hideError();
  try {
    await invoke({ id: requestID(), method: "prepareUpdate", version }, 310_000);
    elements.updateButton.textContent = "应用中…";
    await invoke({ id: requestID(), method: "applyUpdate", version }, 60_000);
    elements.updateButton.textContent = "正在重载…";
    elements.updateNotes.textContent = "更新已应用，正在重新加载扩展。";
    toast("更新完成");
    setTimeout(() => {
      chrome.runtime.reload();
    }, 1800);
  } catch (error) {
    state.updating = false;
    elements.updateButton.disabled = false;
    elements.updateButton.textContent = `更新到 v${version}`;
    updateQueryLabel();
    showError(error instanceof HostError ? error : new HostError("update_apply_failed", ""));
  }
}

elements.form.addEventListener("submit", (event) => {
  void submitQuery(event);
});

elements.proxy.addEventListener("input", () => {
  rememberInputs();
  resetQueryState();
  hideError();
});

elements.sk.addEventListener("input", () => {
  rememberInputs();
  resetQueryState();
  hideError();
});

elements.orgId.addEventListener("input", () => {
  rememberInputs();
  resetQueryState();
  hideError();
});

elements.toggleSk.addEventListener("click", () => {
  const visible = elements.sk.type === SECRET_TYPE;
  elements.sk.type = visible ? "text" : SECRET_TYPE;
  elements.toggleSk.textContent = visible ? "隐藏" : "显示";
  elements.toggleSk.setAttribute("aria-label", visible ? "隐藏 SK" : "显示 SK");
});

elements.clearButton.addEventListener("click", () => {
  elements.sk.value = "";
  elements.orgId.value = "";
  state.sessionKey = "";
  try {
    sessionStorage.removeItem(SESSION_STORAGE);
    sessionStorage.removeItem(ORGANIZATION_STORAGE);
  } catch {}
  resetQueryState();
  hideError();
  elements.sk.focus();
});

elements.organization.addEventListener("change", () => {
  state.orgId = elements.organization.value;
  state.result = null;
  state.checkedAt = "";
  state.linkExpiresAt = 0;
  elements.result.hidden = true;
  stopLinkTimer();
  hideError();
  updateQueryLabel();
});

elements.refreshStatus.addEventListener("click", () => {
  void runAction("status");
});

elements.refreshLink.addEventListener("click", () => {
  void runAction("refresh");
});

elements.retry.addEventListener("click", () => {
  void runAction("retry");
});

elements.vendorLink.addEventListener("click", () => {
  void copyVendorLink();
});

elements.copyLink.addEventListener("click", () => {
  void copyVendorLink();
});

elements.checkUpdate.addEventListener("click", () => {
  void checkForUpdates(true);
});

elements.updateButton.addEventListener("click", () => {
  void installUpdate();
});

restoreInputs();
elements.sk.type = SECRET_TYPE;
updateQueryLabel();
elements.extensionVersion.textContent = chrome.runtime.getManifest().version;
void readInstallationMarker().then((managed) => {
  state.managed = managed;
  if (!managed) return;
  let lastCheck = 0;
  try {
    lastCheck = Number(localStorage.getItem(UPDATE_CHECK_STORAGE)) || 0;
  } catch {}
  if (Date.now() - lastCheck >= UPDATE_CHECK_INTERVAL) {
    void checkForUpdates(false);
  }
});
