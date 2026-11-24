# Logs web

Run from the repository root with Node.js 24:

```sh
npm --prefix apps/web start
```

Open `http://127.0.0.1:4173`. Change the port with `PORT` if needed. No npm install or build step is required. The viewer starts empty and refreshes about every three seconds. It shows the newest 200 events from the last hour, before search and filters. There is no metric feed yet. SQLite keeps the latest 10,000 received events across restarts; `LOGS_DB_PATH` overrides the default `apps/web/data/logs.sqlite`.

## Create and manage API keys

Set `LOGS_ADMIN_TOKEN` on the server before starting it. Generate it separately with `openssl rand -hex 32`; never share it with senders. Open **Settings → API keys**, unlock with the administrator token, and choose **Create API key**. Name the application and copy the full key when it is shown. Logs stores a hash, not the full key. Give the sender the key through its secret store. **Revoke** stops that key from accepting new events without removing previous logs or affecting other keys. The application name is a label for choosing which key to revoke; it does not restrict the event's `app` field.

Use loopback on the server host or HTTPS through your private proxy. Forward the browser’s `Authorization` header for `/api/keys`, and do not log that header or the creation response. Key management is disabled without `LOGS_ADMIN_TOKEN`; previously issued keys remain valid until revoked. This token protects key management only. Keep the viewer and `GET /api/logs` private separately. If external senders need a public route, expose only `POST /api/logs` there, not the viewer or management routes.

## Send an event

Use a key created in Settings, or keep using the optional legacy `LOGS_INGEST_TOKEN` configured on the server. Set the sender's `LOGS_INGEST_TOKEN` to its credential. First test from the server host:

```sh
curl --fail-with-body http://127.0.0.1:4173/api/logs \
  -H "Authorization: Bearer $LOGS_INGEST_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"app":"worker","level":"INFO","message":"Worker started","source":"startup"}'
```

`POST /api/logs` accepts one UTF-8 JSON event per request and returns `201` with its assigned `id` after storage. Required fields: `app`, `level`, `message`. Levels: `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR`, `FATAL`. Optional fields: `source`, `requestId`, and a UTC `timestamp` such as `2026-11-23T14:30:00.000Z` (defaults to receipt time). `app`, `message`, `source`, and `requestId` are limited to 100, 4096, 256, and 256 UTF-8 bytes respectively; unknown fields are rejected. Events outside the current hour are not shown. This is a JSON endpoint, not an OTLP or syslog receiver. Filter out credentials and other sensitive values before shipping logs.

**Keep the viewer private.** The bearer token authorizes writes, not reads. The default host binding and Compose port are loopback-only. For off-host access, put an access-controlled HTTPS proxy in front of the loopback listener, restrict who can view logs, and set `LOGS_ALLOWED_HOST` to the exact proxy hostname if it forwards that `Host` header. The hostname check is not authentication. Do not publish the raw port or send the token over off-host plaintext HTTP.

## Run the Docker image

Use Docker Engine 28 or newer for these loopback-published setups. With older engines, use an independently verified firewall boundary before ingesting real logs: a loopback mapping alone may still be reachable from the same LAN segment. Keep Logs on a dedicated bridge and don't attach untrusted containers or enable direct routing to it.

Copy `.env.example` to a private `.env` and set `LOGS_VERSION` to the version you want. Set `LOGS_ADMIN_TOKEN` to enable key management, and optionally set `LOGS_INGEST_TOKEN` for legacy senders. Remove the legacy `LOGS_IMAGE` override to use `ghcr.io/everyonesoftware/logs`. Run `docker compose up -d` from the repository root. Compose retains the database in the `logs-data` named volume. If your image predates live ingestion or API key management, use an image that includes those features or build from source below.

### Run from an archive instead

Download the Linux x64 Docker archive and its SHA-256 sidecar from **Current downloads** in the root README. Before the first public release, download and unzip the `logs-web-<commit>` artifact from a successful **Logs CI** run instead.

Export `LOGS_ADMIN_TOKEN` in the shell to enable key management, and optionally export `LOGS_INGEST_TOKEN` for legacy senders. In the directory containing both files, substitute the downloaded version for `0.1.N`:

```sh
version=0.1.N
archive=logs-web-$version-linux-amd64.tar.gz
sha256sum -c "$archive.sha256"
docker image load -i "$archive"
docker network create --driver bridge logs-private  # once, for Logs only
docker run --rm --network logs-private -p 127.0.0.1:4173:4173 -e LOGS_ADMIN_TOKEN -e LOGS_INGEST_TOKEN \
  -v logs-data:/var/lib/logs "logs-web:$version"
```

Open `http://127.0.0.1:4173`. To upgrade, load a newer archive and recreate the container with its versioned tag, keeping the named volume.

To build the image yourself, run `docker build -f apps/web/Dockerfile -t logs-web:local .` from the repository root, then run the same `docker run` command with `logs-web:local`.

## Browser verification

Run the suite against a locally installed Chromium and Playwright module:

```sh
PLAYWRIGHT_MODULE=/opt/data/code/website/node_modules/playwright \
CHROMIUM_PATH="$(command -v chromium)" npm --prefix apps/web test
```

If Playwright and its Chromium are already installed and resolvable from `apps/web`, omit the overrides. The suite starts its own loopback server on a free port unless `LOGS_WEB_TEST_URL` is set. For a packaged build, use a disposable loopback instance with a fresh database. Set `LOGS_WEB_TEST_VERSION`, `LOGS_WEB_TEST_TOKEN`, and `LOGS_WEB_TEST_ADMIN_TOKEN` to its version and two test-only credentials. The suite writes events and creates and revokes a sender key in that database.
