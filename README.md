# Logs

Logs is a workspace for searching application logs. The web app in this checkout accepts and displays real events; see [web setup and the sender contract](apps/web/README.md). Android, Windows, and metric correlation are still at the sample-data milestone.

<!-- current-downloads:start -->
## Current downloads

| Platform | Version | Download | Status |
| --- | --- | --- | --- |
| Android | — | — | Not published |
| Windows x64 | 0.1.25 | [Installer](https://github.com/everyonesoftware/logs/releases/download/v0.1.25/LogsWindows-win-x64-Setup.exe) · [SHA-256](https://github.com/everyonesoftware/logs/releases/download/v0.1.25/LogsWindows-win-x64-Setup.exe.sha256) | Unsigned installer; synthetic-data build |
| Web | 0.1.25 | [Docker image](https://github.com/everyonesoftware/logs/releases/download/v0.1.25/logs-web-0.1.25-linux-amd64.tar.gz) · [SHA-256](https://github.com/everyonesoftware/logs/releases/download/v0.1.25/logs-web-0.1.25-linux-amd64.tar.gz.sha256) · [Run instructions](https://github.com/everyonesoftware/logs/blob/main/apps/web/README.md) | Linux x64; self-hosted |
<!-- current-downloads:end -->

See [release setup and verification](docs/RELEASING.md) for the CI pipeline and first publication.

## Sample investigation (native clients)

1. Search for `req-74a2` to find the steps of a failed Music library request.
2. Clear the filters and use the metric spike to show Music events between 14:30 and 14:35 UTC.
3. Open `GET /api/library returned 504` to inspect its source and request ID.

The native clients and web browser tests share `contracts/sample.json`. `mockups/Logs.html` is the original interaction study, not the web app.
