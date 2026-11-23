# <img src="src-tauri/icons/macos/Ummka.iconset/icon_128x128@2x.png" alt="" width="64" height="64" align="middle"> ummka

An independent Mattermost client for people who spend their day in Channels. The first build opens a local React interface in a native window on macOS and Android.

The project aims for fast startup and navigation, customizable light and dark themes, and a familiar Channels layout across macOS, Windows, Linux, iOS and Android.

Client-side Mattermost plugins are outside the project scope.

## Installation

### Build from source

Use Node.js 26.13.1 with its bundled npm 11.20.0, and install Rust through rustup. The repository selects Rust 1.95.0, rustfmt and Clippy. Install the locked JavaScript dependencies from the root of the checkout.

```sh
npm ci
```

**macOS on Apple Silicon.** Install Xcode with the macOS SDK. CI uses Xcode 26.6. Run the checks and open the release bundle.

```sh
make check-macos
ditto -x -k artifacts/ummka-macos-arm64.zip /tmp/ummka-install
open /tmp/ummka-install/ummka.app
```

The first run downloads pinned versions of actionlint, ShellCheck, Trivy and jq into `.check-tools/`. The ZIP contains an ad-hoc-signed release build for local use. For live editing, run `npm run tauri -- dev`.

**Android ARM64.** Install Temurin 17.0.21.1+2 and the Android SDK command-line tools. Set `ANDROID_HOME` to your SDK and `JAVA_HOME` to this JDK for the build. Install the SDK packages and the Rust target before building the APK.

```sh
"$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" \
  'platforms;android-37.0' 'platforms;android-36' 'build-tools;36.0.0' \
  'ndk;28.2.13676358' 'platform-tools'
export NDK_HOME="$ANDROID_HOME/ndk/28.2.13676358"
rustup target add aarch64-linux-android
make check-android
"$ANDROID_HOME/platform-tools/adb" install -r artifacts/ummka-android-arm64-debug.apk
```

The APK uses Gradle's local debug signing key. Open **ummka** from the launcher on an ARM64 device or emulator. For the acceptance test, use an Android API 36 emulator, switch on airplane mode and open the app twice, stopping its process between launches.

On a Mac with both toolchains, `make check` runs the same two build targets as GitHub Actions. The dependency scan covers npm, Cargo and Gradle. Its full report is written to `artifacts/trivy.json`. The disposable macOS runner also opens the unpacked application twice with its network interface disabled.
