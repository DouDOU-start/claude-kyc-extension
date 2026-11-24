# Security Policy

## Supported versions

Only the latest GitHub Release is supported with security fixes.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting or a private security advisory for this repository. Do not open a public issue containing:

- a Claude session key
- proxy credentials
- a verification URL containing an inquiry token
- details that make an active vulnerability immediately exploitable

Please include the affected version, reproduction steps, impact, and any suggested mitigation.

## Sensitive data

- The Claude web `sessionKey` is equivalent to an active browser session. Treat it as a highly sensitive credential.
- Proxy URLs may contain credentials.
- Persona verification URLs may contain inquiry tokens.
- Do not include these values in issues, logs, screenshots, or pull requests.

## Update trust

The updater is pinned to the repository configured at build time. It downloads only that repository's release asset and verifies the SHA-256 value published by GitHub Releases or in `SHA256SUMS.txt`. A compromise of the GitHub repository or maintainer account can still compromise future updates. Maintainers should use strong account security, review changes, and avoid bypassing the release workflow.

## Scope

The project does not bypass KYC, CAPTCHAs, browser challenges, account access controls, or payment controls. Reports about those behaviors are outside the intended scope.
