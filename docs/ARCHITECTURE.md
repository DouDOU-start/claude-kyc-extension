# Architecture

## Components

```text
Extension page (app.html / app.js)
        |
        | chrome.runtime.sendMessage
        v
Background service worker
  |-- temporary PAC proxy configuration
  |-- proxy authentication provider
  |-- request-scoped Cookie header
  |-- Claude API requests
  |-- GitHub update check link
        |
        +--> claude.ai
        +--> api.github.com
```

## Request flow

1. The page validates SK, proxy, and optional organization ID.
2. The background service worker receives the request over a private extension message.
3. If a proxy is configured, it generates a PAC script that routes only `claude.ai` through that proxy.
4. Proxy credentials are placed in session storage for the auth provider.
5. A session-scoped declarative-net-request rule adds `Cookie: sessionKey=...` only to the request carrying a random header nonce.
6. Chromium performs the HTTPS request using its own network stack.
7. The extension clears the proxy rule, cookie rule, credentials, and alarm.

Requests are serialized because proxy configuration is profile-wide.

## Failure cleanup

- A `finally` block clears the proxy, request rule, and credentials.
- A two-minute cleanup alarm is created for every request. It removes stale proxy state if the service worker is suspended or the extension page closes unexpectedly.
- Browser startup and extension installation/update also trigger cleanup.

## Update flow

The extension checks `api.github.com/repos/DouDOU-start/claude-kyc-extension/releases/latest` at most once per day. If a newer version exists, the page shows a banner linking to the GitHub release. Sideloaded extensions cannot replace their own files; store-distributed copies update through Chrome.

## Trust boundaries

- The session key is kept in page memory and sent only to `claude.ai`.
- The proxy credential is held temporarily in browser session storage and supplied only to proxy authentication challenges.
- Existing Claude cookies are neither read nor overwritten.
