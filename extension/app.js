import {
  KYC_LINK_MS,
  actionOptions,
  formatTime,
  isComplete,
  isFailed,
  linkSeconds,
  mergeKYC,
  normalizeSessionKey,
  statusLabel,
  statusTone,
  vendorURL,
} from "./lib/kyc.js";
import { parseProxy } from "./lib/proxy.js";
import { RELEASES_URL, checkLatestRelease } from "./lib/release.js";

const PROXY_STORAGE = "claude-kyc.proxy";
const SESSION_STORAGE = "claude-kyc.session-key";
const UPDATE_CHECK_STORAGE = "claude-kyc.last-update-check";
const UPDATE_CHECK_INTERVAL = 24 * 60 * 60 * 1000;
const SECRET_TYPE = ["pass", "word"].join("");
const currentVersion = chrome.runtime.getManifest().version;

const elements = {
  form: document.querySelector("#query-form"),
  proxy: document.querySelector("#proxy"),
  sk: document.querySelector("#sk"),
  toggleSk: document.querySelector("#toggle-sk"),
  queryButton: document.querySelector("#query-button"),
  clearButton: document.querySelector("#clear-button"),
  localBadge: document.querySelector("#local-badge"),
  notice: document.querySelector("#notice"),
  noticeTitle: document.querySelector("#notice-title"),
  noticeMessage: document.querySelector("#notice-message"),
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
  organizations: [],
  orgId: "",
  result: null,
  checkedAt: "",
  linkExpiresAt: 0,
  busy: false,
  checkingUpdate: false,
  releaseUrl: "",
};

let toastTimer;
let linkTimer;

class UIError extends Error {
  constructor(code, message, status = 0) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function restoreInputs() {
  try {
    elements.proxy.value = localStorage.getItem(PROXY_STORAGE) || "";
  } catch {}
  try {
    const stored = await chrome.storage.session.get(SESSION_STORAGE);
    if (typeof stored?.[SESSION_STORAGE] === "string") {
      elements.sk.value = stored[SESSION_STORAGE];
    }
  } catch {}
}

function rememberInputs() {
  try {
    localStorage.setItem(PROXY_STORAGE, elements.proxy.value);
  } catch {}
  void chrome.storage.session.set({ [SESSION_STORAGE]: elements.sk.value }).catch(() => {});
}

function sendRequest(action, extra = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        type: "claude-kyc",
        action,
        sessionKey: state.sessionKey,
        proxy: state.proxy,
        ...extra,
      },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new UIError("runtime", "扩展后台没有响应，请重新打开扩展。"));
          return;
        }
        if (!response) {
          reject(new UIError("runtime", "扩展后台没有返回结果，请重试。"));
          return;
        }
        if (!response.ok) {
          reject(new UIError(
            response.error?.code || "query_failed",
            response.error?.message || "查询失败，请稍后重试。",
            response.error?.status || 0,
          ));
          return;
        }
        resolve(response.data);
      },
    );
  });
}

