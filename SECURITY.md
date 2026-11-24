# Security Policy

## Supported versions

Only the latest GitHub Release is supported with security fixes.

## Reporting

Please use GitHub private vulnerability reporting or a private security advisory. Do not open a public issue containing:

- a Claude session key
- proxy credentials
- a Persona inquiry URL or token
- steps that make an active vulnerability immediately exploitable

Include the affected version, reproduction steps, impact, and suggested mitigation.

## Sensitive values

- The Claude web `sessionKey` is equivalent to an active browser session. Treat it as a highly sensitive credential.
- Proxy URLs may contain credentials.
- Persona verification URLs may contain inquiry tokens.

The extension keeps the session key in browser session storage, injects it only into request-scoped headers, and clears temporary proxy credentials after each request. It does not read or modify existing Claude cookies.

## Update trust

The extension checks the pinned public GitHub repository for the latest release and opens the release page when an update is available. It cannot silently self-update a sideloaded extension. Chrome Web Store distribution should be used when automatic updates are required.

## Scope

The project does not bypass KYC, CAPTCHA, browser challenges, access controls, or payment controls.
