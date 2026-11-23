# Logs

Logs is a workspace for searching application logs and comparing them with metrics. The first milestone runs on synthetic local data: it does not collect telemetry, connect to a Tailnet backend, or authenticate users.

<!-- current-downloads:start -->
## Current downloads

| Platform | Version | Download | Status |
| --- | --- | --- | --- |
| Android | — | — | Not published |
| Windows x64 | 0.1.16 | [Installer](https://github.com/everyonesoftware/logs/releases/download/v0.1.16/LogsWindows-win-x64-Setup.exe) · [SHA-256](https://github.com/everyonesoftware/logs/releases/download/v0.1.16/LogsWindows-win-x64-Setup.exe.sha256) | Unsigned installer; synthetic-data build |
| Web | 0.1.16 | [Docker image](https://github.com/everyonesoftware/logs/releases/download/v0.1.16/logs-web-0.1.16-linux-amd64.tar.gz) · [SHA-256](https://github.com/everyonesoftware/logs/releases/download/v0.1.16/logs-web-0.1.16-linux-amd64.tar.gz.sha256) · [Run instructions](https://github.com/everyonesoftware/logs/blob/main/apps/web/README.md) | Linux x64; self-hosted, synthetic data |
<!-- current-downloads:end -->

See [release setup and verification](docs/RELEASING.md) for the CI pipeline and first publication.

## First investigation

1. Search for `req-74a2` to find the steps of a failed Music library request.
2. Clear the filters and use the metric spike to show Music events between 14:30 and 14:35 UTC.
3. Open `GET /api/library returned 504` to inspect its source and request ID.

The clients share `contracts/sample.json`. `mockups/Logs.html` is the original interaction study, not the web app.
