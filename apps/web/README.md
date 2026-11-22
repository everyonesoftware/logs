# Signal web

Run from the repository root:

```sh
npm --prefix apps/web start
```

Open `http://127.0.0.1:4173`. Change the port with `PORT` if needed. No npm install or build step is required to run the app. It serves the shared synthetic `contracts/sample.json`; it does not collect data or connect to a live service. Settings shows the local build version and reports that no web release channel is configured.

## Browser verification

Run the suite against a locally installed Chromium and Playwright module:

```sh
PLAYWRIGHT_MODULE=/opt/data/code/website/node_modules/playwright \
CHROMIUM_PATH="$(command -v chromium)" npm --prefix apps/web test
```

If Playwright and its Chromium are already installed and resolvable from `apps/web`, omit the overrides. The suite starts its own loopback server on a free port.
