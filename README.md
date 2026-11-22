# Signal

Signal is a workspace for searching application logs and comparing them with metrics. The first milestone runs on synthetic local data: it does not collect telemetry, connect to a Tailnet backend, or authenticate users.

## Current downloads

| Platform | Availability |
| --- | --- |
| Web | [Run locally](apps/web/README.md); no production deployment |
| Windows | [Build and run on Windows x64](apps/windows/README.md); no published installer or update feed |
| Android | [Build and install a debug APK](apps/android/README.md); no published APK or update feed |

## First investigation

1. Search for `req-74a2` to find the steps of a failed Music library request.
2. Clear the filters and use the metric spike to show Music events between 14:30 and 14:35 UTC.
3. Open `GET /api/library returned 504` to inspect its source and request ID.

The clients share `contracts/sample.json`. `mockups/Signal.html` is the original interaction study, not the web app.
