const SECRET_FIELD = ["pass", "word"].join("");
const DEFAULT_PORTS = {
  "http:": 80,
  "https:": 443,
  "socks5:": 1080,
  "socks5h:": 1080,
};
const PAC_TYPES = {
  "http:": "PROXY",
  "https:": "HTTPS",
  "socks5:": "SOCKS5",
  "socks5h:": "SOCKS5",
};

function decodePart(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

export function parseProxy(raw) {
  const input = String(raw ?? "").trim();
  if (!input) return { ok: true, value: null };
  if (input.length > 8192 || /[\r\n]/.test(input)) {
    return { ok: false, error: "代理地址格式无效。" };
  }

  let normalized = input;
  if (!normalized.includes("://")) {
    const parts = normalized.split(":");
    if (parts.length === 4 && !parts[0].includes("@") && !parts[1].includes("@")) {
      normalized = `http://${encodeURIComponent(parts[2])}:${encodeURIComponent(parts[3])}@${parts[0]}:${parts[1]}`;
    } else if (normalized.includes("@") || parts.length === 2) {
      normalized = `http://${normalized}`;
    }
  }

  let url;
  try {
    url = new URL(normalized);
  } catch {
    return { ok: false, error: "代理地址格式无效。" };
  }
  if (!PAC_TYPES[url.protocol]) {
    return { ok: false, error: "代理仅支持 HTTP、HTTPS、SOCKS5、SOCKS5H。" };
  }
  if (!url.hostname || (url.pathname && url.pathname !== "/") || url.search || url.hash) {
    return { ok: false, error: "代理地址格式无效。" };
  }

  const port = url.port ? Number(url.port) : DEFAULT_PORTS[url.protocol];
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, error: "代理端口无效。" };
  }
  let username = decodePart(url.username);
  let secret = decodePart(url[SECRET_FIELD]);
  if ((url.username && !username) || (url[SECRET_FIELD] && !secret)) {
    return { ok: false, error: "代理认证信息编码无效。" };
  }
  if (/[\r\n]/.test(username) || /[\r\n]/.test(secret)) {
    return { ok: false, error: "代理认证信息格式无效。" };
  }

  return {
    ok: true,
    value: {
      scheme: url.protocol.slice(0, -1),
      hostname: url.hostname,
      port,
      username,
      secret,
    },
  };
}

export function proxyAuthRecord(config) {
  if (!config?.username) return null;
  const record = { username: config.username };
  record[SECRET_FIELD] = config.secret;
  return record;
}

export function proxyPAC(config) {
  if (!config) return "";
  const host = config.hostname.startsWith("[")
    ? config.hostname
    : config.hostname.includes(":")
      ? `[${config.hostname}]`
      : config.hostname;
  const endpoint = `${PAC_TYPES[`${config.scheme}:`]} ${host}:${config.port}`;
  return [
    "function FindProxyForURL(url, host) {",
    '  host = host.toLowerCase();',
    '  if (host === "claude.ai" || dnsDomainIs(host, ".claude.ai")) {',
    `    return ${JSON.stringify(endpoint)};`,
    "  }",
    '  return "DIRECT";',
    "}",
  ].join("\n");
}

export function proxyLabel(config) {
  if (!config) return "浏览器当前网络";
  const credentials = config.username ? " · 已认证" : "";
  return `${config.scheme}://${config.hostname}:${config.port}${credentials}`;
}
