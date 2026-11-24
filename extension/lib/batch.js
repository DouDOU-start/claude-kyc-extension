import { normalizeSessionKey } from "./kyc.js";

export function maskSK(sk) {
  if (sk.length <= 12) return `${sk.slice(0, 3)}…${sk.slice(-2)}`;
  return `${sk.slice(0, 6)}…${sk.slice(-4)}`;
}

export function parseBatchInput(text, limit = 200) {
  const lines = String(text ?? "")
    .split(/\r?\n|,/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return { ok: false, error: "请至少填写一个 SK。" };
  if (lines.length > limit) return { ok: false, error: `单次最多处理 ${limit} 个 SK。` };
  const values = [];
  const seen = new Set();
  for (let index = 0; index < lines.length; index++) {
    const parsed = normalizeSessionKey(lines[index]);
    if (!parsed.ok) {
      return { ok: false, error: `第 ${index + 1} 个 SK 格式无效。` };
    }
    if (seen.has(parsed.value)) continue;
    seen.add(parsed.value);
    values.push(parsed.value);
  }
  return { ok: true, value: values };
}

export function batchPriority(status) {
  const priorities = {
    verified: 12,
    not_required: 11,
    pending_review: 10,
    in_progress: 9,
    pending: 8,
    required: 7,
    unverified: 6,
    not_started: 5,
    denied: 4,
    failed: 3,
    expired: 2,
  };
  return priorities[status] ?? 1;
}
