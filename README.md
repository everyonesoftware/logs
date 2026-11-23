# Logs

Logs is a workspace for searching application logs and comparing them with metrics. The first milestone runs on synthetic local data: it does not collect telemetry, connect to a Tailnet backend, or authenticate users.

<!-- current-downloads:start -->
## Current downloads

| Platform | Version | Download | Status |
| --- | --- | --- | --- |
| Android | — | — | Not published |
| Windows x64 | — | — | Not published |
| Web | — | [Run locally](https://github.com/everyonesoftware/logs/blob/main/apps/web/README.md) | No production deployment |
<!-- current-downloads:end -->

See [release setup and verification](docs/RELEASING.md) for the CI pipeline and first publication.

## First investigation

1. Search for `req-74a2` to find the steps of a failed Music library request.
2. Clear the filters and use the metric spike to show Music events between 14:30 and 14:35 UTC.
3. Open `GET /api/library returned 504` to inspect its source and request ID.

The clients share `contracts/sample.json`. `mockups/Logs.html` is the original interaction study, not the web app.
