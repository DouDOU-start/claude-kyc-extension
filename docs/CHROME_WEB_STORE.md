# Chrome Web Store Notes

The extension can be packaged for the Chrome Web Store, but the native helper still requires a Windows installer.

## Permissions

- `nativeMessaging`: communicates with the local KYC helper over Chrome's private stdio channel.
- `clipboardWrite`: copies the official Persona verification URL when the user clicks it.

No host permissions, content scripts, remote code, or analytics are used.

## Submission

1. Build the release package.
2. Upload the generated `extension` folder as the store package.
3. Use the privacy disclosures in `PRIVACY.md`.
4. Explain that KYC requests go directly from the local helper to `claude.ai`.
5. Explain that the update check contacts GitHub Releases.

## Extension ID

The native host manifest allows only the extension ID derived from `keys/kyc-extension.pub`. If the store listing uses a different extension ID, rebuild the installer with that ID or update the generated native host manifest before installation.

Store-managed extension updates do not require the GitHub update path. The native helper can still be updated separately.
