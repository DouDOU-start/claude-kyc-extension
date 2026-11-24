# Changelog

## 1.0.2

- Remove the manual organization ID field; organizations are always discovered from the session key.
- Add the GitHub icon to the footer link.
- Move the interface from a standalone page to Chrome's side panel.
- Keep the session key in browser session storage.

## 1.0.1

- Add a persistent GitHub repository link in the extension footer.

## 1.0.0

- Initial open-source release.
- Pure Manifest V3 extension with no installer or native helper.
- Session-key KYC lookup with optional organization ID.
- Temporary HTTP/HTTPS/SOCKS5/SOCKS5H proxy routing.
- Authenticated proxy support through `webRequestAuthProvider`.
- Request-scoped cookie injection without touching browser cookies.
- GitHub Release update notifications.
