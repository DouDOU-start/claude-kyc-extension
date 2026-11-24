# Chrome Web Store Notes

This is a pure extension. The store package is the `extension` folder; no installer or native helper is required.

## Permission justifications

- `proxy`: temporarily routes Claude API requests through the user-provided proxy.
- `webRequest` / `webRequestAuthProvider`: supplies optional proxy authentication.
- `declarativeNetRequestWithHostAccess`: adds the supplied session key to the request without reading browser cookies.
- `storage`: remembers the proxy and keeps proxy credentials temporarily during a request.
- `clipboardWrite`: copies the official Persona verification link.
- `host_permissions`: accesses `claude.ai` and the public GitHub Releases API.

## Distribution

Chrome Web Store distribution is the recommended path when automatic extension updates are required. Chrome updates store-installed extensions automatically; sideloaded copies can only notify users about new GitHub releases.

Use the privacy disclosures in `PRIVACY.md` for the store listing.
