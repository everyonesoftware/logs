# Logs web

Run from the repository root:

```sh
npm --prefix apps/web start
```

Open `http://127.0.0.1:4173`. Change the port with `PORT` if needed. No npm install or build step is required to run the app. It serves the shared synthetic `contracts/sample.json`; it does not collect data or connect to a live service. Settings shows the local build version and reports that no web release channel is configured.

## Run the Docker image

Download the Linux x64 Docker archive and its SHA-256 sidecar from **Current downloads** in the root README. Before the first public release, download and unzip the `logs-web-<commit>` artifact from a successful **Logs CI** run instead.

In the directory containing both files, substitute the downloaded version for `0.1.N`:

```sh
version=0.1.N
archive=logs-web-$version-linux-amd64.tar.gz
sha256sum -c "$archive.sha256"
docker image load -i "$archive"
docker run --rm -p 127.0.0.1:4173:4173 "logs-web:$version"
```

Open `http://127.0.0.1:4173`. The host binding above is local only. The image does not need volumes, secrets, or a backend. It serves synthetic sample data, has no authentication, and does not update itself. To upgrade, load a newer archive and recreate the container with its versioned tag.

For Compose, load the archive as above, then from the repository root run `docker compose --env-file .env.example up -d` instead of `docker run`. Set `LOGS_VERSION` in `.env.example` to match the loaded tag if needed.

To build the image yourself, run `docker build -f apps/web/Dockerfile -t logs-web:local .` from the repository root, then run the same `docker run` command with `logs-web:local`.

## Browser verification

Run the suite against a locally installed Chromium and Playwright module:

```sh
PLAYWRIGHT_MODULE=/opt/data/code/website/node_modules/playwright \
CHROMIUM_PATH="$(command -v chromium)" npm --prefix apps/web test
```

If Playwright and its Chromium are already installed and resolvable from `apps/web`, omit the overrides. The suite starts its own loopback server on a free port unless `LOGS_WEB_TEST_URL` is set. When pointing it at a released container, also set `LOGS_WEB_TEST_VERSION` to the image version.
