# Contributing

## Requirements

- Chrome 148+ or a compatible Chromium browser
- Node.js 20+

## Development

There is no build step.

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click **Load unpacked** and select the `extension` folder.
4. After changing files, click **Reload** on the extension card.

## Tests

```sh
node --test tests/*.test.js
```

Also run syntax checks for changed JavaScript files:

```sh
node --check extension/app.js
node --check extension/background.js
node --check extension/lib/api.js
```

## Guidelines

- Never log or return session keys, proxy credentials, KYC response bodies, or vendor links in errors.
- Treat unknown KYC statuses as incomplete.
- Only accept HTTPS vendor links without embedded credentials.
- Do not read or overwrite the user's existing Claude cookies.
- Keep proxy credentials in session storage and remove them after each request.
- Keep update checks pinned to `DouDOU-start/claude-kyc-extension`.
- Add tests for parsing and security-sensitive changes.

## Pull requests

1. Keep changes focused.
2. Update documentation when behavior changes.
3. Run the tests and syntax checks.
4. Do not commit secrets, browser profiles, or generated archives.
5. Call out any permission, proxy, network, or update behavior changes.
