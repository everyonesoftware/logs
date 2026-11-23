# Logs releases

One **Logs CI** workflow runs on main pushes and pull requests. Shared validation selects the Android, Windows and Web jobs independently. The Web job builds a Linux x64 Docker image, loads the archive into Docker and runs the browser suite against that container. One serialized release job handles GitHub Releases and the README. Publishing an image does not deploy the server or enable in-app updates.

## First release

1. Run the workflow with repository variable `LOGS_PUBLISH_RELEASES` absent (the default) to check packaging without publishing.
2. For Android, configure a dedicated Logs release key in repository Actions secrets: `LOGS_KEYSTORE_BASE64`, `LOGS_KEYSTORE_PASSWORD`, `LOGS_KEY_ALIAS`, `LOGS_KEY_PASSWORD`. Back up the signing identity securely; future APKs need the same signing identity for upgrades. Android tests/builds without these secrets but never publishes an unsigned or debug-signed APK.
3. Set repository variable `LOGS_PUBLISH_RELEASES=true` to authorize GitHub publication on main. Dispatch **Logs CI → all** to force the first candidate, or **web** to release only the image. Without an Android key, Windows and Web can still be published. Release tags are immutable: publish any omitted platform from a new main commit.
4. Check the exact run and resulting `v0.1.N` release. The tag must resolve to the built SHA; `N` is that SHA’s full-history commit count. Verify the APK signer, installer and image checksums, and that the release download table and README point to the verified platform versions. `latest-versions.json` retains the native-only schema. Windows packages are unsigned; native install and launch must pass on the Windows runner. Follow the [Web run instructions](../apps/web/README.md#run-the-docker-image) to verify the downloaded archive with Docker.

## Selection and recovery

- On main, each platform is compared with its own last verified publication. A failed or unpublished change remains eligible on a later docs-only push. Shared and unknown inputs affect all platforms. Pull requests check against the base branch tip without publishing; a successful Web job retains a loadable archive in Actions even when publication is off.
- A single stable Logs release contains the changed outputs: a signed Android APK, Windows setup executable with Velopack full package and feed, and/or `logs-web-<version>-linux-amd64.tar.gz`. Each platform has a source-bound manifest and SHA-256 sidecar. An unchanged platform keeps its original files, tag and download links.
- After the Web archive is verified on the release, the same image is pushed to `ghcr.io/everyonesoftware/logs:<version>`. The release job then points `ghcr.io/everyonesoftware/logs:latest` to that exact manifest digest. If registry upload fails, rerun the failed release job with its original archive; an existing version pointing to a different image is never overwritten. The old package tags and the archive and local image names are unchanged.
- `maintenance` repairs the download tables without rebuilding and repairs `:latest` using the current Web version already published to GHCR. If that version is absent from GHCR, rerun its original release job to publish it first. Run `node scripts/release.mjs preview` from the root for a read-only view of the live download table. Tables share the same verified inventory; the README write uses GitHub's blob SHA. Avoid editing the managed release description during publication: the GitHub release-description API does not offer an atomic write precondition.
- Rerun a failed release job using the retained artifacts. A matching draft can be completed without overwriting any existing bytes. Mismatched tags, inventories or existing bytes fail closed. If a newer release wins the publication lock, the older run does not roll back Latest; retry pending work with **Logs CI → all** at current `main` if needed.
- If GitHub leaves a zero-byte `starter` asset after a failed upload, remove only that incomplete asset from the exact draft and rerun with the original artifacts. Never remove an uploaded asset to bypass a checksum conflict.

```sh
test_deps=$(mktemp -d)
npm install --prefix "$test_deps" --no-save --no-package-lock --ignore-scripts yaml@2.8.3
NODE_PATH="$test_deps/node_modules" node --test scripts/*.test.mjs
node scripts/release.mjs select
node scripts/release.mjs preview
```
