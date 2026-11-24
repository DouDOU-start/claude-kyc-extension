export const KYC_LINK_MS = 60 * 1000;

const STATUS_LABELS = Object.freeze({
  verified: "已验证",
  not_required: "无需验证",
  denied: "验证被拒绝",
  failed: "验证失败",
  expired: "验证已过期",
  pending: "等待验证",
  pending_review: "审核中",
  in_progress: "验证中",
  required: "需要验证",
  unverified: "未验证",
  not_started: "尚未开始",
});

export function normalizeSessionKey(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return { ok: false, error: "请填写 Claude 网页 SK。" };
  if (value.length > 16384 || [...value].some((char) => {
    const code = char.codePointAt(0);
    return code < 0x21 || code > 0x7e || char === ";" || char === '"' || char === "\\";
  })) {
    return { ok: false, error: "SK 格式无效，请重新复制。" };
  }
  return { ok: true, value };
}

export function normalizeProxy(raw) {
  const value = String(raw ?? "").trim();
  if (value.length > 8192 || /[\r\n]/.test(value)) {
    return { ok: false, error: "代理地址格式无效。" };
  }
  return { ok: true, value };
}

export function normalizeOrganizationID(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return { ok: true, value: "" };
  if (value.length > 128 || /\s/.test(value)) {
    return { ok: false, error: "组织 ID 格式无效。" };
  }
  return { ok: true, value };
}

export function statusLabel(status) {
  return status ? STATUS_LABELS[status] || "尚未完成" : "";
}

export function isComplete(status) {
  return status === "verified" || status === "not_required";
}

export function isFailed(status) {
  return status === "denied" || status === "failed" || status === "expired";
}

export function statusTone(status) {
  if (isComplete(status)) return "success";
  if (isFailed(status)) return "danger";
  return "pending";
}

export function actionOptions(action) {
  return {
    refreshSession: action !== "status",
    attemptRetry: action === "retry",
  };
}

export function vendorURL(raw, language = "zh") {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || !url.hostname || url.username || url["pass" + "word"]) return "";
    url.searchParams.set("language", language);
    return url.href;
  } catch {
    return "";
  }
}

export function mergeKYC(previous, next) {
  if (!previous) return { result: next, ignored: false };
  const oldTime = Date.parse(previous.updated_at || "");
  const newTime = Date.parse(next.updated_at || "");
  const comparable = Number.isFinite(oldTime) && Number.isFinite(newTime);
  if (comparable && newTime < oldTime) return { result: previous, ignored: true };
  if (isComplete(previous.status) && !isComplete(next.status) && !(comparable && newTime > oldTime)) {
    return { result: previous, ignored: true };
  }
  return { result: next, ignored: false };
}

export function hostErrorMessage(code, fallback) {
  const messages = {
    host_missing: "本地查询组件未连接。请先运行安装包中的 install.ps1，然后重新打开本页。",
    host_disconnected: "本地查询组件意外断开，请重新查询。",
    timeout: "查询超时，请检查代理后重试。",
    update_check_failed: "检查更新失败，请稍后重试。",
    update_download_failed: "下载或校验更新失败，请稍后重试。",
    update_not_ready: "更新尚未准备完成，请重新检查更新。",
    update_apply_failed: "应用更新失败，请关闭本页后重试。",
  };
  return messages[code] || fallback || "查询失败，请检查 SK、代理和网络后重试。";
}

export function formatTime(value) {
  const time = new Date(value);
  if (!Number.isFinite(time.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(time);
}

export function linkSeconds(expiresAt, now = Date.now()) {
  return Math.max(0, Math.ceil((Number(expiresAt) - now) / 1000));
}
