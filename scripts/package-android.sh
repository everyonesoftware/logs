#!/usr/bin/env bash
# Usage: bash scripts/package-android.sh VERSION SOURCE_SHA
set +x
set -euo pipefail
umask 077
fail() { printf '%s\n' "$*" >&2; exit 1; }
base64_key=${LOGS_KEYSTORE_BASE64-}
store_password=${LOGS_KEYSTORE_PASSWORD-}
key_alias=${LOGS_KEY_ALIAS-}
key_password=${LOGS_KEY_PASSWORD-}
unset LOGS_KEYSTORE_BASE64 LOGS_KEYSTORE_PASSWORD LOGS_KEY_ALIAS LOGS_KEY_PASSWORD
[[ $# == 2 ]] || fail 'Usage: package-android.sh VERSION SOURCE_SHA'
version=$1
source_sha=$2
[[ $version =~ ^0\.1\.([1-9][0-9]{0,9})$ ]] || fail 'Expected a canonical Android version 0.1.N.'
code=${BASH_REMATCH[1]}
(( code <= 2100000000 )) || fail 'Android versionCode is out of range.'
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
verify_head() {
    [[ $source_sha =~ ^[a-f0-9]{40}$ && $source_sha == "$(git rev-parse HEAD)" ]] || fail 'Expected source SHA to match Git HEAD.'
}
verify_clean() {
    local dirty
    dirty=$(git status --porcelain --untracked-files=all) || fail 'Could not inspect Git status.'
    [[ -z $dirty ]] || fail 'Release packaging requires a clean committed checkout.'
}
verify_head
[[ -n $base64_key ]] || fail 'Set LOGS_KEYSTORE_BASE64 to the release keystore.'
[[ -n $store_password && -n $key_alias && -n $key_password ]] || fail 'Set LOGS_KEYSTORE_PASSWORD, LOGS_KEY_ALIAS and LOGS_KEY_PASSWORD.'
verify_clean
output=dist/android
[[ ! -e $output && ! -L $output ]] || fail 'dist/android already exists; use a clean artifact destination.'
sdk=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}
tools=$sdk/build-tools/36.0.0
[[ -n $sdk && -x $tools/aapt && -x $tools/apksigner && -x $tools/zipalign ]] || fail 'Install Android SDK build-tools 36.0.0 and configure ANDROID_HOME.'
tmp=$(mktemp -d)
stage=
trap 'rm -rf -- "$tmp"; if [[ -n $stage ]]; then rm -rf -- "$stage"; fi' EXIT
printf '%s' "$base64_key" | base64 --decode > "$tmp/release.keystore" || fail 'LOGS_KEYSTORE_BASE64 is not valid base64.'
unset base64_key
[[ -s $tmp/release.keystore ]] || fail 'Release keystore is empty.'
bash apps/android/gradlew -p apps/android --console=plain :app:assembleRelease -PlogsVersionCode="$code" -PlogsVersionName="$version"
apk="$tmp/LogsAndroid-$version.apk"
"$tools/zipalign" -P 16 -f 4 apps/android/app/build/outputs/apk/release/app-release-unsigned.apk "$tmp/aligned.apk"
LOGS_KEYSTORE_PASSWORD="$store_password" LOGS_KEY_PASSWORD="$key_password" "$tools/apksigner" sign \
    --ks "$tmp/release.keystore" --ks-key-alias "$key_alias" --ks-pass env:LOGS_KEYSTORE_PASSWORD \
    --key-pass env:LOGS_KEY_PASSWORD --out "$apk" "$tmp/aligned.apk"
unset store_password key_password
rm -- "$tmp/release.keystore"
"$tools/apksigner" verify --verbose "$apk"
"$tools/zipalign" -c -P 16 4 "$apk"
badging=$("$tools/aapt" dump badging "$apk")
[[ ${badging%%$'\n'*} == "package: name='com.everyonesoftware.signal' versionCode='$code' versionName='$version'"* ]] || fail 'Signed APK has the wrong application ID or version.'
verify_head
verify_clean
mkdir -p -- dist
stage=$(mktemp -d dist/.android.XXXXXX)
cp -- "$apk" "$stage/"
mv -nT -- "$stage" "$output"
[[ ! -e $stage ]] || fail 'dist/android appeared while building; existing output was preserved.'
