# Logs for Android

Native Jetpack Compose investigation UI. It reads the shared synthetic fixture at `contracts/sample.json`, packaged as a single asset. This build does not connect to a collector, Tailnet or update feed. Settings shows the installed version, disables update checks, and directs users to Logs on the web to manage API keys.

## Build and verify

From `apps/android` with a JDK (17 or newer) and Android SDK platform 36:

```sh
./gradlew :app:testDebugUnitTest :app:lintDebug :app:assembleDebug :app:assembleDebugAndroidTest
```

The debug APK is `app/build/outputs/apk/debug/app-debug.apk`. Install it and the test APK on a dedicated emulator (API 26+), replacing `$DEVICE` with its serial:

```sh
adb -s "$DEVICE" install -r app/build/outputs/apk/debug/app-debug.apk
adb -s "$DEVICE" install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb -s "$DEVICE" shell am instrument -w -r com.everyonesoftware.signal.test/androidx.test.runner.AndroidJUnitRunner
```

The smoke tests exercise the shared sample through the real activity: search/reset, metric-to-logs navigation, event inspection and Android Back, and the Settings update state and read-only web handoff.
