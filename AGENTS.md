# Signal

- `apps/web`, `apps/windows`, and `apps/android` own the three real clients. Use native controls on Windows and Android. `mockups/` holds design studies; don't serve them as the app.
- `contracts/sample.json` is the shared, synthetic UI fixture. Do not add real telemetry, credentials, network permissions for telemetry, accounts, or ingest endpoints to the interface milestone. The fixture is not a production API contract.
- Preserve fixture parity: UTC, newest first, case-insensitive substring search across messages/source/request ID, optional app and severity, and an inclusive start/exclusive end when inspecting a metric window. If a jump would clip the window, expand to the shortest supported range that covers it. Settings must report release checks as unavailable when no release channel exists.
- Use non-Python project code and validation tools. See the README for build and test instructions. Use an explicitly owned emulator serial for Android validation. A Linux Windows-targeted build is not native launch or installer evidence.