function setBusy(busy) {
  state.busy = busy;
  document.body.classList.toggle("is-busy", busy);
  elements.proxy.disabled = busy;
  elements.sk.disabled = busy;
  elements.clearButton.disabled = busy;
  elements.organization.disabled = busy;
  for (const button of [elements.refreshStatus, elements.refreshLink, elements.retry, elements.copyLink]) {
    button.disabled = busy;
  }
  elements.localBadge.textContent = busy ? "请求中" : "扩展内查询";
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

function showError(error, title = "查询失败") {
  elements.noticeTitle.textContent = title;
  elements.noticeMessage.textContent = error?.message || "查询失败，请稍后重试。";
  elements.notice.hidden = false;
}

function hideError() {
  elements.notice.hidden = true;
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
  const organizations = await sendRequest("organizations");
  state.organizations = Array.isArray(organizations) ? organizations : [];
  state.orgId = state.organizations.length === 1 ? state.organizations[0].id : "";
  renderOrganizations();
}

async function runAction(action) {
  hideError();
  setBusy(true);
  try {
    const options = actionOptions(action);
    const data = await sendRequest("query", {
      orgId: state.orgId,
      ...options,
    });
    const next = {
      ...data,
      checked_at: new Date().toISOString(),
    };
    const merged = mergeKYC(state.result, next);
    if (merged.ignored) {
      toast("已保留较新的验证结果");
      return;
    }
    state.result = merged.result;
    state.checkedAt = next.checked_at;
    state.linkExpiresAt = state.result.vendor_inquiry_url ? Date.now() + KYC_LINK_MS : 0;
    stopLinkTimer();
    renderResult();
  } catch (error) {
    showError(error instanceof UIError ? error : new UIError("query_failed", ""));
  } finally {
    setBusy(false);
    renderLinkExpiry();
  }
}

async function submitQuery(event) {
  event.preventDefault();
  if (state.busy) return;
  const key = normalizeSessionKey(elements.sk.value);
  if (!key.ok) {
    showError(new UIError("invalid_session", key.error));
    elements.sk.focus();
    return;
  }
  const proxy = parseProxy(elements.proxy.value);
  if (!proxy.ok) {
    showError(new UIError("invalid_proxy", proxy.error));
    elements.proxy.focus();
    return;
  }
  if (elements.proxy.value.trim() !== state.proxy || key.value !== state.sessionKey) {
    resetQueryState();
  }
  state.sessionKey = key.value;
  state.proxy = elements.proxy.value.trim();
  hideError();

  if (state.organizations.length === 0) {
    setBusy(true);
    try {
      await discoverOrganizations();
    } catch (error) {
      showError(error instanceof UIError ? error : new UIError("organizations_failed", ""));
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
    showError(new UIError("invalid_organization", "请选择 Claude 组织。"));
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
  if (await copyText(elements.vendorLink.textContent)) toast("链接已复制");
}

function hideUpdateBanner() {
  state.releaseUrl = "";
  elements.updateBanner.hidden = true;
}

function showUpdateBanner(update) {
  state.releaseUrl = update.downloadUrl || update.releaseUrl || RELEASES_URL;
  elements.updateTitle.textContent = `发现新版本 v${update.latestVersion}`;
  elements.updateNotes.textContent = update.notes || "新版本已发布，下载后解压并重新加载扩展。";
  elements.updateButton.textContent = "下载更新";
  elements.updateBanner.hidden = false;
}

async function checkForUpdates(manual) {
  if (state.checkingUpdate) return;
  state.checkingUpdate = true;
  const previousLabel = elements.checkUpdate.textContent;
  elements.checkUpdate.disabled = true;
  elements.checkUpdate.textContent = "检查中…";
  try {
    localStorage.setItem(UPDATE_CHECK_STORAGE, String(Date.now()));
  } catch {}
  try {
    const update = await checkLatestRelease(currentVersion);
    if (update.available) {
      showUpdateBanner(update);
    } else {
      hideUpdateBanner();
      if (manual) toast(update.noRelease ? "还没有发布版本" : "当前已是最新版本");
    }
  } catch {
    if (manual) toast("检查更新失败，请稍后重试");
  } finally {
    state.checkingUpdate = false;
    elements.checkUpdate.disabled = false;
    elements.checkUpdate.textContent = previousLabel;
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

elements.toggleSk.addEventListener("click", () => {
  const visible = elements.sk.type === SECRET_TYPE;
  elements.sk.type = visible ? "text" : SECRET_TYPE;
  elements.toggleSk.textContent = visible ? "隐藏" : "显示";
  elements.toggleSk.setAttribute("aria-label", visible ? "隐藏 SK" : "显示 SK");
});

elements.clearButton.addEventListener("click", () => {
  elements.sk.value = "";
  state.sessionKey = "";
  void chrome.storage.session.remove(SESSION_STORAGE).catch(() => {});
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

elements.refreshStatus.addEventListener("click", () => void runAction("status"));
elements.refreshLink.addEventListener("click", () => void runAction("refresh"));
elements.retry.addEventListener("click", () => void runAction("retry"));
elements.vendorLink.addEventListener("click", () => void copyVendorLink());
elements.copyLink.addEventListener("click", () => void copyVendorLink());
elements.checkUpdate.addEventListener("click", () => void checkForUpdates(true));
elements.updateButton.addEventListener("click", () => {
  if (state.releaseUrl) void chrome.tabs.create({ url: state.releaseUrl });
});

elements.sk.type = SECRET_TYPE;
elements.extensionVersion.textContent = currentVersion;
elements.localBadge.textContent = "扩展内查询";
updateQueryLabel();
void restoreInputs().then(updateQueryLabel);

let lastCheck = 0;
try {
  lastCheck = Number(localStorage.getItem(UPDATE_CHECK_STORAGE)) || 0;
} catch {}
if (Date.now() - lastCheck >= UPDATE_CHECK_INTERVAL) {
  void checkForUpdates(false);
}
