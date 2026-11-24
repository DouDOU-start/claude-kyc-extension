# Contributing

## Development setup

- Windows 10/11
- Go 1.27+
- Node.js 20+
- PowerShell 5.1 or PowerShell 7

Run tests:

```powershell
cd extension
node --test tests/*.test.js
cd ..
go test ./...
go vet ./...
```

Build the complete Windows release:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build.ps1
```

## Code guidelines

- Keep the native host small and stdio-only.
- Never log or return session keys, proxy credentials, KYC response bodies, or vendor links in errors.
- Treat unknown KYC statuses as incomplete.
- Only accept HTTPS vendor links without embedded credentials.
- Keep update downloads pinned to the configured GitHub repository and verify SHA-256.
- Preserve the installer-managed `installation.json` marker during extension updates.
- Add tests for parsing, validation, proxy behavior, and security-sensitive changes.

## Pull requests

1. Keep changes focused.
2. Update documentation when behavior changes.
3. Run all tests and the release build.
4. Do not commit secrets, browser profiles, generated ZIP files, or signing keys.
5. Describe any change to network behavior, permissions, or update behavior explicitly.

## Extension key

`keys/kyc-extension.pub` and `keys/extension-id.txt` are public and intentionally tracked. The private signing key is not included and must never be committed.
