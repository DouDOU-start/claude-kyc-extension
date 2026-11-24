# Privacy

## Local data

- **Claude session key**: held in the extension page's `sessionStorage`; cleared when the tab closes. It is injected into a single Claude request and is not written to disk.
- **Proxy URL**: stored in the extension's local browser storage for reuse. It may contain credentials.
- **Organization ID**: held in the current tab's session storage.
- **KYC result**: displayed in the page and not written to a database.

## Network requests

- KYC requests go directly from Chromium's network stack to `claude.ai` through the optional proxy.
- Proxy credentials are stored in `chrome.storage.session` only for the lifetime of a request and then removed.
- Update checks request `api.github.com` and link to GitHub Releases. The session key and proxy are never included.
- There is no project backend, telemetry, analytics, or crash reporter.

## Browser integration

- The extension injects a request-scoped `Cookie` header using `declarativeNetRequest`.
- It does not read or overwrite the user's existing Claude cookies.
- Proxy routing is temporary and limited to `claude.ai`.
- A cleanup alarm restores proxy settings if the background service worker is interrupted.

## Removal

Remove the extension from `chrome://extensions`. Browser-managed extension storage is removed by Chrome when the extension is uninstalled.
