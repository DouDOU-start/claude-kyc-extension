# Release Process

## Versioning

Use semantic versions in `extension/manifest.template.json`, for example `1.0.1`. Git tags must be `v` plus the same version: `v1.0.1`.

The default updater repository is `DouDOU-start/claude-kyc-extension`. It must exist as a public GitHub repository, or the project configuration and manifest homepage must be updated before building.

## Local release build

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build.ps1
```

The build produces:

```text
dist\claude-kyc-extension-v1.0.1.zip
dist\SHA256SUMS.txt
```

## Publish

1. Update the version in `extension/manifest.template.json`.
2. Run the tests and release build.
3. Commit the version change.
4. Create and push an annotated tag:

   ```powershell
   git tag -a v1.0.1 -m "v1.0.1"
   git push origin v1.0.1
   ```

5. The release workflow builds the package and creates the GitHub Release.
6. Verify that the release contains exactly:
   - `claude-kyc-extension-v1.0.1.zip`
   - `SHA256SUMS.txt`

The automatic updater only sees published, non-draft releases returned by GitHub's `releases/latest` endpoint.

## Repository rename

If the GitHub repository changes, update:

- `project.json`
- `extension/manifest.template.json` (`homepage_url`)
- README links

The native host embeds the repository value at build time.

## Manual release

If the workflow is unavailable, upload both build artifacts to the release manually. The ZIP name must be `claude-kyc-extension-<tag>.zip`.
