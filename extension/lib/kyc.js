export const KYC_LINK_MS = 60 * 1000;
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

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

export function parseOrganizations(text) {
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    return { ok: false, error: "Claude 组织响应无效。" };
  }
  if (!Array.isArray(payload) || payload.length > 100) {
    return { ok: false, error: "Claude 组织响应无效。" };
  }
  const organizations = [];
  const seen = new Set();
  for (const item of payload) {
    const id = typeof item?.uuid === "string" ? item.uuid : "";
    const name = typeof item?.name === "string" ? item.name : "";
    if (!id || id.length > 128 || /\s/.test(id)) {
      return { ok: false, error: "Claude 组织响应无效。" };
    }
    if (seen.has(id)) continue;
    seen.add(id);
    organizations.push({ id, name: name.slice(0, 500) });
  }
  return { ok: true, value: organizations };
}

export function parseKYCStatus(text) {
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    return { ok: false, error: "Claude KYC 状态响应无效。" };
  }
  const status = typeof payload?.status === "string" ? payload.status : "";
  if (!status || status.length > 64 || /\s/.test(status)) {
    return { ok: false, error: "Claude KYC 状态响应无效。" };
  }
  if ("should_poll" in payload && typeof payload.should_poll !== "boolean") {
    return { ok: false, error: "Claude KYC 状态响应无效。" };
  }
  const result = {
    status,
    should_poll: Boolean(payload.should_poll),
    updated_at: typeof payload.updated_at === "string" ? payload.updated_at : undefined,
    completed_at: typeof payload.completed_at === "string" ? payload.completed_at : undefined,
    vendor_inquiry_url: typeof payload.vendor_inquiry_url === "string" ? payload.vendor_inquiry_url : "",
    vendor_inquiry_id: typeof payload.vendor_inquiry_id === "string" ? payload.vendor_inquiry_id : "",
  };
  if (isComplete(status) || isFailed(status)) {
    result.should_poll = false;
    result.vendor_inquiry_url = "";
    result.vendor_inquiry_id = "";
  }
  if (result.vendor_inquiry_url) {
    if (!vendorURL(result.vendor_inquiry_url)) {
      return { ok: false, error: "Claude 返回了无效的验证链接。" };
    }
  }
  return { ok: true, value: result };
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
