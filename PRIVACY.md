# Privacy

## Data processed locally

- **Claude session key**: kept in the extension page's `sessionStorage`, cleared when the tab is closed. It is passed to the local native host for the duration of a request and is not written to disk.
- **Proxy URL**: stored in the extension's local browser storage so it can be reused. It may contain credentials and should be protected as a sensitive secret.
- **User-entered organization ID**: kept in the current tab's session storage.
- **KYC response**: displayed in the page. It is not written to a database.

## Network requests

- The local helper sends the KYC request to `claude.ai` through the configured proxy.
- Update checks and downloads go to GitHub Releases. The session key and proxy are not included.
- There is no project-owned backend, telemetry endpoint, analytics service, or crash reporter.

## Logs

The helper does not log session keys, proxy credentials, KYC response bodies, or vendor verification URLs. The updater writes a local `update.log` with version and file-operation errors only.

## Removal

Remove the extension from the browser and run `卸载.cmd`. This removes the native helper registration and the local helper directory.
