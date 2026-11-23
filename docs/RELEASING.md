# Logs releases

One **Logs CI** workflow runs on main pushes and pull requests. Shared validation selects the jobs; Android, Windows and web checks run in parallel. One serialized release job handles GitHub Releases and the README. Web is tested, not deployed. This workflow does not wire up in-app update discovery or installation.

## First release

1. Run the workflow with repository variable `LOGS_PUBLISH_RELEASES` absent (the default) to check packaging without publishing.
2. For Android, configure a dedicated Logs release key in repository Actions secrets: `LOGS_KEYSTORE_BASE64`, `LOGS_KEYSTORE_PASSWORD`, `LOGS_KEY_ALIAS`, `LOGS_KEY_PASSWORD`. Back up the signing identity securely; future APKs need the same signing identity for upgrades. Android tests/builds without these secrets but never publishes an unsigned or debug-signed APK.
3. Set repository variable `LOGS_PUBLISH_RELEASES=true` to authorize GitHub publication on main. Dispatch **Logs CI → all** to force the first candidate. With no Android key, only Windows can be published; to include both native assets in the first release, configure the secrets before enabling publication. If Windows was already published at the current commit, publish Android from a new main commit because published versions are immutable.
4. Check the exact run and resulting `v0.1.N` release. The tag must resolve to the built SHA; `N` is that SHA’s full-history commit count. Verify the APK signer, the installers and SHA-256 sidecars, and that Latest's `latest-versions.json`, release download table and README point to the verified platform versions. Windows packages are unsigned; native install and launch must pass on the Windows runner.

## Selection and recovery

- On main, each native platform is compared with its own last verified publication. A failed or unpublished native change remains eligible on a later docs-only push. Shared and unknown inputs affect all platforms. Pull requests check against their merge base branch tip without publishing; web on main uses successful main push validation, not a native release or a manual dispatch.
- A single stable Logs release contains the changed native outputs: a signed Android APK and/or the Windows setup executable, Velopack full package and feed, with source-bound manifests and installer checksums. The small `latest-versions.json` carries each platform's independently verified tag (or `null` before its first release). An unchanged platform keeps its original binaries, tag and download links.
- `maintenance` runs table repair without rebuilding. Run `node scripts/release.mjs preview` from the root for a read-only view of the live download table. Tables share the same verified inventory; the README write uses GitHub's blob SHA. Avoid editing the managed release description during publication: the GitHub release-description API does not offer an atomic write precondition.
- Rerun a failed release job using the retained artifacts. A matching draft can be completed without overwriting any existing bytes. Mismatched tags, inventories or existing bytes fail closed. If a newer release wins the publication lock, the older run does not roll back Latest; retry pending work with **Logs CI → all** at current `main` if needed.
- If GitHub leaves a zero-byte `starter` asset after a failed upload, remove only that incomplete asset from the exact draft and rerun with the original artifacts. Never remove an uploaded asset to bypass a checksum conflict.

```sh
test_deps=$(mktemp -d)
npm install --prefix "$test_deps" --no-save --no-package-lock --ignore-scripts yaml@2.8.3
NODE_PATH="$test_deps/node_modules" node --test scripts/*.test.mjs
node scripts/release.mjs select
node scripts/release.mjs preview
```
