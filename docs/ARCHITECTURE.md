# Architecture

## Components

```text
Chrome extension
  app.html / app.js
        |
        | Native Messaging (stdio, no TCP port)
        v
kyc-host.exe
  |-- organizations
  |-- KYC status / refresh / retry
  |-- update check / download / apply
        |
        +--> claude.ai through optional proxy
        +--> GitHub Releases for updates
```

## Browser extension

The Manifest V3 extension owns the UI and all user-visible state. It:

- keeps the session key in `sessionStorage`;
- stores the proxy in local browser storage;
- skips organization discovery when an organization ID is provided;
- validates vendor links before displaying them;
- never polls KYC status automatically;
- checks for updates at most once per day when installed from the managed folder.

## Native host

The Go native host is started by Chrome for a single request window. It:

- reads Chrome's length-prefixed JSON messages from stdin;
- builds a Chrome-impersonating `surf` client;
- sends the session key only to `claude.ai`;
- validates response shapes and HTTP errors;
- returns a normalized JSON response on stdout.

The host opens no listening socket.

## Update flow

1. The extension reads its `installation.json` marker.
2. If managed, it calls `checkUpdate`.
3. The host queries the pinned GitHub Releases API.
4. `prepareUpdate` downloads the matching release ZIP and verifies its SHA-256.
5. The ZIP is extracted with traversal protection and validated.
6. `applyUpdate` copies the new extension files while preserving `installation.json`.
7. A detached `kyc-updater.exe` waits for the native host to exit and replaces the host binaries.
8. The extension calls `chrome.runtime.reload()`.

The update package is never executed from the download directory.

## Trust boundaries

- The session key crosses the extension/native-host boundary but is not persisted by the host.
- Proxy credentials stay inside the local process and proxy connection.
- GitHub controls update availability. SHA-256 prevents accidental corruption, not a compromised repository.
- Native Messaging restricts host access to the configured extension ID.
