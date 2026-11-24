export const GITHUB_REPOSITORY = "DouDOU-start/claude-kyc-extension";
export const RELEASES_URL = `https://github.com/${GITHUB_REPOSITORY}/releases`;

export function compareVersions(left, right) {
  const parse = (value) => {
    const clean = String(value ?? "").trim().replace(/^v/, "").split("-", 1)[0];
    const parts = clean.split(".").map((part) => Number.parseInt(part, 10));
    return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
  };
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index++) {
    if (a[index] < b[index]) return -1;
    if (a[index] > b[index]) return 1;
  }
  return 0;
}

export async function checkLatestRelease(currentVersion) {
  const response = await fetch(
    `https://api.github.com/repos/${GITHUB_REPOSITORY}/releases/latest`,
    {
      headers: {
        "accept": "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
      },
      cache: "no-store",
    },
  );
  if (response.status === 404) {
    return {
      available: false,
      currentVersion,
      latestVersion: currentVersion,
      notes: "",
      releaseUrl: RELEASES_URL,
      downloadUrl: RELEASES_URL,
      noRelease: true,
    };
  }
  if (!response.ok) {
    throw new Error(`GitHub Releases 返回 HTTP ${response.status}`);
  }
  const release = await response.json();
  const latestVersion = String(release?.tag_name || "").replace(/^v/, "");
  if (!/^\d+\.\d+\.\d+$/.test(latestVersion)) {
    throw new Error("GitHub Release 版本号无效");
  }
  const zipName = `claude-kyc-extension-${release?.tag_name}.zip`;
  const asset = Array.isArray(release?.assets)
    ? release.assets.find((item) => item?.name === zipName) ||
      release.assets.find((item) => typeof item?.name === "string" && item.name.endsWith(".zip"))
    : null;
  return {
    available: compareVersions(latestVersion, currentVersion) > 0,
    currentVersion,
    latestVersion,
    notes: String(release?.body || "").slice(0, 3000),
    releaseUrl: typeof release?.html_url === "string" ? release.html_url : RELEASES_URL,
    downloadUrl: typeof asset?.browser_download_url === "string" ? asset.browser_download_url : RELEASES_URL,
    noRelease: false,
  };
}
