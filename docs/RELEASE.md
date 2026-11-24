# Release Process

## Versioning

Set the semantic version in `extension/manifest.json`, for example `1.1.0`. The Git tag must be `v` plus the same version: `v1.1.0`.

## Publish with GitHub Actions

```sh
git tag -a v1.1.0 -m "v1.1.0"
git push origin v1.1.0
```

The release workflow:

1. validates that the tag matches `extension/manifest.json`;
2. runs the Node tests;
3. creates `claude-kyc-extension-v1.1.0.zip` with `manifest.json` at the ZIP root;
4. creates `SHA256SUMS.txt`;
5. publishes a GitHub Release with both assets.

Users extract the ZIP and select that folder in `chrome://extensions`.

## Manual packaging

If Actions is unavailable:

```powershell
New-Item -ItemType Directory -Force dist | Out-Null
Compress-Archive -Path extension\* -DestinationPath dist\claude-kyc-extension-v1.1.0.zip -Force
(Get-FileHash dist\claude-kyc-extension-v1.1.0.zip -Algorithm SHA256).Hash
```

Upload the ZIP to a non-draft GitHub Release. The extension's update checker uses the latest published release tag.
