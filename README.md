# Claude KYC Extension

A pure Manifest V3 browser extension for checking Claude account KYC status with a Claude web session key and an optional HTTP, HTTPS, SOCKS5, or SOCKS5H proxy.

[中文说明](README.zh-CN.md)

![Claude KYC extension](docs/screenshot.png)

> Independent open-source project. Not affiliated with Anthropic, Claude, Persona, Google, or Microsoft. Use it only with accounts and proxies you are authorized to access.

## Features

- No installer, native helper, local server, or Go runtime.
- Runs in the Chrome side panel, so it stays open while you complete verification in another tab.
- Load the same folder into Chrome or Edge.
- Batch-verify one SK per line with fixed concurrency 1.
- Display batch results in a table and export an Excel workbook.
- Organizations are discovered from the session key; choose one only when multiple are available.
- Explicit refresh and retry actions for KYC verification.
- HTTPS-only vendor link validation and a 60-second temporary link window.
- HTTP, HTTPS, SOCKS5, and SOCKS5H proxy support with optional authentication.
- Rotating proxy placeholders: `{session}` and `{region}`.
- Automatic update checks against GitHub Releases.
- No project backend, telemetry, or analytics.

## Requirements

- Chrome or another Chromium browser based on Chrome 148 or newer
- A Claude web `sessionKey`, not an Anthropic API key
- An optional proxy

Chrome 148+ is required because authenticated proxies use the `webRequestAuthProvider` permission.

## Install

1. Open [Releases](https://github.com/DouDOU-start/claude-kyc-extension/releases).
2. Download the latest `claude-kyc-extension-vX.Y.Z.zip`.
3. Extract the ZIP.
4. Open `chrome://extensions` or `edge://extensions`.
5. Enable **Developer mode**.
6. Click **Load unpacked** and select the extracted folder.

The selected folder must contain `manifest.json` directly. To run from source, select the `extension` folder in this repository.

Chrome does not install a ZIP by dragging it onto the extensions page; extract the ZIP first. There is no setup executable.

## Usage

1. Click the Claude KYC toolbar button to open the side panel.
2. Enter a proxy, or leave it empty to use the browser's current network.
3. Enter the Claude web `sessionKey`.
4. Click **查询 KYC** / **Check KYC**.
5. Click **获取验证链接** to request the official Persona URL.
6. Finish verification in the browser, then click **刷新状态**.

### Batch query

1. Switch to **批量查询** / **Batch**.
2. Enter one SK per line.
3. Click **开始验证**.
4. Results appear in the table as each SK finishes; concurrency is fixed at 1.
5. Click **导出 Excel** to download an `.xlsx` file.

Batch mode performs status queries only. Use single mode when you need to request a Persona verification link. SKs in the exported workbook are masked.

### Proxy formats

```text
http://host:port
https://host:port
socks5://host:port
socks5h://host:port
host:port
host:port:username:credential
```

The proxy is applied only to `claude.ai` through a temporary PAC configuration. The extension restores the browser proxy setting when the request ends, and also uses a cleanup alarm if the service worker is interrupted.

## How it works

- The session key is written into a request-scoped `Cookie` header with `declarativeNetRequest`.
- The extension does not read or overwrite your existing Claude cookies.
- Proxy authentication is supplied by `chrome.webRequest.onAuthRequired` and is kept only in session storage during the request.
- Requests run in the extension background service worker using Chromium's real network stack.

## Updates

GitHub Actions builds and publishes a release whenever a `v*` tag is pushed.

For GitHub-installed copies, the extension checks the latest release at most once per day and shows a download button when a newer version exists. Chromium does not allow a sideloaded extension to silently replace itself. Download the new ZIP, extract it over the old folder, and click **Reload** on the extension card.

If the extension is published to the Chrome Web Store, Chrome handles automatic updates normally.

## Permissions

| Permission | Purpose |
| --- | --- |
| `proxy` | Temporarily route `claude.ai` through the entered proxy |
| `webRequest` + `webRequestAuthProvider` | Supply optional proxy authentication |
| `declarativeNetRequestWithHostAccess` | Add the session key to the request without touching browser cookies |
| `storage` | Keep the proxy and temporary proxy credentials |
| `sidePanel` | Open the query interface in Chrome's side panel |
| `clipboardWrite` | Copy the verification URL |
| `host_permissions` | Access `claude.ai` and the GitHub Releases API |

## Privacy and security

- The session key is held only in side-panel memory and is cleared when the side panel closes.
- The proxy URL is stored in local browser storage.
- No project server is used.
- The extension never sends the session key or proxy to GitHub.
- Vendor links are accepted only over HTTPS and are never opened automatically.
- Batch SKs stay in side-panel memory; exported Excel files contain masked SK values.

See [PRIVACY.md](PRIVACY.md) and [SECURITY.md](SECURITY.md).

## Development

There is no build step. Load the `extension` directory as an unpacked extension.

Run tests:

```sh
node --test tests/*.test.js
```

Run syntax checks:

```sh
node --check extension/app.js
node --check extension/background.js
node --check extension/lib/api.js
node --check extension/lib/proxy.js
node --check extension/lib/release.js
```

## Project layout

```text
extension/
  manifest.json       Manifest V3 entry
  sidepanel.html      Chrome side panel UI
  app.js              UI controller
  background.js       Proxy auth and request orchestration
  lib/
    api.js            Claude request flow
    kyc.js            Parsing, status, validation
    proxy.js          Proxy parsing and PAC generation
    release.js        GitHub update check
    batch.js          Batch parsing, masking, priority
    xlsx.js           Offline XLSX writer
package.json           Node test scripts
tests/                 Node tests
docs/                 Screenshot, architecture, release notes
.github/workflows/    Tag-driven release automation
```

## Limitations

- The project uses Claude web endpoints that may change without notice.
- Proxying applies to `claude.ai` only and is temporary, but other `claude.ai` tabs are briefly affected while a query runs.
- A browser challenge, rate limit, or invalid session is reported as an error and never as a successful KYC result.
- This tool queries status and returns the official verification link. It does not bypass identity verification.

## Release automation

The release workflow validates that the tag matches `extension/manifest.json`, runs the tests, creates `claude-kyc-extension-vX.Y.Z.zip`, creates `SHA256SUMS.txt`, and publishes the GitHub Release.

```sh
git tag -a v1.0.0 -m "v1.0.0"
git push origin v1.0.0
```

See [docs/RELEASE.md](docs/RELEASE.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
